"use server";

import { getInstallationClient } from "./client";

/**
 * Create an issue on GitHub via the GitHub App installation.
 */
export async function createGitHubIssue(
  installationId: number,
  repoFullName: string,
  title: string,
  body?: string,
  labels?: string[]
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);

  const { data } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues",
    {
      owner,
      repo,
      title,
      body: body || undefined,
      labels: labels || undefined,
    }
  );

  return {
    number: data.number,
    id: data.id,
    url: data.html_url,
  };
}

/**
 * Fetch repositories accessible to a GitHub App installation.
 */
export async function fetchInstallationRepos(installationId: number) {
  const octokit = await getInstallationClient(installationId);
  const { data } = await octokit.request("GET /installation/repositories");

  return data.repositories.map(
    (r: { full_name: string; name: string; owner: { login: string } }) => ({
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
    })
  );
}

/**
 * Create a comment on a GitHub issue.
 */
export async function createGitHubComment(
  installationId: number,
  repoFullName: string,
  issueNumber: number,
  body: string
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);

  const { data } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    { owner, repo, issue_number: issueNumber, body }
  );

  return { id: data.id, url: data.html_url };
}

/**
 * Update an issue on GitHub (title, body, state, labels).
 */
export async function updateGitHubIssue(
  installationId: number,
  repoFullName: string,
  issueNumber: number,
  updates: {
    title?: string;
    body?: string;
    state?: "open" | "closed";
    labels?: string[];
  }
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);

  const { data } = await octokit.request(
    "PATCH /repos/{owner}/{repo}/issues/{issue_number}",
    { owner, repo, issue_number: issueNumber, ...updates }
  );

  return { number: data.number, state: data.state };
}

/**
 * Fetch all open + recently merged/closed PRs from a GitHub repo.
 * Uses the fast list endpoint (2 calls total). Stats like additions/deletions
 * are NOT available from this endpoint — they get populated when users visit
 * individual PR detail pages, which always syncs fresh data back to Convex.
 */
export async function fetchRepoPullRequests(
  installationId: number,
  repoFullName: string
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);

  // Fetch open PRs
  const { data: openPrs } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls",
    { owner, repo, state: "open", per_page: 50, sort: "updated", direction: "desc" }
  );

  // Fetch recently closed/merged PRs
  const { data: closedPrs } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls",
    { owner, repo, state: "closed", per_page: 20, sort: "updated", direction: "desc" }
  );

  const allPrs = [...openPrs, ...closedPrs];

  return allPrs.map((pr: any) => ({
    githubPrNumber: pr.number,
    githubRepoFullName: repoFullName,
    githubPrId: pr.id,
    githubUrl: pr.html_url,
    title: pr.title,
    body: pr.body || undefined,
    state: pr.merged_at ? "merged" as const : pr.state as "open" | "closed",
    isDraft: pr.draft || false,
    baseBranch: pr.base?.ref || "main",
    headBranch: pr.head?.ref || "unknown",
    authorGithubUsername: pr.user?.login || "unknown",
    // These fields are NOT returned by the list endpoint.
    // They get populated when users visit the PR detail page.
    additions: undefined,
    deletions: undefined,
    changedFiles: undefined,
    mergedBy: pr.merged_by?.login,
    mergedAt: pr.merged_at ? new Date(pr.merged_at).getTime() : undefined,
    reviewers: (pr.requested_reviewers || []).map((r: any) => ({
      githubUsername: r.login,
      state: "pending" as const,
    })),
    githubLabels: (pr.labels || []).map((l: any) => ({
      name: l.name,
      color: `#${l.color}`,
    })),
  }));
}


/**
 * Fetch a single pull request with full details (diff, reviews).
 */
export async function fetchPullRequestDetail(
  installationId: number,
  repoFullName: string,
  prNumber: number
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);

  const { data: pr } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    { owner, repo, pull_number: prNumber }
  );

  // Fetch reviews
  const { data: reviews } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    { owner, repo, pull_number: prNumber }
  );

  // Fetch diff
  let diffText = "";
  try {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: prNumber,
        headers: { accept: "application/vnd.github.diff" },
      }
    );
    diffText = data as unknown as string;
  } catch {
    // diff may not be available
  }

  const reviewers = reviews.map((r: any) => ({
    githubUsername: r.user?.login || "unknown",
    state: r.state?.toLowerCase().replace(" ", "_") || "pending",
    submittedAt: r.submitted_at
      ? new Date(r.submitted_at).getTime()
      : undefined,
    body: r.body,
  }));

  return {
    githubPrNumber: pr.number,
    githubRepoFullName: repoFullName,
    githubPrId: pr.id,
    githubUrl: pr.html_url,
    title: pr.title,
    body: pr.body || undefined,
    state: (pr.merged_at ? "merged" : pr.state) as "open" | "closed" | "merged",
    isDraft: pr.draft || false,
    baseBranch: pr.base?.ref || "main",
    headBranch: pr.head?.ref || "unknown",
    authorGithubUsername: pr.user?.login || "unknown",
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    mergedBy: pr.merged_by?.login,
    mergedAt: pr.merged_at
      ? new Date(pr.merged_at).getTime()
      : undefined,
    reviewers,
    githubLabels: (pr.labels || []).map((l: any) => ({
      name: l.name,
      color: `#${l.color}`,
    })),
    diff: diffText,
  };
}

