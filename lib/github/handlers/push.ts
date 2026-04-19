import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getConvexClient } from "@/lib/convex-server";
import { api } from "@/convex/_generated/api";

/**
 * Handles push events to track code activity.
 * Syncs commits to Convex and records activity events.
 */
export async function handlePush(event: EmitterWebhookEvent<"push">) {
  const { ref, commits, repository, sender, installation } = event.payload;

  const branch = ref.replace("refs/heads/", "");
  const commitCount = commits?.length ?? 0;
  const pusherLogin = sender?.login ?? "unknown";

  console.log(
    `[GitHub] ⬆️  ${commitCount} commit(s) pushed to ${repository.full_name}/${branch} by ${pusherLogin}`
  );

  if (!installation?.id || !commits || commits.length === 0) return;

  const convex = getConvexClient();

  try {
    // Look up org
    const inst = await convex.query(api.github.getInstallationByGitHubId, {
      installationId: installation.id,
    });
    if (!inst) return;
    const orgId = inst.organizationId;

    // Sync each commit (up to 10)
    for (const commit of commits.slice(0, 10)) {
      await convex.mutation(api.commits.syncFromGitHub, {
        orgId,
        githubRepoFullName: repository.full_name,
        sha: commit.id,
        message: commit.message.split("\n")[0],
        authorGithubUsername:
          commit.author?.username ?? commit.author?.name ?? "unknown",
        committedAt: commit.timestamp
          ? new Date(commit.timestamp).getTime()
          : Date.now(),
      });
    }

    console.log(
      `[GitHub]    Synced ${Math.min(commits.length, 10)} commits to Convex`
    );
  } catch (err) {
    console.error("[Webhook] Failed to sync push:", err);
  }
}
