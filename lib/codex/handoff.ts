export type CodexTaskIntent =
  | "implement"
  | "fix"
  | "refactor"
  | "investigate";

export type CodexRepoResolution = {
  status: "ready" | "needs_repo_selection" | "needs_repo_link";
  repoOptions: string[];
  preferredRepo?: string;
};

type ResolveCodexRepoArgs = {
  issueGithubRepoFullName?: string;
  projectGithubRepoFullNames?: string[];
};

type BuildCodexHandoffBriefArgs = {
  repository: string;
  issueIdentifier: string;
  issueTitle: string;
  issueBody?: string;
  issueGithubNumber?: number;
  issueGithubUrl?: string;
  internalIssueUrl?: string;
  projectName?: string;
  taskIntent: CodexTaskIntent;
  userInstruction?: string;
};

const codexTaskLead: Record<CodexTaskIntent, string> = {
  implement: "Implement the requested work for this issue.",
  fix: "Fix the issue and verify the behavior is correct.",
  refactor: "Refactor the relevant code while preserving expected behavior.",
  investigate:
    "Investigate the issue, explain the root cause, and make the smallest appropriate change if one is clearly justified.",
};

function normalizeRepos(repos: Array<string | undefined>) {
  return Array.from(
    new Set(repos.map((repo) => repo?.trim()).filter((repo): repo is string => Boolean(repo)))
  );
}

export function resolveCodexRepoSelection(
  args: ResolveCodexRepoArgs
): CodexRepoResolution {
  const repoOptions = normalizeRepos([
    args.issueGithubRepoFullName,
    ...(args.projectGithubRepoFullNames ?? []),
  ]);

  if (args.issueGithubRepoFullName) {
    return {
      status: "ready",
      repoOptions,
      preferredRepo: args.issueGithubRepoFullName,
    };
  }

  if (repoOptions.length === 1) {
    return {
      status: "ready",
      repoOptions,
      preferredRepo: repoOptions[0],
    };
  }

  if (repoOptions.length > 1) {
    return {
      status: "needs_repo_selection",
      repoOptions,
    };
  }

  return {
    status: "needs_repo_link",
    repoOptions: [],
  };
}

export function getCodexLaunchUrl() {
  return process.env.NEXT_PUBLIC_CODEX_WEB_URL || "https://chatgpt.com";
}

export function getRepoUrl(repoFullName: string) {
  return `https://github.com/${repoFullName}`;
}

export function buildCodexHandoffBrief(
  args: BuildCodexHandoffBriefArgs
) {
  const sections = [
    `Repository: ${args.repository}`,
    `Issue: ${args.issueIdentifier}`,
  ];

  if (args.issueGithubNumber !== undefined) {
    sections.push(`GitHub Issue: ${args.repository}#${args.issueGithubNumber}`);
  }

  sections.push("");
  sections.push("Task:");
  sections.push(codexTaskLead[args.taskIntent]);
  sections.push("");
  sections.push("Issue Title:");
  sections.push(args.issueTitle);

  if (args.issueBody) {
    sections.push("");
    sections.push("Issue Description:");
    sections.push(args.issueBody.trim());
  }

  if (args.projectName || args.internalIssueUrl || args.issueGithubUrl) {
    sections.push("");
    sections.push("Context:");
    if (args.projectName) {
      sections.push(`- Project: ${args.projectName}`);
    }
    if (args.internalIssueUrl) {
      sections.push(`- Internal issue: ${args.internalIssueUrl}`);
    }
    if (args.issueGithubUrl) {
      sections.push(`- GitHub issue: ${args.issueGithubUrl}`);
    }
  }

  sections.push("");
  sections.push("Requirements:");
  sections.push("- Respect repository instructions such as AGENTS.md if present.");
  sections.push("- Preserve existing behavior unless the issue requires changing it.");
  sections.push("- Add or update tests when the repository already supports them.");
  sections.push("- Keep the change scoped to resolving this issue.");

  if (args.userInstruction?.trim()) {
    sections.push("");
    sections.push("Additional Guidance:");
    sections.push(args.userInstruction.trim());
  }

  sections.push("");
  sections.push("Expected Output:");
  sections.push("- Make the code changes in the connected repository.");
  sections.push("- Summarize what changed and any validation performed.");
  sections.push(
    `- If a pull request is created, reference ${args.issueIdentifier} in the PR description.`
  );

  return sections.join("\n");
}
