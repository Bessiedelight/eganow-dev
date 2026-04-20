"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

type Finding = {
  agentName: string;
  findingKey: string;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  suggestion?: string;
  path?: string;
  line?: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
  confidence?: number;
  metadata?: Record<string, unknown>;
};

type ReviewSummary = {
  summary: string;
  verdict: "approve" | "request-changes" | "discuss";
  confidence: number;
  highlights: string[];
  nextSteps: string[];
};

type ChangedFileContext = {
  filename: string;
  additions: number;
  deletions: number;
  patch: string;
};

function isSensitivePath(path: string) {
  return /(auth|secret|token|password|crypto|session|middleware|oauth|permission|acl|security)/i.test(
    path
  );
}

function isTestFile(path: string) {
  return /(\.test\.|\.spec\.|__tests__|vitest|jest|playwright|cypress)/i.test(path);
}

function isCodeFile(path: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|php|cs)$/i.test(path);
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated]`;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalSide(value: unknown): "LEFT" | "RIGHT" | undefined {
  return value === "LEFT" || value === "RIGHT" ? value : undefined;
}

function normalizeFinding(
  finding: Partial<Omit<Finding, "agentName" | "findingKey">>,
  agentName: string,
  index: number
): Finding {
  const title = normalizeOptionalString(finding.title) || `Finding ${index + 1}`;
  const path = normalizeOptionalString(finding.path);
  const line = normalizeOptionalNumber(finding.line);
  const startLine = normalizeOptionalNumber(finding.startLine);
  const suggestion = normalizeOptionalString(finding.suggestion);
  const confidence = normalizeOptionalNumber(finding.confidence);
  const severity =
    finding.severity === "critical" ||
    finding.severity === "warning" ||
    finding.severity === "info"
      ? finding.severity
      : "info";

  return {
    agentName,
    findingKey:
      stableFindingKey(agentName, {
        title,
        path,
        line,
      }) || `${agentName}:${index}`,
    severity,
    title,
    body: normalizeOptionalString(finding.body) || "No detail provided.",
    suggestion,
    path,
    line,
    startLine,
    side: normalizeOptionalSide(finding.side) || "RIGHT",
    confidence,
    metadata: {
      specialist: agentName,
    },
  };
}

function stableFindingKey(
  agentName: string,
  finding: Pick<Finding, "title" | "path" | "line">
) {
  return [
    agentName,
    finding.path || "general",
    finding.line || 0,
    finding.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ].join(":");
}

function extractSnippetFromPatch(
  changedFiles: ChangedFileContext[],
  path?: string,
  line?: number
) {
  if (!path) return undefined;
  const target = changedFiles.find((file) => file.filename === path);
  if (!target?.patch) return undefined;

  const patchLines = target.patch.split("\n");
  if (patchLines.length === 0) return undefined;

  if (!line) {
    return patchLines.slice(0, 12).join("\n");
  }

  const hunkIndex = patchLines.findIndex((entry) => entry.startsWith("@@"));
  if (hunkIndex === -1) {
    return patchLines.slice(0, 12).join("\n");
  }

  let currentNewLine = 0;
  let targetIndex = hunkIndex + 1;

  for (let i = hunkIndex; i < patchLines.length; i += 1) {
    const entry = patchLines[i];
    if (entry.startsWith("@@")) {
      const match = entry.match(/\+(\d+)/);
      if (match) currentNewLine = Number(match[1]);
      continue;
    }

    const marker = entry[0];
    const affectsNewFile = marker !== "-";
    if (affectsNewFile) {
      if (currentNewLine === line) {
        targetIndex = i;
        break;
      }
      currentNewLine += 1;
    }
  }

  const start = Math.max(0, targetIndex - 3);
  const end = Math.min(patchLines.length, targetIndex + 4);
  return patchLines.slice(start, end).join("\n");
}

function chooseActiveAgents(files: string[]) {
  const codeFiles = files.filter(isCodeFile);
  const active = new Set<string>();

  if (codeFiles.length > 0) {
    active.add("code_quality");
    active.add("test_coverage");
  }

  if (files.some(isSensitivePath)) {
    active.add("security");
  }

  if (
    files.length > 8 ||
    files.some((path) => /(convex|schema|api|lib\/|components\/|hooks\/)/i.test(path))
  ) {
    active.add("architecture");
  }

  if (active.size === 0) {
    active.add("code_quality");
  }

  return [...active];
}

function buildAgentPrompt(args: {
  agentName: string;
  prTitle: string;
  prBody: string;
  readme: string;
  changedFiles: Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch: string;
  }>;
  linkedIssues: Array<{ identifier: string; title: string; body: string }>;
}) {
  const filesText = args.changedFiles
    .map(
      (file) =>
        `FILE: ${file.filename}\nADDITIONS: ${file.additions}\nDELETIONS: ${file.deletions}\nPATCH:\n${file.patch || "[no patch available]"}`
    )
    .join("\n\n");

  const issueText =
    args.linkedIssues.length > 0
      ? args.linkedIssues
          .map(
            (issue) =>
              `${issue.identifier}: ${issue.title}\n${truncate(issue.body || "", 600)}`
          )
          .join("\n\n")
      : "No linked issues provided.";

  const systemByAgent: Record<string, string> = {
    security:
      "You are a senior application security reviewer. Focus on auth, secrets, unsafe trust boundaries, permissions, injection, and data leaks.",
    code_quality:
      "You are a senior code reviewer. Focus on correctness, regressions, maintainability, edge cases, and implementation quality.",
    test_coverage:
      "You are a test strategy reviewer. Focus on missing or weak tests, broken assumptions, and whether riskier code paths are covered.",
    architecture:
      "You are an architectural reviewer. Focus on consistency with existing patterns, boundaries, coupling, scalability, and whether the change fits the codebase.",
  };

  return {
    system:
      systemByAgent[args.agentName] ||
      "You are a senior software reviewer.",
    user: `
