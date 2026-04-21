import { getConvexClient } from "./lib/convex-server";
import { api } from "./convex/_generated/api";

const convex = getConvexClient();

async function run() {
  await convex.mutation(api.organizations.syncInstallationRosterFromWebhook, {
    installationId: 125686138,
    accountLogin: "eganow-dev",
    accountType: "Organization",
    memberUsernames: [ 'arcdemiainfo-glitch', 'Bessiedelight', 'betterHealth-app' ],
  });
  console.log("Sync done.");
}

run().catch(console.error);