/**
 * Fetch recent commits from a GitHub repo.
 */
export async function fetchRepoCommits(
  installationId: number,
  repoFullName: string,
  perPage: number = 30
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);

  const { data: commits } = await octokit.request(
    "GET /repos/{owner}/{repo}/commits",
    { owner, repo, per_page: perPage }
  );

  return commits.map((c: any) => ({
    sha: c.sha,
    message: c.commit?.message || "",
    authorGithubUsername: c.author?.login || c.commit?.author?.name || "unknown",
    committedAt: c.commit?.committer?.date
      ? new Date(c.commit.committer.date).getTime()
      : Date.now(),
    // Stats are not available from the list endpoint
    additions: undefined as number | undefined,
    deletions: undefined as number | undefined,
    changedFiles: undefined as number | undefined,
    githubRepoFullName: repoFullName,
  }));
}

/**
 * Fetch a single commit with full details (diff, stats).
 */
export async function fetchCommitDetail(
  installationId: number,
  repoFullName: string,
  sha: string
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);

  const { data: commit } = await octokit.request(
    "GET /repos/{owner}/{repo}/commits/{ref}",
    { owner, repo, ref: sha }
  );

  // Fetch the diff
  let diffText = "";
  try {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/commits/{ref}",
      {
        owner,
        repo,
        ref: sha,
        headers: { accept: "application/vnd.github.diff" },
      }
    );
    diffText = data as unknown as string;
  } catch {
    // diff may not be available
  }

  return {
    sha: commit.sha,
    message: commit.commit?.message || "",
    authorGithubUsername: commit.author?.login || commit.commit?.author?.name || "unknown",
    committedAt: commit.commit?.committer?.date
      ? new Date(commit.commit.committer.date).getTime()
      : Date.now(),
    additions: commit.stats?.additions,
    deletions: commit.stats?.deletions,
    changedFiles: commit.files?.length,
    githubUrl: commit.html_url,
    diff: diffText,
    files: (commit.files || []).map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════
// AI Review — GitHub Data Fetchers
// ═══════════════════════════════════════════════════════════════

/**
 * Check GitHub API rate limit for an installation.
 * Used as a pre-flight guard before starting AI reviews.
 */
export async function checkRateLimit(installationId: number) {
  const octokit = await getInstallationClient(installationId);
  const { data } = await octokit.request("GET /rate_limit");
  return {
    remaining: data.rate.remaining,
    limit: data.rate.limit,
    resetAt: new Date(data.rate.reset * 1000),
  };
}

/**
 * Fetch the repository README (decoded, truncated to ~4000 chars).
 * Returns empty string if not found.
 */
export async function fetchReadme(
  installationId: number,
  repoFullName: string
): Promise<string> {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);
  try {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/readme",
      {
        owner,
        repo,
        headers: { accept: "application/vnd.github.raw+json" },
      }
    );
    return (data as unknown as string).substring(0, 4000);
  } catch {
    return ""; // README not available
  }
}

/**
 * Fetch a single file's content from a repo (decoded, truncated to ~8000 chars).
 * Returns empty string if not found or too large.
 */
export async function fetchFileContent(
  installationId: number,
  repoFullName: string,
  path: string,
  ref?: string
): Promise<string> {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);
  try {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner,
        repo,
        path,
        ...(ref ? { ref } : {}),
        headers: { accept: "application/vnd.github.raw+json" },
      }
    );
    return (data as unknown as string).substring(0, 8000);
  } catch {
    return ""; // File not found or too large
  }
}

/**
 * Fetch per-file patches from a PR with stats.
 * Patches are truncated to 6000 chars each to respect token budgets.
 */
export async function fetchPRFiles(
  installationId: number,
  repoFullName: string,
  prNumber: number
): Promise<
  Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string;
  }>
> {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
    { owner, repo, pull_number: prNumber, per_page: 100 }
  );
  return data.map((f: any) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: (f.patch || "").substring(0, 6000),
  }));
}

