import type { EmitterWebhookEvent } from "@octokit/webhooks";

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

  console.log(
    `[GitHub App] ✅ Installed on "${accountLogin}" ` +
      `(ID: ${installation.id}) by ${sender.login}`
  );
  console.log(
    `[GitHub App]    Target type: ${installation.target_type}`
  );

  // TODO: Persist installation to Convex
  // await convexClient.mutation(api.github.saveInstallation, {
  //   installationId: installation.id,
  //   accountLogin,
  //   accountType: installation.target_type,
  //   senderLogin: sender.login,
  // });
}

export async function handleInstallationDeleted(
  event: EmitterWebhookEvent<"installation.deleted">
) {
  const { installation, sender } = event.payload;
  const account = installation.account;
  const accountLogin =
    account && "login" in account ? account.login : "unknown";

  console.log(
    `[GitHub App] ❌ Uninstalled from "${accountLogin}" ` +
      `(ID: ${installation.id}) by ${sender.login}`
  );

  // TODO: Remove installation from Convex
  // await convexClient.mutation(api.github.removeInstallation, {
  //   installationId: installation.id,
  // });
}
