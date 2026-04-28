type PermissionDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd\b/i,
  /\bgit\s+(push|fetch|pull|merge|rebase|checkout|switch|branch|tag|worktree|commit)\b/i,
  /\b(curl|wget|ssh|scp|sftp|nc|ncat|ping|telnet)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|add|dlx|create)\b/i,
  /\bInvoke-WebRequest\b/i,
  /\birm\b/i,
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
];

const AUTO_ALLOWED_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "mcp__eganow__eganow_get_issue_context",
  "mcp__eganow__eganow_get_repo_context",
  "mcp__eganow__eganow_publish_pull_request",
]);

function hasUnsafePathTraversal(command: string) {
  return (
    /(^|\s)\.\.(\/|\\|$)/.test(command) ||
    /(^|\s)cd\s+\.\.(\s|$)/.test(command) ||
    /(^|\s)cd\s+\/(?!workspaces)/.test(command)
  );
}

export function createIssueAgentPermissionHandler(worktreePath: string) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options?: any
  ): Promise<PermissionDecision> => {
    if (!AUTO_ALLOWED_TOOLS.has(toolName)) {
      return {
        behavior: "deny",
        message: `${toolName} is not enabled for this issue agent session.`,
      };
    }

    if (["Read", "Write", "Edit", "Glob", "Grep"].includes(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }

    if (toolName !== "Bash") {
      return { behavior: "allow", updatedInput: input };
    }

    const command =
      typeof input.command === "string"
        ? input.command
        : typeof input.cmd === "string"
          ? input.cmd
          : "";

    if (!command.trim()) {
      return { behavior: "deny", message: "Empty Bash commands are not allowed." };
    }

    if (DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command))) {
      return {
        behavior: "deny",
        message: "This Bash command was blocked because it looks destructive.",
      };
    }

    if (hasUnsafePathTraversal(command)) {
      return {
        behavior: "deny",
        message:
          "This Bash command was blocked because it attempts to leave the session worktree.",
      };
    }

    return {
      behavior: "allow",
      updatedInput: {
        ...input,
        cwd: worktreePath,
      },
    };
  };
}
