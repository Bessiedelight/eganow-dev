import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";

const terminalStatuses = new Set(["completed", "failed", "superseded"]);

const findingValidator = v.object({
  agentName: v.string(),
  findingKey: v.string(),
  severity: v.union(
    v.literal("critical"),
    v.literal("warning"),
    v.literal("info")
  ),
  title: v.string(),
  body: v.string(),
  suggestion: v.optional(v.string()),
  path: v.optional(v.string()),
  line: v.optional(v.number()),
  startLine: v.optional(v.number()),
  side: v.optional(v.union(v.literal("LEFT"), v.literal("RIGHT"))),
  confidence: v.optional(v.number()),
  metadata: v.optional(v.any()),
});

export const getLatestRunByPullRequest = query({
  args: { pullRequestId: v.id("pullRequests") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviewOrchestrationRuns")
      .withIndex("by_pullRequestId_and_createdAt", (q) =>
        q.eq("pullRequestId", args.pullRequestId)
      )
      .order("desc")
      .first();
  },
});

export const getMessagesByRun = query({
  args: { runId: v.id("reviewOrchestrationRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviewOrchestrationMessages")
      .withIndex("by_runId_and_createdAt", (q) => q.eq("runId", args.runId))
      .order("asc")
      .collect();
  },
});

export const getFindingsByRun = query({
  args: { runId: v.id("reviewOrchestrationRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviewOrchestrationFindings")
      .withIndex("by_runId_and_createdAt", (q) => q.eq("runId", args.runId))
      .order("asc")
      .collect();
  },
});

export const triggerReview = mutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    repoFullName: v.string(),
    prNumber: v.number(),
    installationId: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const pullRequest = await ctx.db.get(args.pullRequestId);
    if (!pullRequest) throw new Error("Pull request not found");
    if (!pullRequest.headSha) {
      throw new Error("Pull request head SHA is missing");
    }

    const settings = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const provider = settings?.preferredProvider || "groq";

    const latestRun = await ctx.db
      .query("reviewOrchestrationRuns")
      .withIndex("by_pullRequestId_and_createdAt", (q) =>
        q.eq("pullRequestId", args.pullRequestId)
      )
      .order("desc")
      .first();

    if (
      latestRun &&
      latestRun.headSha === pullRequest.headSha &&
      !terminalStatuses.has(latestRun.status)
    ) {
      return latestRun._id;
    }

    const now = Date.now();
    const runId = await ctx.db.insert("reviewOrchestrationRuns", {
      organizationId: args.orgId,
      pullRequestId: args.pullRequestId,
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      headSha: pullRequest.headSha,
      baseSha: pullRequest.baseSha,
      provider,
      triggerSource: "manual",
      status: "queued",
      activeAgents: [],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.reviewOrchestrationActions.executeReview,
      {
        runId,
        installationId: args.installationId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        provider,
        userId,
      }
    );

    return runId;
  },
});

export const enqueueWebhookReview = mutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    repoFullName: v.string(),
    prNumber: v.number(),
    installationId: v.number(),
    headSha: v.string(),
    baseSha: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const latestRun = await ctx.db
      .query("reviewOrchestrationRuns")
      .withIndex("by_pullRequestId_and_createdAt", (q) =>
        q.eq("pullRequestId", args.pullRequestId)
      )
      .order("desc")
      .first();

    if (
      latestRun &&
      latestRun.headSha === args.headSha &&
      !terminalStatuses.has(latestRun.status)
    ) {
      return latestRun._id;
    }

    const now = Date.now();
    const runId = await ctx.db.insert("reviewOrchestrationRuns", {
      organizationId: args.orgId,
      pullRequestId: args.pullRequestId,
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      headSha: args.headSha,
      baseSha: args.baseSha,
      provider: "groq",
      triggerSource: "webhook",
      status: "queued",
      activeAgents: [],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.reviewOrchestrationActions.executeReview,
      {
        runId,
        installationId: args.installationId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        provider: "groq",
      }
    );

    return runId;
  },
});

