/**
 * PR Review Step Executor
 *
 * Manual step chain (mirrors KRON hr-manual-chain.ts pattern, lines 366-418).
 * Each step checkpoints its output to Convex via ctx.runMutation.
 * Runs inside a Convex "use node" internalAction (10-min budget).
 *
 * Steps:
 *   1. Gather Context    → GitHub API fetches (no LLM)
 *   2. Analyze Files     → LLM call (batched, 1 call)
 *   3. Expand Context    → GitHub API fetches (conditional, no LLM)
 *   4. Synthesize Review → LLM call (1 call)
 *
 * Total LLM calls: 2 (or 3 including expansion analysis).
 * Estimated time: 15-25 seconds.
 */

import type {
  LLMAdapter,
  PRReviewContext,
  FileAnalysis,
  PRReviewResult,
  ReviewStep,
} from "./types";
import { createAdapter } from "./llm-provider";
import { buildPRContext, fetchRelatedFiles } from "./pr-context-builder";
import {
  FILE_ANALYSIS_SYSTEM,
  buildFileAnalysisPrompt,
  SYNTHESIS_SYSTEM,
  buildSynthesisPrompt,
} from "./pr-review-prompts";

// Type for the Convex action context
interface ActionCtx {
  runMutation: (ref: any, args: any) => Promise<any>;
  runQuery: (ref: any, args: any) => Promise<any>;
}

/**
 * Execute the complete review pipeline.
 * Called from the Convex internalAction.
 */
