import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getConvexClient } from "@/lib/convex-server";
import { api } from "@/convex/_generated/api";
import { syncGitHubPullRequestReviewArtifacts } from "@/lib/github/review-actions";

async function getOrgId(installationId: number) {
  const convex = getConvexClient();
  const installation = await convex.query(api.github.getInstallationByGitHubId, {
    installationId,
  });
  if (!installation) return null;
  return installation.organizationId;
}

async function syncPullRequestFromPayload(args: {
  installationId: number;
  orgId: string;
  repositoryFullName: string;
  pr: any;
  fallbackAuthorGithubUsername?: string;
}) {
  const convex = getConvexClient();
  return await convex.mutation(api.pullRequests.syncFromGitHub, {
    orgId: args.orgId as any,
    githubPrNumber: args.pr.number,
    githubRepoFullName: args.repositoryFullName,
    githubPrId: args.pr.id,
    githubUrl: args.pr.html_url,
    title: args.pr.title,
    body: args.pr.body ?? undefined,
    state: args.pr.merged_at ? "merged" : (args.pr.state as "open" | "closed"),
    isDraft: args.pr.draft ?? false,
    baseBranch: args.pr.base.ref,
    headBranch: args.pr.head.ref,
    baseSha: args.pr.base?.sha ?? undefined,
    headSha: args.pr.head?.sha ?? undefined,
    authorGithubUsername:
      args.pr.user?.login ?? args.fallbackAuthorGithubUsername ?? "unknown",
    mergedBy: args.pr.merged_by?.login,
    mergedAt: args.pr.merged_at ? new Date(args.pr.merged_at).getTime() : undefined,
    additions: args.pr.additions,
    deletions: args.pr.deletions,
    changedFiles: args.pr.changed_files,
    reviewers: (args.pr.requested_reviewers || []).map((reviewer: any) => ({
      githubUsername: reviewer.login,
      state: "pending" as const,
    })),
    githubLabels: (args.pr.labels || []).map((label: any) => ({
      name: label.name,
      color: `#${label.color}`,
    })),
  });
}

async function reconcileReviewArtifacts(args: {
  installationId: number;
  orgId: string;
  pullRequestId: string;
  repositoryFullName: string;
  pr: any;
}) {
  await syncGitHubPullRequestReviewArtifacts({
    installationId: args.installationId,
    orgId: args.orgId,
    pullRequestId: args.pullRequestId,
    repoFullName: args.repositoryFullName,
    prNumber: args.pr.number,
    currentHeadSha: args.pr.head?.sha,
    prAuthorGithubUsername: args.pr.user?.login ?? undefined,
  });
}

async function enqueueOrchestratedReview(args: {
  installationId: number;
  orgId: string;
  pullRequestId: string;
  repositoryFullName: string;
  pr: any;
}) {
  if (!args.pr.head?.sha) return;

  const convex = getConvexClient();
  await convex.mutation(api.reviewOrchestration.enqueueWebhookReview, {
    orgId: args.orgId as any,
    pullRequestId: args.pullRequestId as any,
    repoFullName: args.repositoryFullName,
    prNumber: args.pr.number,
    installationId: args.installationId,
    headSha: args.pr.head.sha,
    baseSha: args.pr.base?.sha ?? undefined,
  });
}

async function syncPullRequestAndReviews(args: {
  installationId: number;
  repositoryFullName: string;
  pr: any;
  fallbackAuthorGithubUsername?: string;
}) {
  const orgId = await getOrgId(args.installationId);
  if (!orgId) return null;

  const prId = await syncPullRequestFromPayload({
    installationId: args.installationId,
    orgId: orgId as any,
    repositoryFullName: args.repositoryFullName,
    pr: args.pr,
    fallbackAuthorGithubUsername: args.fallbackAuthorGithubUsername,
  });

  if (prId) {
    await reconcileReviewArtifacts({
      installationId: args.installationId,
      orgId: orgId as any,
      pullRequestId: prId as any,
      repositoryFullName: args.repositoryFullName,
      pr: args.pr,
    });
  }

  return { orgId, prId };
}

export async function handlePullRequestOpened(
  event: EmitterWebhookEvent<"pull_request.opened">
) {
  const { pull_request: pr, repository, sender, installation } = event.payload;

  console.log(
    `[GitHub] PR #${pr.number} opened in ${repository.full_name}: "${pr.title}"`
  );

  if (!installation?.id) return;

  try {
    const result = await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
      fallbackAuthorGithubUsername: sender.login,
    });

    if (result?.orgId && result.prId) {
      const convex = getConvexClient();
      const projectId = await convex.mutation(api.projects.findProjectForRepo, {
        orgId: result.orgId as any,
        repoFullName: repository.full_name,
      });

      if (projectId) {
        await convex.mutation(api.pullRequests.update, {
          prId: result.prId as any,
          projectId,
        });
      }

      await enqueueOrchestratedReview({
        installationId: installation.id,
        orgId: result.orgId as any,
        pullRequestId: result.prId as any,
        repositoryFullName: repository.full_name,
        pr,
      });
    }
  } catch (err) {
    console.error("[Webhook] Failed to sync PR open:", err);
  }
}

export async function handlePullRequestClosed(
  event: EmitterWebhookEvent<"pull_request.closed">
) {
  const { pull_request: pr, repository, installation } = event.payload;

  console.log(
    `[GitHub] ${pr.merged ? "PR merged" : "PR closed"}: #${pr.number} in ${repository.full_name}`
  );

  if (!installation?.id) return;

  try {
    await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync PR close:", err);
  }
}

