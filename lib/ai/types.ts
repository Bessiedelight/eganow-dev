/**
 * AI PR Review — Type Definitions
 *
 * Centralized types for the review orchestration system.
 * Mirrors KRON's hr-manual-types.ts pattern.
 */

// ─── Provider Adapter Interface ───────────────────────────────
// Solves provider abstraction leaks (Groq ≠ Anthropic)

export interface LLMAdapter {
  readonly provider: "groq" | "anthropic";
  readonly model: string;
  call(params: LLMCallParams): Promise<string>;
}

export interface LLMCallParams {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number; // default: 0.3
  maxTokens?: number; // default: 4096
  jsonMode?: boolean; // default: false
}

// ─── Review Step (Checkpointed) ───────────────────────────────
// Each step writes to Convex DB — crash-safe

export type ReviewStep =
  | "pending" // Created, not started
  | "gathering_context" // Step 1 running
  | "context_gathered" // Step 1 done (checkpoint 1)
  | "analyzing_files" // Step 2 running
  | "files_analyzed" // Step 2 done (checkpoint 2)
  | "expanding_context" // Step 3 running (conditional)
  | "context_expanded" // Step 3 done (checkpoint 3)
  | "synthesizing" // Step 4 running
  | "completed" // Step 4 done (final)
  | "failed"; // Error at any step

// ─── PR Review Context ───────────────────────────────────────

export interface PRReviewContext {
  prTitle: string;
  prBody: string;
  diff: string;
  changedFiles: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string;
  }>;
  linkedIssues: Array<{
    identifier: string;
    title: string;
    body: string;
  }>;
  readme: string;
}

// ─── File Analysis (Step 2 output) ────────────────────────────

export interface FileAnalysis {
  filename: string;
  summary: string;
  issues: string[];
  quality: "good" | "acceptable" | "needs-work";
}

// ─── Final Review Result ──────────────────────────────────────

export interface PRReviewResult {
  summary: string;
  intent: string;
  codeQuality: {
    score: number; // 1-10
    highlights: string[];
    concerns: string[];
  };
  potentialIssues: Array<{
    severity: "critical" | "warning" | "info";
    file: string;
    description: string;
    suggestion?: string;
  }>;
  security: {
    hasRisks: boolean;
    findings: string[];
  };
  tradeoffs: string[];
  verdict: "approve" | "request-changes" | "discuss";
  confidence: number; // 0.0-1.0
}

// ─── Encrypted Value Format ──────────────────────────────────
// Versioned to allow future key rotation

export interface EncryptedValue {
  v: 1; // Encryption version
  ct: string; // Ciphertext (hex)
  iv: string; // Initialization vector (hex)
  tag: string; // Auth tag (hex)
}

// ─── Context Stats (persisted at checkpoints) ─────────────────

export interface ReviewContextStats {
  filesAnalyzed: number;
  totalDiffLines: number;
  linkedIssuesCount: number;
  relatedFilesExpanded: number;
}

// ─── Rate Limit Info ──────────────────────────────────────────

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date;
}