export const sendMessage = mutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    runId: v.id("reviewOrchestrationRuns"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Review run not found");

    await ctx.db.insert("reviewOrchestrationMessages", {
      organizationId: args.orgId,
      pullRequestId: args.pullRequestId,
      runId: args.runId,
      role: "user",
      content: args.message,
      provider: run.provider,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.reviewOrchestrationActions.generateFollowUp,
      {
        runId: args.runId,
        pullRequestId: args.pullRequestId,
        orgId: args.orgId,
        provider: run.provider,
        userId,
        message: args.message,
      }
    );

    return null;
  },
});

export const getRunInternal = internalQuery({
  args: { runId: v.id("reviewOrchestrationRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const getFindingsInternal = internalQuery({
  args: { runId: v.id("reviewOrchestrationRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviewOrchestrationFindings")
      .withIndex("by_runId_and_createdAt", (q) => q.eq("runId", args.runId))
      .order("asc")
      .collect();
  },
});

export const getMessagesInternal = internalQuery({
  args: { runId: v.id("reviewOrchestrationRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviewOrchestrationMessages")
      .withIndex("by_runId_and_createdAt", (q) => q.eq("runId", args.runId))
      .order("asc")
      .collect();
  },
});

export const getAppReviewRunByHeadShaInternal = internalQuery({
  args: {
    pullRequestId: v.id("pullRequests"),
    headSha: v.string(),
  },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("prReviewRuns")
      .withIndex("by_reviewedHeadSha", (q) =>
        q.eq("pullRequestId", args.pullRequestId).eq("reviewedHeadSha", args.headSha)
      )
      .collect();

    return (
      matches.find(
        (run) => run.source === "app_ai" && typeof run.githubReviewId === "number"
      ) || null
    );
  },
});

export const updateRunStatus = internalMutation({
  args: {
    runId: v.id("reviewOrchestrationRuns"),
    status: v.union(
      v.literal("queued"),
      v.literal("fetching"),
      v.literal("running_agents"),
      v.literal("synthesizing"),
      v.literal("posting"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("superseded")
    ),
    activeAgents: v.optional(v.array(v.string())),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    githubReviewId: v.optional(v.number()),
    metrics: v.optional(v.any()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.activeAgents !== undefined) patch.activeAgents = args.activeAgents;
    if (args.summary !== undefined) patch.summary = args.summary;
    if (args.error !== undefined) patch.error = args.error;
    if (args.githubReviewId !== undefined) patch.githubReviewId = args.githubReviewId;
    if (args.metrics !== undefined) patch.metrics = args.metrics;
    if (args.completedAt !== undefined) patch.completedAt = args.completedAt;

    await ctx.db.patch(args.runId, patch);
  },
});

export const replaceFindingsForRun = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    runId: v.id("reviewOrchestrationRuns"),
    findings: v.array(findingValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("reviewOrchestrationFindings")
      .withIndex("by_runId_and_createdAt", (q) => q.eq("runId", args.runId))
      .collect();

    for (const finding of existing) {
      await ctx.db.delete(finding._id);
    }

    for (const finding of args.findings) {
      await ctx.db.insert("reviewOrchestrationFindings", {
        organizationId: args.organizationId,
        pullRequestId: args.pullRequestId,
        runId: args.runId,
        ...finding,
        createdAt: Date.now(),
      });
    }
  },
});

export const insertAssistantMessage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    runId: v.id("reviewOrchestrationRuns"),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
    role: v.union(v.literal("assistant"), v.literal("system")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reviewOrchestrationMessages", {
      organizationId: args.orgId,
      pullRequestId: args.pullRequestId,
      runId: args.runId,
      role: args.role,
      content: args.content,
      provider: args.provider,
      createdAt: Date.now(),
    });
  },
});