export async function executeReviewPipeline(
  ctx: ActionCtx,
  reviewId: string,
  internalRefs: {
    updateStep: any;
    completeReview: any;
    failReview: any;
  },
  params: {
    installationId: number;
    repoFullName: string;
    prNumber: number;
    provider: "groq" | "anthropic";
    anthropicApiKey?: string;
  }
): Promise<void> {
  const startTime = Date.now();
  const adapter = createAdapter(params.provider, params.anthropicApiKey);

  try {
    // ════ STEP 1: Gather Context ════════════════════════════
    console.log(`[AI Review] Starting pipeline for ${params.repoFullName}#${params.prNumber}`);
    await checkpoint(ctx, reviewId, "gathering_context", internalRefs);

    const context = await buildPRContext(
      params.installationId,
      params.repoFullName,
      params.prNumber
    );

    await checkpoint(ctx, reviewId, "context_gathered", internalRefs, {
      contextStats: {
        filesAnalyzed: context.changedFiles.length,
        totalDiffLines: context.diff.split("\n").length,
        linkedIssuesCount: context.linkedIssues.length,
        relatedFilesExpanded: 0,
      },
    });

    console.log(
      `[AI Review] Context gathered: ${context.changedFiles.length} files, ` +
        `${context.diff.split("\n").length} diff lines`
    );

    // ════ STEP 2: Analyze Files ═════════════════════════════
    await checkpoint(ctx, reviewId, "analyzing_files", internalRefs);

    const fileAnalyses = await analyzeFiles(adapter, context);
    const needsExpansion = detectExpansionNeed(context, fileAnalyses);

    await checkpoint(ctx, reviewId, "files_analyzed", internalRefs, {
      intermediateData: { fileAnalyses, needsExpansion },
    });

    console.log(
      `[AI Review] Files analyzed: ${fileAnalyses.length} files, ` +
        `needs expansion: ${needsExpansion}`
    );

    // ════ STEP 3: Conditional Expansion ═════════════════════
    let relatedFiles: Array<{ path: string; content: string }> = [];

    if (needsExpansion) {
      await checkpoint(ctx, reviewId, "expanding_context", internalRefs);

      relatedFiles = await fetchRelatedFiles(
        params.installationId,
        params.repoFullName,
        context.changedFiles,
        context.diff
      );

      await checkpoint(ctx, reviewId, "context_expanded", internalRefs, {
        contextStats: {
          filesAnalyzed: context.changedFiles.length,
          totalDiffLines: context.diff.split("\n").length,
          linkedIssuesCount: context.linkedIssues.length,
          relatedFilesExpanded: relatedFiles.length,
        },
      });

      console.log(
        `[AI Review] Context expanded: ${relatedFiles.length} related files`
      );
    }

    // ════ STEP 4: Synthesize Final Review ═══════════════════
    await checkpoint(ctx, reviewId, "synthesizing", internalRefs);

    const review = await synthesizeReview(
      adapter,
      context,
      fileAnalyses,
      relatedFiles
    );

    const processingTimeMs = Date.now() - startTime;

    // Final save
    await ctx.runMutation(internalRefs.completeReview, {
      reviewId,
      review,
      processingTimeMs,
      model: adapter.model,
    });

    console.log(
      `[AI Review] Completed in ${processingTimeMs}ms — verdict: ${review.verdict}, ` +
        `confidence: ${review.confidence}, quality: ${review.codeQuality.score}/10`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const processingTimeMs = Date.now() - startTime;

    console.error(`[AI Review] Failed after ${processingTimeMs}ms:`, message);

    await ctx.runMutation(internalRefs.failReview, {
      reviewId,
      error: message.substring(0, 500), // Truncate for DB storage
      processingTimeMs,
    });
  }
}

// ─── Checkpoint Helper ──────────────────────────────────────

async function checkpoint(
  ctx: ActionCtx,
  reviewId: string,
  step: ReviewStep,
  internalRefs: { updateStep: any },
  data?: Record<string, unknown>
): Promise<void> {
  await ctx.runMutation(internalRefs.updateStep, {
    reviewId,
    step,
    ...data,
  });
}

// ─── Step 2: File Analysis ──────────────────────────────────
// Batches all files into ONE LLM call to minimize cost/time

async function analyzeFiles(
  adapter: LLMAdapter,
  context: PRReviewContext
): Promise<FileAnalysis[]> {
  // If no code files, return empty analysis
  if (context.changedFiles.length === 0) {
    return [];
  }

  const response = await adapter.call({
    systemPrompt: FILE_ANALYSIS_SYSTEM,
    userPrompt: buildFileAnalysisPrompt(context),
    jsonMode: true,
    temperature: 0.2,
    maxTokens: 4096,
  });

  try {
    const parsed = JSON.parse(response);
    return parsed.analyses || [];
  } catch {
    console.error(
      "[AI Review] Failed to parse file analysis JSON, retrying..."
    );
    // Retry with stricter prompt
    const retryResponse = await adapter.call({
      systemPrompt:
        FILE_ANALYSIS_SYSTEM +
        "\nIMPORTANT: Your response MUST be valid JSON. No markdown, no explanation, ONLY the JSON object.",
      userPrompt: buildFileAnalysisPrompt(context),
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 4096,
    });

    const retryParsed = JSON.parse(retryResponse);
    return retryParsed.analyses || [];
  }
}

// ─── Step 3: Expansion Detection ────────────────────────────

function detectExpansionNeed(
  context: PRReviewContext,
  fileAnalyses: FileAnalysis[]
): boolean {
  // Skip if diff is already huge (>2000 lines)
  if (context.diff.split("\n").length > 2000) return false;

  // Skip if only docs/config files changed
  const codeFiles = context.changedFiles.filter(
    (f) =>
      !f.filename.match(/\.(md|json|yaml|yml|toml|lock|txt|csv|svg|png|jpg)$/i)
  );
  if (codeFiles.length === 0) return false;

  // Expand if any file has "needs-work" quality
  const hasProblematicFiles = fileAnalyses.some(
    (a) => a.quality === "needs-work"
  );

  // Expand if there are critical issues
  const hasCriticalIssues = fileAnalyses.some(
    (a) => a.issues.length >= 3
  );

  return hasProblematicFiles || hasCriticalIssues;
}

// ─── Step 4: Synthesis ──────────────────────────────────────

async function synthesizeReview(
  adapter: LLMAdapter,
  context: PRReviewContext,
  fileAnalyses: FileAnalysis[],
  relatedFiles: Array<{ path: string; content: string }>
): Promise<PRReviewResult> {
  const response = await adapter.call({
    systemPrompt: SYNTHESIS_SYSTEM,
    userPrompt: buildSynthesisPrompt(context, fileAnalyses, relatedFiles),
    jsonMode: true,
    temperature: 0.3,
    maxTokens: 4096,
  });

  try {
    const review = JSON.parse(response) as PRReviewResult;

    // Validate structure and set defaults for missing fields
    return {
      summary: review.summary || "Review completed.",
      intent: review.intent || "Not determined.",
      codeQuality: {
        score: Math.min(10, Math.max(1, review.codeQuality?.score || 5)),
        highlights: review.codeQuality?.highlights || [],
        concerns: review.codeQuality?.concerns || [],
      },
      potentialIssues: (review.potentialIssues || []).map((issue) => ({
        severity: (["critical", "warning", "info"].includes(issue.severity)
          ? issue.severity
          : "info") as "critical" | "warning" | "info",
        file: issue.file || "unknown",
        description: issue.description || "",
        suggestion: issue.suggestion,
      })),
      security: {
        hasRisks: review.security?.hasRisks || false,
        findings: review.security?.findings || [],
      },
      tradeoffs: review.tradeoffs || [],
      verdict: (["approve", "request-changes", "discuss"].includes(
        review.verdict
      )
        ? review.verdict
        : "discuss") as "approve" | "request-changes" | "discuss",
      confidence: Math.min(1, Math.max(0, review.confidence || 0.5)),
    };
  } catch {
    console.error(
      "[AI Review] Failed to parse synthesis JSON, retrying..."
    );
    // Retry with stricter prompt
    const retryResponse = await adapter.call({
      systemPrompt:
        SYNTHESIS_SYSTEM +
        "\nIMPORTANT: Your response MUST be valid JSON. No markdown, no explanation, ONLY the JSON object.",
      userPrompt: buildSynthesisPrompt(context, fileAnalyses, relatedFiles),
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 4096,
    });

    return JSON.parse(retryResponse) as PRReviewResult;
  }
}
