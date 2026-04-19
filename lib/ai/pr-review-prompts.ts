/**
 * AI PR Review — Prompt Templates
 *
 * All prompts isolated in one file (mirrors KRON's separation pattern).
 * Templates use simple string interpolation, no template engine needed.
 */

import type { PRReviewContext, FileAnalysis } from "./types";

// ════════════════════════════════════════════════════
// STEP 2: File Analysis Prompts
// ════════════════════════════════════════════════════

export const FILE_ANALYSIS_SYSTEM = `You are a code review API that ONLY outputs valid JSON.
You analyze pull request diffs and return structured file analyses.
Never output explanations, markdown, or any text outside the JSON object.
Your entire response must be a single JSON object.`;

export function buildFileAnalysisPrompt(context: PRReviewContext): string {
  const filesSection = context.changedFiles
    .map(
      (f) =>
        `--- ${f.filename} (${f.status}) [+${f.additions} -${f.deletions}]\n${f.patch.substring(0, 3000)}`
    )
    .join("\n\n");

  return `You must respond with ONLY this JSON structure (no other text):
{"analyses": [{"filename": "string", "summary": "string", "issues": ["string"], "quality": "good|acceptable|needs-work"}]}

Now analyze these files from the PR titled "${context.prTitle}":

${context.prBody ? `PR Description: ${context.prBody.substring(0, 800)}\n` : ""}${context.readme ? `Repo README (first 1500 chars): ${context.readme.substring(0, 1500)}\n` : ""}
Changed files:
${filesSection}

For each file: summarize the change, list actionable issues (bugs, missing error handling, anti-patterns), and rate quality. Return the JSON now.`;
}

// ════════════════════════════════════════════════════
// STEP 4: Synthesis Prompts
// ════════════════════════════════════════════════════

export const SYNTHESIS_SYSTEM = `You are a code review API that ONLY outputs valid JSON.
You produce structured pull request reviews.
Never output explanations, markdown, or any text outside the JSON object.
Never reproduce secrets, tokens, or API keys from the diffs.
Your entire response must be a single JSON object.`;

export function buildSynthesisPrompt(
  context: PRReviewContext,
  fileAnalyses: FileAnalysis[],
  relatedFiles: Array<{ path: string; content: string }>
): string {
  const issuesSection =
    context.linkedIssues.length > 0
      ? context.linkedIssues
          .map(
            (i) =>
              `- ${i.identifier}: ${i.title}\n  ${i.body.substring(0, 500)}`
          )
          .join("\n")
      : "None.";

  const relatedSection =
    relatedFiles.length > 0
      ? relatedFiles
          .map((f) => `--- ${f.path}\n${f.content.substring(0, 2000)}`)
          .join("\n\n")
      : "";

  return `You must respond with ONLY this JSON structure (no other text):
{"summary": "string", "intent": "string", "codeQuality": {"score": 1-10, "highlights": ["string"], "concerns": ["string"]}, "potentialIssues": [{"severity": "critical|warning|info", "file": "string", "description": "string", "suggestion": "string"}], "security": {"hasRisks": boolean, "findings": ["string"]}, "tradeoffs": ["string"], "verdict": "approve|request-changes|discuss", "confidence": 0.0-1.0}

PR: "${context.prTitle}"
Description: ${context.prBody.substring(0, 1200)}

Linked issues: ${issuesSection}

File analyses: ${JSON.stringify(fileAnalyses)}

${relatedSection ? `Related files:\n${relatedSection}\n` : ""}Produce the review JSON now. Be balanced: include highlights and concerns. Score 1-10. Only flag real bugs, not style preferences.`;
}

// ════════════════════════════════════════════════════
// CHAT: Follow-up Conversation Prompts
// ════════════════════════════════════════════════════

export const CHAT_SYSTEM = `You are an AI code review assistant. You previously reviewed a pull request and the user is asking follow-up questions.
Be specific — reference file names and line numbers when relevant.
Keep responses concise and actionable.
If asked to explain something from the review, provide more detail and code examples.
If asked about something not covered in the review, use the PR context to give a useful answer.`;

export function buildChatPrompt(
  review: string,
  context: { title: string; body: string; diff: string },
  history: Array<{ role: string; content: string }>,
  question: string
): string {
  const historySection =
    history.length > 0
      ? history
          .slice(-6) // Keep last 6 messages for context window
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n")
      : "No previous conversation.";

  return `YOUR PREVIOUS REVIEW:
${review}

PR CONTEXT:
Title: ${context.title}
Description: ${context.body.substring(0, 800)}
Diff excerpt: ${context.diff.substring(0, 4000)}

CONVERSATION HISTORY:
${historySection}

USER QUESTION: ${question}

Answer concisely and specifically. Reference file names and line numbers when relevant.`;
}
