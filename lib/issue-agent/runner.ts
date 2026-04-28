import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import { internal } from "../../convex/_generated/api.js";
import { decryptApiKey } from "../ai/crypto.ts";
import type { ConvexWorkerClient } from "../convex-server.ts";
import { createIssueAgentPermissionHandler } from "./policy.ts";
import { createIssueAgentMcpServer } from "./tools.ts";
import { ensureIssueAgentWorkspace } from "./workspace.ts";

const execFileAsync = promisify(execFile);

type RunIssueAgentTurnArgs = {
  convex: ConvexWorkerClient;
  taskId: string;
  sessionId: string;
  prompt: string;
};

function getSdkClaudeBinarySpecifier() {
  const extension = process.platform === "win32" ? ".exe" : "";

  if (process.platform === "linux") {
    return `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude${extension}`;
  }

  return `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${extension}`;
}

function resolveSdkBundledClaudeExecutable() {
  const localRequire = createRequire(import.meta.url);

  try {
    return localRequire.resolve(getSdkClaudeBinarySpecifier());
  } catch {
    return null;
  }
}

async function resolveClaudeCommandOnPath() {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const args = [process.platform === "win32" ? "claude.cmd" : "claude"];

  try {
    const { stdout } = await execFileAsync(command, args, {
      windowsHide: true,
    });
    return (
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

async function resolveClaudeCodeExecutableOptions() {
  const explicitExecutable =
    process.env.ISSUE_AGENT_CLAUDE_EXECUTABLE ||
    process.env.CLAUDE_CODE_EXECUTABLE;

  if (explicitExecutable) {
    return {
      pathToClaudeCodeExecutable: explicitExecutable,
    };
  }

  const bundledExecutable = resolveSdkBundledClaudeExecutable();
  if (bundledExecutable) {
    return {
      pathToClaudeCodeExecutable: bundledExecutable,
    };
  }

  const globalClaudeExecutable = await resolveClaudeCommandOnPath();
  if (globalClaudeExecutable) {
    return {
      pathToClaudeCodeExecutable: globalClaudeExecutable,
    };
  }

  throw new Error(
    "Claude runtime is not available. Install Claude Code globally, reinstall @anthropic-ai/claude-agent-sdk with optional native binaries enabled, or set ISSUE_AGENT_CLAUDE_EXECUTABLE to the Claude executable path."
  );
}

function buildIssueAgentPrompt(
  context: Awaited<ReturnType<typeof loadContext>>,
  prompt: string
) {
  const lines = [
    "You are the issue agent for this application.",
    "Work only inside the current repository and worktree.",
    "Inspect the existing code before making edits.",
    "Make concrete changes for the issue when appropriate.",
    "Run safe verification commands when needed.",
    "Do not publish directly to GitHub or push branches from shell commands.",
    "Use eganow_get_issue_context and eganow_get_repo_context when you need canonical app context.",
    "When the user wants a pull request and the work is ready, call eganow_publish_pull_request.",
    "eganow_publish_pull_request is approval-gated and the app will handle commit, push, and PR creation.",
    "",
    `ISSUE: ${context.issue.identifier} - ${context.issue.title}`,
    `REPOSITORY: ${context.session.repoFullName}`,
    `PROJECT: ${context.project?.name || "None"}`,
    "",
    "ISSUE BODY:",
    context.issue.body || "No issue body provided.",
    "",
    "USER REQUEST:",
    prompt,
  ];

  return lines.join("\n");
}

async function loadContext(convex: ConvexWorkerClient, sessionId: string) {
  const context = await convex.query(internal.issueAgents.getExecutionContextForWorker, {
    sessionId: sessionId as never,
  });
  if (!context) {
    throw new Error("Unable to load issue agent execution context");
  }
  return context;
}

async function appendMessage(
  convex: ConvexWorkerClient,
  sessionId: string,
  args: {
    role: "assistant" | "system" | "tool";
    messageType:
      | "chat"
      | "tool_call"
      | "tool_result"
      | "status"
      | "approval_request"
      | "approval_result"
      | "question"
      | "publish_event"
      | "error";
    content: string;
    metadata?: unknown;
  }
) {
  await convex.mutation(internal.issueAgents.appendAssistantMessageFromWorker, {
    sessionId: sessionId as never,
    ...args,
  });
}

export async function runIssueAgentTurn(args: RunIssueAgentTurnArgs) {
  const context = await loadContext(args.convex, args.sessionId);
  if (!context.encryptedAnthropicKey) {
    throw new Error("Anthropic API key not configured in Settings.");
  }

  const anthropicApiKey = decryptApiKey(context.encryptedAnthropicKey);

  const workspace = await ensureIssueAgentWorkspace({
    sessionId: context.session._id,
    repoFullName: context.session.repoFullName,
    branchName: context.session.branchName,
    githubInstallationId: context.session.githubInstallationId,
    existingWorktreePath: context.workspace.worktreePath,
  });

  await appendMessage(args.convex, context.session._id, {
    role: "system",
    messageType: "status",
    content: "Workspace ready. Starting Claude in the issue worktree.",
  });

  await args.convex.mutation(internal.issueAgents.updateWorkspaceFromWorker, {
    sessionId: context.session._id,
    baseBranch: workspace.baseBranch,
    branchName: workspace.branchName,
    worktreePath: workspace.worktreePath,
    claudeSessionPath: workspace.claudeSessionPath,
    worktreeCreated: workspace.worktreeCreated,
    status: "ready",
    lastHealthyAt: Date.now(),
  });

  await args.convex.mutation(internal.issueAgents.updateSessionFromWorker, {
    sessionId: context.session._id,
    baseBranch: workspace.baseBranch,
    branchName: workspace.branchName,
    status: "active",
    lastError: null,
  });

  const canUseTool = createIssueAgentPermissionHandler(workspace.worktreePath);
  const claudeCodeExecutableOptions = await resolveClaudeCodeExecutableOptions();
  const startedAt = Date.now();
  const abortController = new AbortController();
  let latestSessionId = context.session.claudeSessionId;
  let publishApprovalRequested = false;
  let stopRequested = false;
  let stopCheckInFlight = false;
  let claudeQuery: ReturnType<typeof query> | null = null;

  const stopCurrentRun = () => {
    if (stopRequested) {
      return;
    }

    stopRequested = true;
    abortController.abort();
    claudeQuery?.close();
  };

  const stopWatcher = setInterval(() => {
    if (stopRequested || stopCheckInFlight) {
      return;
    }

    stopCheckInFlight = true;
    void args.convex
      .query(internal.issueAgents.getTaskStateForWorker, {
        taskId: args.taskId as never,
      })
      .then((taskState) => {
        if (!taskState) {
          stopCurrentRun();
          return;
        }

        if (taskState.taskStatus === "cancelled" || taskState.sessionStatus === "closed") {
          stopCurrentRun();
        }
      })
      .finally(() => {
        stopCheckInFlight = false;
      });
  }, 1000);

  const timeoutId = setTimeout(() => {
    stopCurrentRun();
  }, 30 * 60 * 1000); // 30 minutes wall-clock timeout

  try {
    try {
      const mcpServer = createIssueAgentMcpServer({
        convex: args.convex,
        context: {
          ...context,
          workspace: {
            ...context.workspace,
            ...workspace,
          },
        },
        onPublishApprovalRequested: () => {
          publishApprovalRequested = true;
        },
      });

      claudeQuery = query({
        prompt: buildIssueAgentPrompt(context, args.prompt),
        options: {
          abortController,
          cwd: workspace.worktreePath,
          resume: context.session.claudeSessionId,
          ...claudeCodeExecutableOptions,
          model: "claude-sonnet-4-5",
          maxTurns: 150,
          permissionMode: "acceptEdits",
          settingSources: ["project"],
          mcpServers: {
            eganow: mcpServer,
          },
          allowedTools: [
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
            "Bash",
            "mcp__eganow__eganow_get_issue_context",
            "mcp__eganow__eganow_get_repo_context",
            "mcp__eganow__eganow_publish_pull_request",
          ],
          disallowedTools: ["WebSearch", "WebFetch", "Task", "NotebookEdit"],
          canUseTool,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: anthropicApiKey,
            CLAUDE_AGENT_SDK_CLIENT_APP: "eganow-issue-agent",
          },
        },
      });

      for await (const message of claudeQuery) {
        latestSessionId = message.session_id || latestSessionId;

        if (message.type === "system" && message.subtype === "init") {
          await appendMessage(args.convex, context.session._id, {
            role: "system",
            messageType: "status",
            content: "Claude session started. Streaming updates as tools run.",
          });
          await args.convex.mutation(internal.issueAgents.updateSessionFromWorker, {
            sessionId: context.session._id,
            claudeSessionId: message.session_id,
          });
          continue;
        }

        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if ("text" in block && typeof block.text === "string" && block.text.trim()) {
              await appendMessage(args.convex, context.session._id, {
                role: "assistant",
                messageType: "chat",
                content: block.text,
              });
            } else if ("name" in block && typeof block.name === "string") {
              await appendMessage(args.convex, context.session._id, {
                role: "tool",
                messageType: "tool_call",
                content: block.name,
                metadata: {
                  input: "input" in block ? block.input : undefined,
                },
              });
            }
          }
        }

        if (message.type === "result") {
          const finalStatus =
            message.subtype === "success"
              ? publishApprovalRequested
                ? "waiting_for_approval"
                : "waiting_for_user"
              : "failed";
          await args.convex.mutation(internal.issueAgents.updateSessionFromWorker, {
            sessionId: context.session._id,
            claudeSessionId: latestSessionId,
            status: finalStatus,
            lastError:
              message.subtype === "success"
                ? null
                : `Claude turn ended with status: ${message.subtype}`,
            usageSummary: {
              totalCostUsd: message.total_cost_usd ?? null,
              durationMs: Date.now() - startedAt,
              usage: "usage" in message ? message.usage : undefined,
            },
          });

          if (message.subtype !== "success") {
            await appendMessage(args.convex, context.session._id, {
              role: "system",
              messageType: "error",
              content: `Claude turn ended with status: ${message.subtype}`,
            });
          }
        }
      }
    } finally {
      clearInterval(stopWatcher);
      clearTimeout(timeoutId);
      claudeQuery?.close();
    }
  } catch (error) {
    if (stopRequested) {
      return { status: "cancelled" as const };
    }

    const message =
      error instanceof Error ? error.message : "Issue agent execution failed";

    await args.convex.mutation(internal.issueAgents.updateSessionFromWorker, {
      sessionId: context.session._id,
      status: "failed",
      lastError: message,
    });
    await appendMessage(args.convex, context.session._id, {
      role: "system",
      messageType: "error",
      content: message,
    });
    throw error;
  }

  if (stopRequested) {
    return { status: "cancelled" as const };
  }

  return { status: "completed" as const };
}