Review this pull request from the perspective of the ${args.agentName} specialist.

Return strict JSON:
{
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "short title",
      "body": "why this matters",
      "suggestion": "optional concrete remediation",
      "path": "optional/path.ts",
      "line": 12,
      "startLine": 10,
      "side": "RIGHT",
      "confidence": 0.74
    }
  ]
}

Rules:
- Prefer 3-6 findings when meaningful issues exist.
- Only emit a finding if it is actionable.
- Use "critical" only for severe correctness/security/reliability risk.
- Be concrete about where the issue appears in the changed code.
- Prefer findings that reference an actual file and line when possible.
- If no meaningful findings exist, return {"findings":[]}.
- Do not include markdown.

PR TITLE:
${args.prTitle}

PR BODY:
${truncate(args.prBody || "No PR body provided.", 1500)}

REPOSITORY README / CONTEXT:
${truncate(args.readme || "No README provided.", 2500)}

LINKED ISSUES:
${issueText}

CHANGED FILES:
${truncate(filesText, 18000)}
    `.trim(),
  };
}

async function runSpecialist(args: {
  agentName: string;
  adapter: { call: (params: any) => Promise<string> };
  context: any;
}) {
  const prompt = buildAgentPrompt({
    agentName: args.agentName,
    prTitle: args.context.prTitle,
    prBody: args.context.prBody,
    readme: args.context.readme,
    changedFiles: args.context.changedFiles,
    linkedIssues: args.context.linkedIssues,
  });

  const raw = await args.adapter.call({
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonMode: true,
    temperature: 0.15,
    maxTokens: 2800,
  });

  const parsed = parseJson<{ findings?: Array<Omit<Finding, "agentName" | "findingKey">> }>(raw);
  const findings = (parsed.findings || []).map((finding, index) =>
    normalizeFinding(finding, args.agentName, index)
  );

  return findings;
}

async function synthesizeReview(args: {
  adapter: { call: (params: any) => Promise<string> };
  prTitle: string;
  prBody: string;
  activeAgents: string[];
  findings: Finding[];
}) {
  const findingsText =
    args.findings.length > 0
      ? args.findings
          .map(
            (finding) =>
              `[${finding.severity}] ${finding.title} (${finding.agentName})` +
              `${finding.path ? ` @ ${finding.path}${finding.line ? `:${finding.line}` : ""}` : ""}\n${finding.body}` +
              `${finding.suggestion ? `\nSuggestion: ${finding.suggestion}` : ""}`
          )
          .join("\n\n")
      : "No high-signal findings were raised.";

  const raw = await args.adapter.call({
    systemPrompt:
      "You are the final review synthesizer. Produce a calm, high-signal pull request review in plain explanatory language.",
    userPrompt: `
