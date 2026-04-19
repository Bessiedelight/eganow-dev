import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getConvexClient } from "@/lib/convex-server";
import { api } from "@/convex/_generated/api";

/**
 * Handles GitHub pull request events.
 * Syncs to Convex and auto-links to projects via repo mapping.
 */

async function getOrgId(installationId: number) {
  const convex = getConvexClient();
  const installation = await convex.query(api.github.getInstallationByGitHubId, {
    installationId,
  });
  if (!installation) return null;
  return installation.organizationId;
}

export async function handlePullRequestOpened(
  event: EmitterWebhookEvent<"pull_request.opened">
) {
  const { pull_request: pr, repository, sender, installation } = event.payload;

  console.log(
    `[GitHub] 🔀 PR #${pr.number} opened in ${repository.full_name}: "${pr.title}"`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    const prId = await convex.mutation(api.pullRequests.syncFromGitHub, {
      orgId,
      githubPrNumber: pr.number,
      githubRepoFullName: repository.full_name,
      githubPrId: pr.id,
      githubUrl: pr.html_url,
      title: pr.title,
      body: pr.body ?? undefined,
      state: "open",
      isDraft: pr.draft ?? false,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      authorGithubUsername: sender.login,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      reviewers: (pr.requested_reviewers || []).map((r: any) => ({
        githubUsername: r.login,
        state: "pending" as const,
      })),
      githubLabels: (pr.labels || []).map((l: any) => ({
        name: l.name,
        color: `#${l.color}`,
      })),
    });

    // Auto-link to project
    const projectId = await convex.mutation(api.projects.findProjectForRepo, {
      orgId,
      repoFullName: repository.full_name,
    });

    if (projectId && prId) {
      await convex.mutation(api.pullRequests.update, {
        prId,
        projectId,
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
  const merged = pr.merged;

  console.log(
    `[GitHub] ${merged ? "🟣 PR merged" : "❌ PR closed"}: #${pr.number} in ${repository.full_name}`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    await convex.mutation(api.pullRequests.syncFromGitHub, {
      orgId,
      githubPrNumber: pr.number,
      githubRepoFullName: repository.full_name,
      githubPrId: pr.id,
      githubUrl: pr.html_url,
      title: pr.title,
      body: pr.body ?? undefined,
      state: merged ? "merged" : "closed",
      isDraft: pr.draft ?? false,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      authorGithubUsername: pr.user?.login ?? "unknown",
      mergedBy: pr.merged_by?.login,
      mergedAt: pr.merged_at
        ? new Date(pr.merged_at).getTime()
        : undefined,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync PR close:", err);
  }
}

export async function handlePullRequestReviewSubmitted(
  event: EmitterWebhookEvent<"pull_request_review.submitted">
) {
  const { review, pull_request: pr, repository, installation } = event.payload;

  const stateEmoji =
    review.state === "approved"
      ? "✅"
      : review.state === "changes_requested"
        ? "🔴"
        : "💬";

  console.log(
    `[GitHub] ${stateEmoji} PR #${pr.number} review (${review.state}) by ${review.user?.login} in ${repository.full_name}`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    // Re-sync the PR to update reviewer states
    await convex.mutation(api.pullRequests.syncFromGitHub, {
      orgId,
      githubPrNumber: pr.number,
      githubRepoFullName: repository.full_name,
      githubPrId: pr.id,
      githubUrl: pr.html_url,
      title: pr.title,
      body: pr.body ?? undefined,
      state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
      isDraft: pr.draft ?? false,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      authorGithubUsername: pr.user?.login ?? "unknown",
      reviewers: [
        {
          githubUsername: review.user?.login ?? "unknown",
          state: (review.state?.toLowerCase().replace(" ", "_") ||
            "pending") as any,
          submittedAt: review.submitted_at
            ? new Date(review.submitted_at).getTime()
            : undefined,
        },
      ],
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync review:", err);
  }
}

export async function handlePullRequestSynchronize(
  event: EmitterWebhookEvent<"pull_request.synchronize">
) {
  const { pull_request: pr, repository, installation } = event.payload;

  console.log(
    `[GitHub] 🔄 PR #${pr.number} updated (new commits) in ${repository.full_name}`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    await convex.mutation(api.pullRequests.syncFromGitHub, {
      orgId,
      githubPrNumber: pr.number,
      githubRepoFullName: repository.full_name,
      githubPrId: pr.id,
      githubUrl: pr.html_url,
      title: pr.title,
      body: pr.body ?? undefined,
      state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
      isDraft: pr.draft ?? false,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      authorGithubUsername: pr.user?.login ?? "unknown",
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync PR update:", err);
  }
}
