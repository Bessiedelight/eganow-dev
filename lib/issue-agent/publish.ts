import { api, internal } from "../../convex/_generated/api.js";
import type { ConvexWorkerClient } from "../convex-server.ts";
import {
  createGitHubPullRequest,
  fetchPullRequestDetail,
} from "../github/actions.ts";
import {
  commitAllChanges,
  listAheadCommitCount,
  listChangedFiles,
  pushBranch,
} from "./workspace.ts";

type PublishArgs = {
  convex: ConvexWorkerClient;
  sessionId: string;
};

async function loadContext(convex: ConvexWorkerClient, sessionId: string) {
  const context = await convex.query(internal.issueAgents.getExecutionContextForWorker, {
    sessionId: sessionId as never,
  });
  if (!context) {
    throw new Error("Unable to load issue agent execution context");
  }
  return context;
}

function buildPullRequestBody(context: Awaited<ReturnType<typeof loadContext>>) {
  const lines = [
    `Implements ${context.issue.identifier}: ${context.issue.title}`,
    "",
    "Summary",
    "",
    "- Changes prepared by the in-app issue agent",
  ];

  if (typeof context.issue.githubIssueNumber === "number") {
    lines.push("", `Closes #${context.issue.githubIssueNumber}`);
  }

  lines.push("", `Closes ${context.issue.identifier}`);
  return lines.join("\n");
}

async function appendPublishMessage(
  convex: ConvexWorkerClient,
  sessionId: string,
  content: string,
  metadata?: unknown
) {
  await convex.mutation(internal.issueAgents.appendAssistantMessageFromWorker, {
    sessionId: sessionId as never,
    role: "assistant",
    messageType: "publish_event",
    content,
    metadata,
  });
}

export async function publishIssueAgentPullRequest(args: PublishArgs) {
  const context = await loadContext(args.convex, args.sessionId);
  const workspace = context.workspace;
  const { worktreePath, baseBranch, branchName } = workspace;
  const repoFullName = context.session.repoFullName;
  const installationId = context.session.githubInstallationId;

  if (!worktreePath) {
    throw new Error("Worktree is not ready yet");
  }
  if (!baseBranch || !branchName || !repoFullName || typeof installationId !== "number") {
    throw new Error("Issue agent session is missing repository context");
  }

  await args.convex.mutation(internal.issueAgents.updateSessionFromWorker, {
    sessionId: context.session._id,
    status: "publishing",
    lastError: null,
  });

  const changedFiles = await listChangedFiles(worktreePath);
  const aheadCount = await listAheadCommitCount(worktreePath, baseBranch);

  if (changedFiles.length === 0 && aheadCount === 0) {
    await appendPublishMessage(
      args.convex,
      context.session._id,
      "There are no local code changes to publish yet. Ask Claude to make changes first."
    );
    await args.convex.mutation(internal.issueAgents.updateSessionFromWorker, {
      sessionId: context.session._id,
      status: "waiting_for_user",
    });
    return null;
  }

  if (changedFiles.length > 0) {
    const commitMessage = `${context.issue.identifier}: ${context.issue.title}`;
    await commitAllChanges(worktreePath, commitMessage);
  }

  await pushBranch(worktreePath, branchName, installationId);

  const title = `${context.issue.identifier}: ${context.issue.title}`;
  const body = buildPullRequestBody(context);
  const pullRequest = await createGitHubPullRequest(
    installationId,
    repoFullName,
    title,
    body,
    branchName,
    baseBranch
  );

  const pullRequestDetail = await fetchPullRequestDetail(
    installationId,
    repoFullName,
    pullRequest.githubPrNumber
  );
  const linkedPullRequestId = await args.convex.mutation(api.pullRequests.syncFromGitHub, {
    orgId: context.organization._id,
    githubPrNumber: pullRequestDetail.githubPrNumber,
    githubRepoFullName: pullRequestDetail.githubRepoFullName,
    githubPrId: pullRequestDetail.githubPrId,
    githubUrl: pullRequestDetail.githubUrl,
    title: pullRequestDetail.title,
    body: pullRequestDetail.body,
    state: pullRequestDetail.state,
    isDraft: pullRequestDetail.isDraft,
    baseBranch: pullRequestDetail.baseBranch,
    headBranch: pullRequestDetail.headBranch,
    baseSha: pullRequestDetail.baseSha,
    headSha: pullRequestDetail.headSha,
    authorGithubUsername: pullRequestDetail.authorGithubUsername,
    additions: pullRequestDetail.additions,
    deletions: pullRequestDetail.deletions,
    changedFiles: pullRequestDetail.changedFiles,
    mergeable: pullRequestDetail.mergeable,
    mergeableState: pullRequestDetail.mergeableState,
    mergedBy: pullRequestDetail.mergedBy,
    mergedAt: pullRequestDetail.mergedAt,
    reviewers: pullRequestDetail.reviewers,
    githubLabels: pullRequestDetail.githubLabels,
  });

  await args.convex.mutation(internal.issueAgents.updateSessionFromWorker, {
    sessionId: context.session._id,
    status: "waiting_for_user",
    linkedPullRequestId,
    githubPrNumber: pullRequest.githubPrNumber,
    githubPrUrl: pullRequest.githubUrl,
  });

  await appendPublishMessage(
    args.convex,
    context.session._id,
    `Pull request created: ${pullRequest.githubUrl}`,
    {
      githubPrNumber: pullRequest.githubPrNumber,
      githubPrUrl: pullRequest.githubUrl,
    }
  );

  return pullRequest;
}