export async function handlePullRequestSynchronize(
  event: EmitterWebhookEvent<"pull_request.synchronize">
) {
  const { pull_request: pr, repository, installation } = event.payload;

  console.log(
    `[GitHub] PR #${pr.number} updated (new commits) in ${repository.full_name}`
  );

  if (!installation?.id) return;

  try {
    const result = await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });

    if (result?.orgId && result.prId) {
      await enqueueOrchestratedReview({
        installationId: installation.id,
        orgId: result.orgId as any,
        pullRequestId: result.prId as any,
        repositoryFullName: repository.full_name,
        pr,
      });
    }
  } catch (err) {
    console.error("[Webhook] Failed to sync PR update:", err);
  }
}

export async function handlePullRequestReadyForReview(
  event: EmitterWebhookEvent<"pull_request.ready_for_review">
) {
  const { pull_request: pr, repository, installation } = event.payload;

  console.log(
    `[GitHub] PR #${pr.number} ready for review in ${repository.full_name}`
  );

  if (!installation?.id) return;

  try {
    const result = await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });

    if (result?.orgId && result.prId) {
      await enqueueOrchestratedReview({
        installationId: installation.id,
        orgId: result.orgId as any,
        pullRequestId: result.prId as any,
        repositoryFullName: repository.full_name,
        pr,
      });
    }
  } catch (err) {
    console.error("[Webhook] Failed to sync ready_for_review PR:", err);
  }
}

export async function handlePullRequestConvertedToDraft(
  event: EmitterWebhookEvent<"pull_request.converted_to_draft">
) {
  const { pull_request: pr, repository, installation } = event.payload;

  if (!installation?.id) return;

  try {
    await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync converted_to_draft PR:", err);
  }
}

export async function handlePullRequestReopened(
  event: EmitterWebhookEvent<"pull_request.reopened">
) {
  const { pull_request: pr, repository, installation } = event.payload;

  if (!installation?.id) return;

  try {
    const result = await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });

    if (result?.orgId && result.prId) {
      await enqueueOrchestratedReview({
        installationId: installation.id,
        orgId: result.orgId as any,
        pullRequestId: result.prId as any,
        repositoryFullName: repository.full_name,
        pr,
      });
    }
  } catch (err) {
    console.error("[Webhook] Failed to sync reopened PR:", err);
  }
}

export async function handlePullRequestReviewRequested(
  event: EmitterWebhookEvent<"pull_request.review_requested">
) {
  const { pull_request: pr, repository, installation } = event.payload;

  if (!installation?.id) return;

  try {
    await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync review_requested PR:", err);
  }
}

async function handlePullRequestReviewLifecycle(
  event:
    | EmitterWebhookEvent<"pull_request_review.submitted">
    | EmitterWebhookEvent<"pull_request_review.edited">
    | EmitterWebhookEvent<"pull_request_review.dismissed">
) {
  const { pull_request: pr, repository, installation } = event.payload;
  if (!installation?.id) return;

  try {
    await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync review lifecycle:", err);
  }
}

export async function handlePullRequestReviewSubmitted(
  event: EmitterWebhookEvent<"pull_request_review.submitted">
) {
  const { review, pull_request: pr, repository } = event.payload;

  console.log(
    `[GitHub] PR #${pr.number} review (${review.state}) by ${review.user?.login} in ${repository.full_name}`
  );

  await handlePullRequestReviewLifecycle(event);
}

export async function handlePullRequestReviewEdited(
  event: EmitterWebhookEvent<"pull_request_review.edited">
) {
  await handlePullRequestReviewLifecycle(event);
}

export async function handlePullRequestReviewDismissed(
  event: EmitterWebhookEvent<"pull_request_review.dismissed">
) {
  await handlePullRequestReviewLifecycle(event);
}

async function handlePullRequestReviewCommentLifecycle(
  event:
    | EmitterWebhookEvent<"pull_request_review_comment.created">
    | EmitterWebhookEvent<"pull_request_review_comment.edited">
    | EmitterWebhookEvent<"pull_request_review_comment.deleted">
) {
  const { pull_request: pr, repository, installation } = event.payload;
  if (!installation?.id) return;

  try {
    await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync review comment lifecycle:", err);
  }
}

export async function handlePullRequestReviewCommentCreated(
  event: EmitterWebhookEvent<"pull_request_review_comment.created">
) {
  await handlePullRequestReviewCommentLifecycle(event);
}

export async function handlePullRequestReviewCommentEdited(
  event: EmitterWebhookEvent<"pull_request_review_comment.edited">
) {
  await handlePullRequestReviewCommentLifecycle(event);
}

export async function handlePullRequestReviewCommentDeleted(
  event: EmitterWebhookEvent<"pull_request_review_comment.deleted">
) {
  await handlePullRequestReviewCommentLifecycle(event);
}

async function handlePullRequestReviewThreadLifecycle(
  event:
    | EmitterWebhookEvent<"pull_request_review_thread.resolved">
    | EmitterWebhookEvent<"pull_request_review_thread.unresolved">
) {
  const { pull_request: pr, repository, installation } = event.payload;
  if (!installation?.id) return;

  try {
    await syncPullRequestAndReviews({
      installationId: installation.id,
      repositoryFullName: repository.full_name,
      pr,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync review thread lifecycle:", err);
  }
}

export async function handlePullRequestReviewThreadResolved(
  event: EmitterWebhookEvent<"pull_request_review_thread.resolved">
) {
  await handlePullRequestReviewThreadLifecycle(event);
}

export async function handlePullRequestReviewThreadUnresolved(
  event: EmitterWebhookEvent<"pull_request_review_thread.unresolved">
) {
  await handlePullRequestReviewThreadLifecycle(event);
}
