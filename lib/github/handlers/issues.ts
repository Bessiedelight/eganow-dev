import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getConvexClient } from "@/lib/convex-server";
import { api } from "@/convex/_generated/api";

/**
 * Handles GitHub issue events.
 * Syncs to Convex and auto-links to projects via repo mapping.
 */

async function getOrgId(installationId: number) {
  const convex = getConvexClient();

  // Look up the org that owns this installation
  const installation = await convex.query(api.github.getInstallationByGitHubId, {
    installationId,
  });

  if (!installation) {
    console.warn(`[Webhook] No installation found for ID ${installationId}`);
    return null;
  }

  // Find org by installation ID
  const org = await convex.query(api.organizations.getById, {
    orgId: installation.organizationId,
  });

  return org ? installation.organizationId : null;
}

export async function handleIssueOpened(
  event: EmitterWebhookEvent<"issues.opened">
) {
  const { issue, repository, sender, installation } = event.payload;

  console.log(
    `[GitHub] 📝 Issue #${issue.number} opened in ${repository.full_name}: "${issue.title}"`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    const issueId = await convex.mutation(api.issues.syncFromGitHub, {
      orgId,
      githubIssueNumber: issue.number,
      githubRepoFullName: repository.full_name,
      githubIssueId: issue.id,
      title: issue.title,
      body: issue.body ?? undefined,
      state: issue.state as string,
      authorGithubUsername: sender.login,
      githubUrl: issue.html_url,
      labels: issue.labels?.filter(Boolean).map((l) => l!.name) ?? [],
      milestone: issue.milestone?.title,
    });

    // Auto-link to project if repo is assigned
    const projectId = await convex.mutation(api.projects.findProjectForRepo, {
      orgId,
      repoFullName: repository.full_name,
    });

    if (projectId && issueId) {
      await convex.mutation(api.issues.update, {
        issueId,
        projectId,
      });
    }
  } catch (err) {
    console.error("[Webhook] Failed to sync issue:", err);
  }
}

export async function handleIssueClosed(
  event: EmitterWebhookEvent<"issues.closed">
) {
  const { issue, repository, installation } = event.payload;

  console.log(
    `[GitHub] ✅ Issue #${issue.number} closed in ${repository.full_name}`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    await convex.mutation(api.issues.syncFromGitHub, {
      orgId,
      githubIssueNumber: issue.number,
      githubRepoFullName: repository.full_name,
      githubIssueId: issue.id,
      title: issue.title,
      body: issue.body ?? undefined,
      state: "closed",
      authorGithubUsername: issue.user?.login ?? "unknown",
      githubUrl: issue.html_url,
      labels: issue.labels?.filter(Boolean).map((l) => l!.name) ?? [],
      milestone: issue.milestone?.title,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync issue close:", err);
  }
}

export async function handleIssueEdited(
  event: EmitterWebhookEvent<"issues.edited">
) {
  const { issue, repository, installation } = event.payload;

  console.log(
    `[GitHub] ✏️  Issue #${issue.number} edited in ${repository.full_name}`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    await convex.mutation(api.issues.syncFromGitHub, {
      orgId,
      githubIssueNumber: issue.number,
      githubRepoFullName: repository.full_name,
      githubIssueId: issue.id,
      title: issue.title,
      body: issue.body ?? undefined,
      state: issue.state as string,
      authorGithubUsername: issue.user?.login ?? "unknown",
      githubUrl: issue.html_url,
      labels: issue.labels?.filter(Boolean).map((l) => l!.name) ?? [],
      milestone: issue.milestone?.title,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync issue edit:", err);
  }
}

export async function handleIssueReopened(
  event: EmitterWebhookEvent<"issues.reopened">
) {
  const { issue, repository, installation } = event.payload;

  console.log(
    `[GitHub] 🔄 Issue #${issue.number} reopened in ${repository.full_name}`
  );

  if (!installation?.id) return;

  const convex = getConvexClient();

  try {
    const orgId = await getOrgId(installation.id);
    if (!orgId) return;

    await convex.mutation(api.issues.syncFromGitHub, {
      orgId,
      githubIssueNumber: issue.number,
      githubRepoFullName: repository.full_name,
      githubIssueId: issue.id,
      title: issue.title,
      body: issue.body ?? undefined,
      state: "open",
      authorGithubUsername: issue.user?.login ?? "unknown",
      githubUrl: issue.html_url,
      labels: issue.labels?.filter(Boolean).map((l) => l!.name) ?? [],
      milestone: issue.milestone?.title,
    });
  } catch (err) {
    console.error("[Webhook] Failed to sync issue reopen:", err);
  }
}
