"use server";

import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex-server";
import { getInstallationClient } from "./client";

function toTimestamp(value?: string | null) {
  return value ? new Date(value).getTime() : Date.now();
}

function getReviewSource(login?: string | null) {
  return login && /copilot/i.test(login) ? "copilot" : "github";
}

function summarizeBody(body: string | null | undefined, fallback: string) {
  const text = (body || "").trim();
  if (!text) return fallback;
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) || text;
  return firstLine.substring(0, 180);
}

function getThreadStatus(reviewedHeadSha: string | null | undefined, currentHeadSha?: string) {
  if (reviewedHeadSha && currentHeadSha && reviewedHeadSha !== currentHeadSha) {
    return "outdated" as const;
  }
  return "open" as const;
}

function getRunStatus(review: any, currentHeadSha?: string) {
  if (review.state === "pending") return "pending" as const;
  if (review.commit_id && currentHeadSha && review.commit_id !== currentHeadSha) {
    return "stale" as const;
  }
  return "completed" as const;
}

function getCommentRole(login: string | null | undefined, prAuthorGithubUsername?: string) {
  if (login && prAuthorGithubUsername && login === prAuthorGithubUsername) {
    return "author" as const;
  }
  return "reviewer" as const;
}

export async function fetchPullRequestReviewArtifacts(params: {
  installationId: number;
  repoFullName: string;
  prNumber: number;
  currentHeadSha?: string;
  prAuthorGithubUsername?: string;
}) {
  const [owner, repo] = params.repoFullName.split("/");
  const octokit = await getInstallationClient(params.installationId);

  const [{ data: reviews }, { data: reviewComments }] = await Promise.all([
    octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
      owner,
      repo,
      pull_number: params.prNumber,
      per_page: 100,
    }),
    octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
      owner,
      repo,
      pull_number: params.prNumber,
      per_page: 100,
    }),
  ]);

  const runs = reviews.map((review: any) => {
    const authorGithubUsername = review.user?.login || "unknown";
    const source = getReviewSource(authorGithubUsername);
    const createdAt = toTimestamp(review.submitted_at || review.created_at);
    return {
      syncKey: `review:${review.id}`,
      source,
      status: getRunStatus(review, params.currentHeadSha),
      reviewedHeadSha: review.commit_id || params.currentHeadSha || "",
      githubReviewId: review.id,
      authorGithubUsername,
      summary: summarizeBody(
        review.body,
        source === "copilot" ? "Copilot review submitted." : "GitHub review submitted."
      ),
      metadata: {
        state: review.state,
        htmlUrl: review.html_url,
      },
      completedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const reviewById = new Map<number, any>(reviews.map((review: any) => [review.id, review]));
  const commentById = new Map<number, any>(
    reviewComments.map((comment: any) => [comment.id, comment])
  );

  const findRootComment = (comment: any) => {
    let current = comment;
    while (current.in_reply_to_id) {
      const parent = commentById.get(current.in_reply_to_id);
      if (!parent) break;
      current = parent;
    }
    return current;
  };

  const groupedComments = new Map<number, any[]>();
  for (const comment of reviewComments) {
    const root = findRootComment(comment);
    const existing = groupedComments.get(root.id) || [];
    existing.push(comment);
    groupedComments.set(root.id, existing);
  }

  const threads: Array<Record<string, any>> = [];
  const comments: Array<Record<string, any>> = [];

  for (const [rootCommentId, group] of groupedComments.entries()) {
    const sortedGroup = [...group].sort(
      (a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at)
    );
    const root = commentById.get(rootCommentId) || sortedGroup[0];
    const review = root.pull_request_review_id
      ? reviewById.get(root.pull_request_review_id)
      : null;
    const authorGithubUsername = root.user?.login || review?.user?.login || "unknown";
    const source = getReviewSource(authorGithubUsername);
    const syncKey = `thread:${root.id}`;
    const updatedAt = sortedGroup.reduce(
      (latest, comment) => Math.max(latest, toTimestamp(comment.updated_at || comment.created_at)),
      toTimestamp(root.updated_at || root.created_at)
    );

    threads.push({
      syncKey,
      runSyncKey: root.pull_request_review_id ? `review:${root.pull_request_review_id}` : undefined,
      source,
      isCopilot: source === "copilot",
      githubThreadKey: syncKey,
      githubReviewId: root.pull_request_review_id,
      rootGithubCommentId: root.id,
      subjectType: root.subject_type === "file" ? "file" : root.path ? "line" : "general",
      status: getThreadStatus(root.original_commit_id || root.commit_id, params.currentHeadSha),
      path: root.path || undefined,
      line: root.line ?? root.original_line ?? undefined,
      startLine: root.start_line ?? root.original_start_line ?? undefined,
      side: root.side === "LEFT" ? "LEFT" : "RIGHT",
      title: root.path
        ? `${root.path}${root.line ? `:${root.line}` : ""}`
        : summarizeBody(root.body, "Review thread"),
      summary: summarizeBody(root.body, "Review thread"),
      snippet: root.diff_hunk ? String(root.diff_hunk).substring(0, 1200) : undefined,
      authorGithubUsername,
      metadata: {
        htmlUrl: root.html_url,
      },
      createdAt: toTimestamp(root.created_at),
      updatedAt,
    });

    for (const comment of sortedGroup) {
      const commentAuthor = comment.user?.login || "unknown";
      comments.push({
        threadSyncKey: syncKey,
        runSyncKey: comment.pull_request_review_id
          ? `review:${comment.pull_request_review_id}`
          : undefined,
        source: getReviewSource(commentAuthor),
        role: getCommentRole(commentAuthor, params.prAuthorGithubUsername),
        githubCommentId: comment.id,
        githubReviewId: comment.pull_request_review_id,
        authorGithubUsername: commentAuthor,
        body: comment.body || "",
        metadata: {
          htmlUrl: comment.html_url,
          path: comment.path,
          line: comment.line ?? comment.original_line ?? null,
        },
        createdAt: toTimestamp(comment.created_at),
        updatedAt: toTimestamp(comment.updated_at || comment.created_at),
      });
    }
  }

  for (const review of reviews as any[]) {
    if (!review.body?.trim()) continue;
    const authorGithubUsername = review.user?.login || "unknown";
    const source = getReviewSource(authorGithubUsername);
    const createdAt = toTimestamp(review.submitted_at || review.created_at);
    const syncKey = `review-body:${review.id}`;

    threads.push({
      syncKey,
      runSyncKey: `review:${review.id}`,
      source,
      isCopilot: source === "copilot",
      githubThreadKey: syncKey,
      githubReviewId: review.id,
      rootGithubCommentId: undefined,
      subjectType: "general",
      status:
        review.commit_id && params.currentHeadSha && review.commit_id !== params.currentHeadSha
          ? "outdated"
          : "open",
      path: undefined,
      line: undefined,
      startLine: undefined,
      side: undefined,
      title:
        source === "copilot"
          ? "Copilot review summary"
          : `${authorGithubUsername} review`,
      summary: summarizeBody(review.body, "General review"),
      snippet: undefined,
      authorGithubUsername,
      metadata: {
        state: review.state,
        htmlUrl: review.html_url,
      },
      createdAt,
      updatedAt: createdAt,
    });

    comments.push({
      threadSyncKey: syncKey,
      runSyncKey: `review:${review.id}`,
      source,
      role: "reviewer",
      githubCommentId: undefined,
      githubReviewId: review.id,
      authorGithubUsername,
      body: review.body,
      metadata: {
        state: review.state,
        htmlUrl: review.html_url,
      },
      createdAt,
      updatedAt: createdAt,
    });
  }

  threads.sort((a, b) => b.updatedAt - a.updatedAt);
  comments.sort((a, b) => a.createdAt - b.createdAt);
  runs.sort((a, b) => b.updatedAt - a.updatedAt);

  return { runs, threads, comments };
}

export async function syncGitHubPullRequestReviewArtifacts(params: {
  installationId: number;
  orgId: string;
  pullRequestId: string;
  repoFullName: string;
  prNumber: number;
  currentHeadSha?: string;
  prAuthorGithubUsername?: string;
}) {
  const artifacts = await fetchPullRequestReviewArtifacts({
    installationId: params.installationId,
    repoFullName: params.repoFullName,
    prNumber: params.prNumber,
    currentHeadSha: params.currentHeadSha,
    prAuthorGithubUsername: params.prAuthorGithubUsername,
  });

  const convex = getConvexClient();
  return await convex.mutation(api.prReviews.replaceFromGitHub, {
    orgId: params.orgId as any,
    pullRequestId: params.pullRequestId as any,
    runs: artifacts.runs,
    threads: artifacts.threads,
    comments: artifacts.comments,
  });
}
