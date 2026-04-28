import { getGitHubApp } from "./app.ts";

/**
 * Returns an authenticated Octokit client scoped to a specific
 * GitHub App installation (org or repo).
 *
 * Usage:
 *   const octokit = await getInstallationClient(installationId);
 *   const { data } = await octokit.request("GET /installation/repositories");
 */
export async function getInstallationClient(installationId: number) {
  const app = getGitHubApp();
  return app.getInstallationOctokit(installationId);
}

/**
 * Lists all installations of this GitHub App.
 * Useful for finding which orgs/users have installed the app.
 */
export async function listInstallations() {
  const app = getGitHubApp();
  const { data } = await app.octokit.request("GET /app/installations");
  return data;
}

/**
 * Get repositories accessible to a specific installation.
 */
export async function getInstallationRepos(installationId: number) {
  const octokit = await getInstallationClient(installationId);
  const { data } = await octokit.request(
    "GET /installation/repositories"
  );
  return data.repositories;
}
