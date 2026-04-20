import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getHubByPullRequest = query({
  args: { pullRequestId: v.id("pullRequests") },
  handler: async (ctx, args) => {
    const pullRequest = await ctx.db.get(args.pullRequestId);
    if (!pullRequest) return null;

    const [runs, threads, comments] = await Promise.all([
      ctx.db
        .query("prReviewRuns")
        .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
        .order("desc")
        .collect(),
      ctx.db
        .query("prReviewThreads")
        .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
        .order("desc")
        .collect(),
      ctx.db
        .query("prReviewComments")
        .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
        .order("asc")
        .collect(),
    ]);

    const runMap = new Map(runs.map((run) => [run._id, run]));
    const commentsByThread = new Map<
      typeof threads[number]["_id"],
      typeof comments
    >();

    for (const comment of comments) {
      const existing = commentsByThread.get(comment.threadId) || [];
      existing.push(comment);
      commentsByThread.set(comment.threadId, existing);
    }

    const enrichedThreads = threads.map((thread) => {
      const threadComments = commentsByThread.get(thread._id) || [];
      const run = thread.reviewRunId ? runMap.get(thread.reviewRunId) || null : null;
      const isFresh =
        !pullRequest.headSha ||
        !run?.reviewedHeadSha ||
        run.reviewedHeadSha === pullRequest.headSha;
      const freshness =
        thread.status === "outdated" || !isFresh ? "stale" : "fresh";

      return {
        ...thread,
        run,
        comments: threadComments,
        freshness,
      };
    });

    const latestRun = runs[0] || null;
    const latestFreshRun =
      runs.find((run) => !pullRequest.headSha || run.reviewedHeadSha === pullRequest.headSha) ||
      null;
    const latestCopilotRun = runs.find((run) => run.source === "copilot") || null;

    const stats = {
      totalRuns: runs.length,
      totalThreads: enrichedThreads.length,
      openThreads: enrichedThreads.filter((thread) => thread.status === "open").length,
      resolvedThreads: enrichedThreads.filter((thread) => thread.status === "resolved").length,
      outdatedThreads: enrichedThreads.filter((thread) => thread.status === "outdated").length,
      copilotThreads: enrichedThreads.filter((thread) => thread.source === "copilot").length,
      humanThreads: enrichedThreads.filter((thread) => thread.source === "github").length,
      totalComments: comments.length,
    };

    return {
      pullRequest: {
        _id: pullRequest._id,
        headSha: pullRequest.headSha || null,
        baseSha: pullRequest.baseSha || null,
        githubUrl: pullRequest.githubUrl,
      },
      latestRun,
      latestFreshRun,
      latestCopilotRun,
      freshness: {
        currentHeadSha: pullRequest.headSha || null,
        latestReviewedHeadSha: latestRun?.reviewedHeadSha || null,
        isFresh:
          !pullRequest.headSha ||
          !latestRun?.reviewedHeadSha ||
          latestRun.reviewedHeadSha === pullRequest.headSha,
      },
      stats,
      runs,
      threads: enrichedThreads,
    };
  },
});

export const replaceFromGitHub = mutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    runs: v.array(v.any()),
    threads: v.array(v.any()),
    comments: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const pullRequest = await ctx.db.get(args.pullRequestId);
    if (!pullRequest) throw new Error("Pull request not found");

    const existingComments = await ctx.db
      .query("prReviewComments")
      .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();
    for (const comment of existingComments) {
      if (comment.source !== "app_ai") {
        await ctx.db.delete(comment._id);
      }
    }

    const existingThreads = await ctx.db
      .query("prReviewThreads")
      .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();
    for (const thread of existingThreads) {
      if (thread.source !== "app_ai") {
        await ctx.db.delete(thread._id);
      }
    }

    const existingRuns = await ctx.db
      .query("prReviewRuns")
      .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();
    for (const run of existingRuns) {
      if (run.source !== "app_ai") {
        await ctx.db.delete(run._id);
      }
    }

    const runIdByKey = new Map<string, typeof existingRuns[number]["_id"]>();
    for (const run of args.runs as Array<Record<string, any>>) {
      const insertedId = await ctx.db.insert("prReviewRuns", {
        organizationId: args.orgId,
        pullRequestId: args.pullRequestId,
        source: run.source,
        status: run.status,
        reviewedHeadSha: run.reviewedHeadSha,
        githubReviewId: run.githubReviewId,
        authorGithubUsername: run.authorGithubUsername,
        summary: run.summary,
        metadata: run.metadata,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      });
      runIdByKey.set(run.syncKey, insertedId);
    }

    const threadIdByKey = new Map<string, typeof existingThreads[number]["_id"]>();
    for (const thread of args.threads as Array<Record<string, any>>) {
      const insertedId = await ctx.db.insert("prReviewThreads", {
        organizationId: args.orgId,
        pullRequestId: args.pullRequestId,
        reviewRunId: thread.runSyncKey ? runIdByKey.get(thread.runSyncKey) : undefined,
        source: thread.source,
        isCopilot: thread.isCopilot,
        githubThreadKey: thread.githubThreadKey,
        githubReviewId: thread.githubReviewId,
        rootGithubCommentId: thread.rootGithubCommentId,
        subjectType: thread.subjectType,
        status: thread.status,
        path: thread.path,
        line: thread.line,
        startLine: thread.startLine,
        side: thread.side,
        severity: thread.severity,
        title: thread.title,
        summary: thread.summary,
        snippet: thread.snippet,
        authorGithubUsername: thread.authorGithubUsername,
        metadata: thread.metadata,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      });
      threadIdByKey.set(thread.syncKey, insertedId);
    }

    for (const comment of args.comments as Array<Record<string, any>>) {
      const threadId = threadIdByKey.get(comment.threadSyncKey);
      if (!threadId) continue;
      await ctx.db.insert("prReviewComments", {
        organizationId: args.orgId,
        pullRequestId: args.pullRequestId,
        threadId,
        reviewRunId: comment.runSyncKey ? runIdByKey.get(comment.runSyncKey) : undefined,
        source: comment.source,
        role: comment.role,
        githubCommentId: comment.githubCommentId,
        githubReviewId: comment.githubReviewId,
        authorGithubUsername: comment.authorGithubUsername,
        body: comment.body,
        metadata: comment.metadata,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      });
    }

    return {
      runsInserted: args.runs.length,
      threadsInserted: args.threads.length,
      commentsInserted: args.comments.length,
    };
  },
});
