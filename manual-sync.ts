import { getConvexAdminClient } from "./lib/convex-server";
import { internal } from "./convex/_generated/api";

const convex = getConvexAdminClient();

async function run() {
  await convex.mutation(internal.organizations.syncInstallationRosterFromWebhook, {
    installationId: 125686138,
    accountLogin: "eganow-dev",
    accountType: "Organization",
    memberUsernames: [ 'arcdemiainfo-glitch', 'Bessiedelight', 'betterHealth-app' ],
  });
  console.log("Sync done.");
}

run().catch(console.error);
