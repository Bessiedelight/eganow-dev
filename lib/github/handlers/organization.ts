import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getConvexAdminClient } from "@/lib/convex-server";
import { internal } from "@/convex/_generated/api";

export async function handleOrganizationMemberAdded(
  event: EmitterWebhookEvent<"organization.member_added">
) {
  const { installation, membership, organization } = event.payload;
  if (!installation?.id) return;

  const githubUsername = membership.user?.login?.trim().toLowerCase();
  if (!githubUsername) return;

  console.log(
    `[GitHub Org] Member added to "${organization.login}": ${githubUsername}`
  );

  const convex = getConvexAdminClient();

  try {
    await convex.mutation(internal.organizations.addRosterMemberFromWebhook, {
      installationId: installation.id,
      githubUsername,
    });
  } catch (error) {
    console.error("[GitHub Org] Failed to add roster member:", error);
  }
}

export async function handleOrganizationMemberRemoved(
  event: EmitterWebhookEvent<"organization.member_removed">
) {
  const { installation, membership, organization } = event.payload;
  if (!installation?.id) return;

  const githubUsername = membership.user?.login?.trim().toLowerCase();
  if (!githubUsername) return;

  console.log(
    `[GitHub Org] Member removed from "${organization.login}": ${githubUsername}`
  );

  const convex = getConvexAdminClient();

  try {
    await convex.mutation(internal.organizations.removeRosterMemberFromWebhook, {
      installationId: installation.id,
      githubUsername,
    });
  } catch (error) {
    console.error("[GitHub Org] Failed to remove roster member:", error);
  }
}
