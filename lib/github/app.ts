import { App } from "@octokit/app";

/**
 * GitHub App singleton.
 *
 * Authenticated via the App's private key + ID (JWT-based).
 * Use this to create per-installation Octokit clients.
 *
 * The private key is stored as a base64 string in the env
 * to avoid multiline env-var issues across platforms.
 */

function decodePrivateKey(): string {
  const encoded = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!encoded) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is not set. " +
        "Add the base64-encoded PEM to .env.local."
    );
  }
  return Buffer.from(encoded, "base64").toString("utf-8");
}

let _app: App | null = null;

export function getGitHubApp(): App {
  if (_app) return _app;

  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new Error("GITHUB_APP_ID is not set in .env.local.");
  }

  _app = new App({
    appId,
    privateKey: decodePrivateKey(),
    webhooks: {
      secret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    },
  });

  return _app;
}