Return strict JSON:
{
  "summary": "2-4 sentence plain explanatory summary",
  "verdict": "approve" | "request-changes" | "discuss",
  "confidence": 0.0,
  "highlights": ["positive or stabilizing observation", "positive or stabilizing observation"],
  "nextSteps": ["concrete concern or follow-up action", "concrete concern or follow-up action"]
}

Guidelines:
- Use "request-changes" when there is any critical finding or several warnings.
- Use "discuss" when the PR is mixed but not clearly blocked.
- Use "approve" only when findings are empty or informational.
- Write the summary like a human reviewer, not a dashboard label.
- Keep highlights grounded in what appears stable, reasonable, or low-risk.
- Keep next steps concrete and tied to the most important concerns.

PR TITLE:
${args.prTitle}

PR BODY:
${truncate(args.prBody || "No PR body provided.", 1200)}

ACTIVE AGENTS:
${args.activeAgents.join(", ") || "none"}

FINDINGS:
${truncate(findingsText, 14000)}
    `.trim(),
    jsonMode: true,
    temperature: 0.2,
    maxTokens: 1400,
  });

  return parseJson<ReviewSummary>(raw);
}

function buildGitHubReviewBody(summary: ReviewSummary, findings: Finding[]) {
  const topFindings = findings.slice(0, 5);
  const lines = [
    `Pull Request Review`,
    "",
    "Summary",
    "",
    summary.summary,
  ];

  lines.push("", "---", "", "Health", "");
  lines.push(`- Verdict: ${summary.verdict}`);
  lines.push(`- Confidence: ${Math.round((summary.confidence || 0) * 100)}%`);

  if (summary.highlights?.length) {
    lines.push("", "---", "", "What looks healthy:", "");
    for (const item of summary.highlights) lines.push(`- ${item}`);
  }

  if (topFindings.length) {
    lines.push("", "---", "", "Inline comments:", "");
    for (const finding of topFindings) {
      const snippet =
        typeof finding.metadata?.snippet === "string"
          ? String(finding.metadata.snippet).trim()
          : "";
      lines.push(
        `${finding.title}${
          finding.path ? ` (${finding.path}${finding.line ? `:${finding.line}` : ""})` : ""
        }`,
        `Issue: ${finding.body}`,
        finding.path ? `Reference: ${finding.path}${finding.line ? `:${finding.line}` : ""}` : "",
        snippet ? `Code:\n${snippet}` : "",
        finding.suggestion ? `Suggestion: ${finding.suggestion}` : "",
        ""
      );
    }
  }

  if (summary.nextSteps?.length) {
    lines.push("", "---", "", "Suggested next steps:", "");
    for (const item of summary.nextSteps) lines.push(`- ${item}`);
  }

  return lines.join("\n");
}

export const executeReview = internalAction({
  args: {
    runId: v.id("reviewOrchestrationRuns"),
    installationId: v.number(),
    repoFullName: v.string(),
    prNumber: v.number(),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.reviewOrchestration.getRunInternal, {
      runId: args.runId,
    });
    if (!run) return;

    const pullRequest = await ctx.runQuery(internal.aiReviews.getPullRequestInternal, {
      pullRequestId: run.pullRequestId,
    });
    if (!pullRequest) {
      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "failed",
        error: "Pull request could not be loaded for review orchestration.",
      });
      return;
    }

    if (pullRequest.headSha && pullRequest.headSha !== run.headSha) {
      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "superseded",
        error: "Skipped because a newer head SHA is already available.",
      });
      return;
    }

    let anthropicApiKey: string | undefined;
    if (args.provider === "anthropic") {
      if (!args.userId) {
        await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
          runId: args.runId,
          status: "failed",
          error: "Claude reviews require a user-scoped API key.",
        });
        return;
      }

      const settings = await ctx.runQuery(internal.aiReviews.getSettingsInternal, {
        userId: args.userId,
      });
      if (!settings?.encryptedAnthropicKey) {
        await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
          runId: args.runId,
          status: "failed",
          error: "Anthropic API key not configured in Settings.",
        });
        return;
      }

      const { decryptApiKey } = await import("../lib/ai/crypto");
      anthropicApiKey = decryptApiKey(settings.encryptedAnthropicKey);
    }

    const { createAdapter } = await import("../lib/ai/llm-provider");
    const { buildPRContext } = await import("../lib/ai/pr-context-builder");
    const { getInstallationClient } = await import("../lib/github/client");

    const startedAt = Date.now();
    const adapter = createAdapter(args.provider, anthropicApiKey);

    try {
      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "fetching",
      });

      const context = await buildPRContext(
        args.installationId,
        args.repoFullName,
        args.prNumber
      );

      const activeAgents = chooseActiveAgents(
        context.changedFiles.map((file: { filename: string }) => file.filename)
      );

      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "running_agents",
        activeAgents,
        metrics: {
          filesAnalyzed: context.changedFiles.length,
          diffLines: context.diff.split("\n").length,
          linkedIssuesCount: context.linkedIssues.length,
        },
      });

      const results = await Promise.allSettled(
        activeAgents.map((agentName) =>
          runSpecialist({
            agentName,
            adapter,
            context,
          })
        )
      );

      const findings = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      ).map((finding) => ({
        ...finding,
        metadata: {
          ...finding.metadata,
          snippet: extractSnippetFromPatch(context.changedFiles, finding.path, finding.line),
        },
      }));

      await ctx.runMutation(internal.reviewOrchestration.replaceFindingsForRun, {
        organizationId: run.organizationId,
        pullRequestId: run.pullRequestId,
        runId: args.runId,
        findings,
      });

      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "synthesizing",
        activeAgents,
      });

      const summary = await synthesizeReview({
        adapter,
        prTitle: context.prTitle,
        prBody: context.prBody,
        activeAgents,
        findings,
      });

      const reviewBody = buildGitHubReviewBody(summary, findings);
      let githubReviewId: number | undefined;

      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "posting",
        summary: summary.summary,
      });

      const existingPostedReview = await ctx.runQuery(
        internal.reviewOrchestration.getAppReviewRunByHeadShaInternal,
        {
          pullRequestId: run.pullRequestId,
          headSha: run.headSha,
        }
      );

      if (existingPostedReview?.githubReviewId) {
        githubReviewId = existingPostedReview.githubReviewId;
      } else {
        const [owner, repo] = args.repoFullName.split("/");
        const octokit = await getInstallationClient(args.installationId);
        const { data } = await octokit.request(
          "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
          {
            owner,
            repo,
            pull_number: args.prNumber,
            commit_id: run.headSha,
            body: reviewBody,
            event:
              summary.verdict === "request-changes" ? "REQUEST_CHANGES" : "COMMENT",
          }
        );
        githubReviewId = data.id;
      }

      await ctx.runMutation(internal.reviewOrchestration.publishReviewArtifacts, {
        organizationId: run.organizationId,
        pullRequestId: run.pullRequestId,
        runId: args.runId,
        reviewedHeadSha: run.headSha,
        summary: summary.summary,
        verdict: summary.verdict,
        githubReviewId,
        findings,
      });

      await ctx.runMutation(internal.reviewOrchestration.insertAssistantMessage, {
        orgId: run.organizationId,
        pullRequestId: run.pullRequestId,
        runId: args.runId,
        provider: args.provider,
        role: "assistant",
        content: reviewBody,
      });

      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "completed",
        summary: summary.summary,
        githubReviewId,
        completedAt: Date.now(),
        metrics: {
          filesAnalyzed: context.changedFiles.length,
          diffLines: context.diff.split("\n").length,
          linkedIssuesCount: context.linkedIssues.length,
          findingCount: findings.length,
          activeAgents,
          durationMs: Date.now() - startedAt,
          model: adapter.model,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Review orchestration failed";
      await ctx.runMutation(internal.reviewOrchestration.updateRunStatus, {
        runId: args.runId,
        status: "failed",
        error: message,
        metrics: {
          durationMs: Date.now() - startedAt,
        },
      });
    }
  },
});

export const generateFollowUp = internalAction({
  args: {
    runId: v.id("reviewOrchestrationRuns"),
    pullRequestId: v.id("pullRequests"),
    orgId: v.id("organizations"),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
    userId: v.id("users"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.reviewOrchestration.getRunInternal, {
      runId: args.runId,
    });
    const pullRequest = await ctx.runQuery(internal.aiReviews.getPullRequestInternal, {
      pullRequestId: args.pullRequestId,
    });
    const findings = await ctx.runQuery(internal.reviewOrchestration.getFindingsInternal, {
      runId: args.runId,
    });
    const messages = await ctx.runQuery(internal.reviewOrchestration.getMessagesInternal, {
      runId: args.runId,
    });

    if (!run || !pullRequest) return;

    let anthropicApiKey: string | undefined;
    if (args.provider === "anthropic") {
      const settings = await ctx.runQuery(internal.aiReviews.getSettingsInternal, {
        userId: args.userId,
      });
      if (!settings?.encryptedAnthropicKey) {
        await ctx.runMutation(internal.reviewOrchestration.insertAssistantMessage, {
          orgId: args.orgId,
          pullRequestId: args.pullRequestId,
          runId: args.runId,
          provider: args.provider,
          role: "assistant",
          content: "Claude is selected, but no Anthropic key is currently available in Settings.",
        });
        return;
      }
      const { decryptApiKey } = await import("../lib/ai/crypto");
      anthropicApiKey = decryptApiKey(settings.encryptedAnthropicKey);
    }

    const { createAdapter } = await import("../lib/ai/llm-provider");
    const adapter = createAdapter(args.provider, anthropicApiKey);
    const findingsText =
      findings.length > 0
        ? findings
            .map(
              (finding) =>
                `[${finding.severity}] ${finding.title}${
                  finding.path ? ` (${finding.path}${finding.line ? `:${finding.line}` : ""})` : ""
                }\n${finding.body}`
            )
            .join("\n\n")
        : "No stored findings for this run.";

    const transcript = messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");

    try {
      const response = await adapter.call({
        systemPrompt:
          "You are a pragmatic PR review assistant. Answer with direct, helpful explanations grounded in the stored review.",
        userPrompt: `
PR TITLE:
${pullRequest.title}

PR BODY:
${truncate(pullRequest.body || "No PR body provided.", 1200)}

REVIEW SUMMARY:
${run.summary || "No summary available yet."}

FINDINGS:
${truncate(findingsText, 12000)}

CHAT HISTORY:
${truncate(transcript || "No previous chat history.", 8000)}

USER QUESTION:
${args.message}
        `.trim(),
        temperature: 0.4,
        maxTokens: 1600,
      });

      await ctx.runMutation(internal.reviewOrchestration.insertAssistantMessage, {
        orgId: args.orgId,
        pullRequestId: args.pullRequestId,
        runId: args.runId,
        provider: args.provider,
        role: "assistant",
        content: response,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to generate follow-up";
      await ctx.runMutation(internal.reviewOrchestration.insertAssistantMessage, {
        orgId: args.orgId,
        pullRequestId: args.pullRequestId,
        runId: args.runId,
        provider: args.provider,
        role: "assistant",
        content: `I hit an error while replying: ${message}`,
      });
    }
  },
});
