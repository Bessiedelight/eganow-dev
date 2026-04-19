/**
 * PR Context Builder
 *
 * Orchestrates all GitHub data fetching needed for AI review.
 * Includes rate limit guard (refuses to start if budget < threshold).
 * Reuses existing lib/github/actions.ts functions.
 */

import {
  fetchPullRequestDetail,
  fetchPRFiles,
  fetchReadme,
  fetchFileContent,
  checkRateLimit,
} from "../github/actions";
import type { PRReviewContext } from "./types";

const RATE_LIMIT_THRESHOLD = 100;

/**
 * Build the complete context needed for a PR review.
 * Fetches PR details, file patches, README, and linked issues in parallel.
 *
 * @throws Error if GitHub rate limit is too low
 */
export async function buildPRContext(
  installationId: number,
  repoFullName: string,
  prNumber: number
): Promise<PRReviewContext> {
  // ── 1. Rate limit pre-flight check ────────────────────────
  const rateLimit = await checkRateLimit(installationId);
  if (rateLimit.remaining < RATE_LIMIT_THRESHOLD) {
    throw new Error(
      `GitHub rate limit too low: ${rateLimit.remaining}/${rateLimit.limit} remaining. ` +
        `Resets at ${rateLimit.resetAt.toISOString()}. Please try again later.`
    );
  }

  console.log(
    `[Context Builder] Rate limit OK: ${rateLimit.remaining}/${rateLimit.limit} remaining`
  );

  // ── 2. Parallel fetch (4 calls in ~2s instead of ~8s) ─────
  const [prDetail, prFiles, readme] = await Promise.all([
    fetchPullRequestDetail(installationId, repoFullName, prNumber),
    fetchPRFiles(installationId, repoFullName, prNumber),
    fetchReadme(installationId, repoFullName),
  ]);

  // ── 3. Parse linked issues from PR body ───────────────────
  const linkedIssues = await fetchLinkedIssues(
    installationId,
    repoFullName,
    prDetail.body || ""
  );

  console.log(
    `[Context Builder] Gathered: ${prFiles.length} files, ${linkedIssues.length} linked issues, ` +
      `README: ${readme.length > 0 ? "yes" : "no"}`
  );

  return {
    prTitle: prDetail.title,
    prBody: prDetail.body || "",
    diff: prDetail.diff || "",
    changedFiles: prFiles,
    linkedIssues,
    readme,
  };
}

/**
 * Fetch related files that are imported/referenced by changed files.
 * Used for dynamic scope expansion (Step 3 of the pipeline).
 *
 * Analyzes the diff for import patterns and fetches referenced files.
 */
export async function fetchRelatedFiles(
  installationId: number,
  repoFullName: string,
  changedFiles: PRReviewContext["changedFiles"],
  diff: string
): Promise<Array<{ path: string; content: string }>> {
  // Extract import paths from the diff
  const importPaths = extractImportPaths(diff, changedFiles);

  if (importPaths.length === 0) {
    console.log("[Context Builder] No related files to expand");
    return [];
  }

  // Limit to 5 related files to respect token budget
  const pathsToFetch = importPaths.slice(0, 5);

  console.log(
    `[Context Builder] Expanding scope: fetching ${pathsToFetch.length} related files`
  );

  const results = await Promise.allSettled(
    pathsToFetch.map(async (path) => {
      const content = await fetchFileContent(
        installationId,
        repoFullName,
        path
      );
      return { path, content };
    })
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ path: string; content: string }> =>
        r.status === "fulfilled" && r.value.content.length > 0
    )
    .map((r) => r.value);
}

// ════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════

/**
 * Parse PR body for linked issues (e.g., "Closes #123", "Fixes #456").
 * Fetches the body of each linked issue for additional context.
 */
async function fetchLinkedIssues(
  installationId: number,
  repoFullName: string,
  prBody: string
): Promise<Array<{ identifier: string; title: string; body: string }>> {
  // Match patterns: Closes #123, Fixes #456, Resolves #789
  const issuePattern =
    /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi;
  const matches = [...prBody.matchAll(issuePattern)];

  if (matches.length === 0) return [];

  // Deduplicate and limit to 3 issues
  const issueNumbers = [
    ...new Set(matches.map((m) => parseInt(m[1], 10))),
  ].slice(0, 3);

  const [owner, repo] = repoFullName.split("/");
  const { getInstallationClient } = await import("../github/client");
  const octokit = await getInstallationClient(installationId);

  const results = await Promise.allSettled(
    issueNumbers.map(async (num) => {
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}",
        { owner, repo, issue_number: num }
      );
      return {
        identifier: `#${num}`,
        title: data.title,
        body: (data.body || "").substring(0, 1000),
      };
    })
  );

  return results
    .filter(
      (
        r
      ): r is PromiseFulfilledResult<{
        identifier: string;
        title: string;
        body: string;
      }> => r.status === "fulfilled"
    )
    .map((r) => r.value);
}

/**
 * Extract import paths from diff content.
 * Looks for TypeScript/JavaScript import statements referencing local files.
 * Excludes node_modules, changed files themselves, and external packages.
 */
function extractImportPaths(
  diff: string,
  changedFiles: PRReviewContext["changedFiles"]
): string[] {
  const changedPaths = new Set(changedFiles.map((f) => f.filename));

  // Match: import ... from "./path" or import ... from "../path"
  // Also: require("./path") patterns
  const importPattern =
    /(?:from|require\s*\()\s*['"](\.\.?\/[^'"]+)['"]/g;

  const matches = [...diff.matchAll(importPattern)];
  const importedPaths = new Set<string>();

  for (const match of matches) {
    let importPath = match[1];

    // Skip if it's already a changed file
    if (changedPaths.has(importPath)) continue;

    // Add common extensions if missing
    if (!importPath.match(/\.\w+$/)) {
      importPath += ".ts"; // Default to .ts
    }

    // Remove leading ./ but keep relative paths
    importPath = importPath.replace(/^\.\//, "");

    // Skip node_modules and external
    if (importPath.includes("node_modules")) continue;

    importedPaths.add(importPath);
  }

  return [...importedPaths];
}