export const publishReviewArtifacts = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    runId: v.id("reviewOrchestrationRuns"),
    reviewedHeadSha: v.string(),
    summary: v.string(),
    verdict: v.union(
      v.literal("approve"),
      v.literal("request-changes"),
      v.literal("discuss")
    ),
    githubReviewId: v.optional(v.number()),
    findings: v.array(findingValidator),
  },
  handler: async (ctx, args) => {
    const existingComments = await ctx.db
      .query("prReviewComments")
      .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();
    for (const comment of existingComments) {
      if (comment.source === "app_ai") {
        await ctx.db.delete(comment._id);
      }
    }

    const existingThreads = await ctx.db
      .query("prReviewThreads")
      .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();
    for (const thread of existingThreads) {
      if (thread.source === "app_ai") {
        await ctx.db.delete(thread._id);
      }
    }

    const existingRuns = await ctx.db
      .query("prReviewRuns")
      .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();
    for (const run of existingRuns) {
      if (run.source === "app_ai") {
        await ctx.db.delete(run._id);
      }
    }

    const now = Date.now();
    const appRunId = await ctx.db.insert("prReviewRuns", {
      organizationId: args.organizationId,
      pullRequestId: args.pullRequestId,
      source: "app_ai",
      status: "completed",
      reviewedHeadSha: args.reviewedHeadSha,
      githubReviewId: args.githubReviewId,
      authorGithubUsername: "Eganow AI",
      summary: args.summary,
      metadata: {
        verdict: args.verdict,
        findingCount: args.findings.length,
        orchestrationRunId: args.runId,
      },
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const summaryThreadId = await ctx.db.insert("prReviewThreads", {
      organizationId: args.organizationId,
      pullRequestId: args.pullRequestId,
      reviewRunId: appRunId,
      source: "app_ai",
      isCopilot: false,
      githubThreadKey: `app_ai:${args.runId}:summary`,
      githubReviewId: args.githubReviewId,
      rootGithubCommentId: undefined,
      subjectType: "general",
      status: "open",
      path: undefined,
      line: undefined,
      startLine: undefined,
      side: undefined,
      severity:
        args.verdict === "request-changes"
          ? "critical"
          : args.findings.some((finding) => finding.severity === "warning")
            ? "warning"
            : "info",
      title: "AI review summary",
      summary: args.summary,
      snippet: undefined,
      authorGithubUsername: "Eganow AI",
      metadata: {
        verdict: args.verdict,
        orchestrationRunId: args.runId,
      },
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("prReviewComments", {
      organizationId: args.organizationId,
      pullRequestId: args.pullRequestId,
      threadId: summaryThreadId,
      reviewRunId: appRunId,
      source: "app_ai",
      role: "system",
      githubCommentId: undefined,
      githubReviewId: args.githubReviewId,
      authorGithubUsername: "Eganow AI",
      body: args.summary,
      metadata: {
        orchestrationRunId: args.runId,
      },
      createdAt: now,
      updatedAt: now,
    });

    for (const finding of args.findings) {
      const threadId = await ctx.db.insert("prReviewThreads", {
        organizationId: args.organizationId,
        pullRequestId: args.pullRequestId,
        reviewRunId: appRunId,
        source: "app_ai",
        isCopilot: false,
        githubThreadKey: `app_ai:${args.runId}:${finding.findingKey}`,
        githubReviewId: args.githubReviewId,
        rootGithubCommentId: undefined,
        subjectType: finding.path ? (finding.line ? "line" : "file") : "general",
        status: "open",
        path: finding.path,
        line: finding.line,
        startLine: finding.startLine,
        side: finding.side || "RIGHT",
        severity: finding.severity,
        title: finding.title,
        summary: finding.body,
        snippet:
          typeof finding.metadata?.snippet === "string"
            ? String(finding.metadata.snippet)
            : undefined,
        authorGithubUsername: "Eganow AI",
        metadata: {
          agentName: finding.agentName,
          confidence: finding.confidence,
          suggestion: finding.suggestion,
          orchestrationRunId: args.runId,
          ...finding.metadata,
        },
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("prReviewComments", {
        organizationId: args.organizationId,
        pullRequestId: args.pullRequestId,
        threadId,
        reviewRunId: appRunId,
        source: "app_ai",
        role: "reviewer",
        githubCommentId: undefined,
        githubReviewId: args.githubReviewId,
        authorGithubUsername: "Eganow AI",
        body: finding.suggestion
          ? `${finding.body}\n\nSuggested follow-up: ${finding.suggestion}`
          : finding.body,
        metadata: {
          agentName: finding.agentName,
          confidence: finding.confidence,
          orchestrationRunId: args.runId,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
