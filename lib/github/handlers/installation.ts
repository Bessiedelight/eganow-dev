import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getConvexAdminClient } from "@/lib/convex-server";
import { getInstallationClient } from "@/lib/github/client";
import { internal } from "@/convex/_generated/api";

async function fetchOrganizationMemberUsernames(
  installationId: number,
  accountLogin: string,
  accountType: string
) {
  if (accountType !== "Organization") {
    return [];
  }

  const octokit = await getInstallationClient(installationId);
  const usernames: string[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.request("GET /orgs/{org}/members", {
      org: accountLogin,
      per_page: 100,
      page,
    });

    const batch = data
      .map((member: { login?: string }) => member.login?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));

    usernames.push(...batch);

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return Array.from(new Set(usernames));
}

/**
 * Handles GitHub App installation events.
 *
 * Fired when someone installs or uninstalls the app
 * on their org or personal account.
 */
export async function handleInstallationCreated(
  event: EmitterWebhookEvent<"installation.created">
) {
  const { installation, sender } = event.payload;
  const account = installation.account;
  const accountLogin =
    account && "login" in account ? account.login : "unknown";
  const accountAvatarUrl =
    account && "avatar_url" in account ? account.avatar_url : undefined;
  const installedByGithubLogin = sender.login?.trim().toLowerCase();

  console.log(
    `[GitHub App] Installed on "${accountLogin}" ` +
      `(ID: ${installation.id}) by ${sender.login}`
  );

  const convex = getConvexAdminClient();

  try {
    await convex.mutation(internal.github.saveInstallationFromWebhook, {
      installationId: installation.id,
      accountLogin,
      accountType: installation.target_type,
      accountAvatarUrl,
      installedByGithubLogin,
    });

    const memberUsernames = await fetchOrganizationMemberUsernames(
      installation.id,
      accountLogin,
      installation.target_type
    );

    await convex.mutation(internal.organizations.syncInstallationRosterFromWebhook, {
      installationId: installation.id,
      accountLogin,
      accountType: installation.target_type,
      accountAvatarUrl,
      installedByGithubLogin,
      memberUsernames,
    });
  } catch (error) {
    console.error("[GitHub App] Failed to persist installation webhook:", error);
  }
}

export async function handleInstallationDeleted(
  event: EmitterWebhookEvent<"installation.deleted">
) {
  const { installation, sender } = event.payload;
  const account = installation.account;
  const accountLogin =
    account && "login" in account ? account.login : "unknown";

  console.log(
    `[GitHub App] Uninstalled from "${accountLogin}" ` +
      `(ID: ${installation.id}) by ${sender.login}`
  );

  const convex = getConvexAdminClient();

  try {
    await convex.mutation(internal.github.removeInstallationFromWebhook, {
      installationId: installation.id,
    });
  } catch (error) {
    console.error("[GitHub App] Failed to remove installation webhook:", error);
  }
}
