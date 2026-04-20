"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ExternalLink, Loader2, RefreshCw, Plus, ChevronDown, Mic, ArrowUp, ChevronRight, Bot } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type ReviewFilter = "all" | "copilot" | "github" | "outdated"

type ReviewIssue = {
  severity?: string
  file?: string
  description?: string
  suggestion?: string
}

type ReviewMessage = {
  role?: string
  content?: string
  createdAt?: number
}

type ReviewThreadComment = {
  authorGithubUsername?: string
  body: string
  role?: string
}

type ReviewThread = {
  _id: string
  title?: string
  path?: string
  source?: string
  severity?: string
  freshness?: string
  summary?: string
  metadata?: { suggestion?: string }
  line?: number
  snippet?: string
  comments?: ReviewThreadComment[]
}

type ReviewHub = {
  freshness?: { isFresh?: boolean }
  stats?: { openThreads?: number }
}

type ReviewResult = {
  summary?: string
  verdict?: string
  confidence?: number
  potentialIssues?: ReviewIssue[]
  nextSteps?: string[]
}

type ReviewRun = {
  step?: string
  activeAgents?: string[]
  review?: ReviewResult
  error?: string
}

type PullReviewChatProps = {
  repoLabel: string
  prTitle?: string
  aiReview: ReviewRun | null
  aiChatMessages: ReviewMessage[] | null
  reviewHub: ReviewHub | null
  filteredReviewThreads: ReviewThread[]
  selectedThreadId: string | null
  selectedReviewThread: ReviewThread | null
  selectedThreadComments: ReviewThreadComment[]
  reviewSourceFilter: ReviewFilter
  setReviewSourceFilter: (filter: ReviewFilter) => void
  setSelectedThreadId: (id: string) => void
  chatInput: string
  setChatInput: (value: string) => void
  handleTriggerReview: () => void
  handleSendChat: () => void
  handleRefreshReviews: (forceAppSummary?: boolean) => void
  isTriggering: boolean
  isRefreshingReviews: boolean
  githubUrl?: string
  reviewStatusLabel: string
  reviewSourceLabel: string
  reviewFreshnessLabel: string
  staleReviewReason: string | null
  additions: number
  deletions: number
  changedFiles: number
}

type InlineEntry = {
  id: string
  title: string
  source: string
  severity: string
  summary: string
  suggestion?: string
  path?: string
  line?: number
  snippet?: string
  comments: Array<{
    author?: string
    body: string
    role?: string
  }>
}

const filterOptions: ReviewFilter[] = ["all", "github", "copilot", "outdated"]

function prettyFilterLabel(value: ReviewFilter) {
  if (value === "all") return "All"
  if (value === "github") return "GitHub"
  if (value === "copilot") return "Copilot"
  return "Outdated"
}

function severityTone(severity?: string) {
  if (severity === "critical") return "text-red-500 font-medium"
  if (severity === "warning") return "text-amber-500 font-medium"
  return "text-muted-foreground"
}

function statusDotClass(label: string) {
  const text = label.toLowerCase()
  if (text.includes("completed") || text.includes("current")) return "bg-emerald-500"
  if (text.includes("failed") || text.includes("changes")) return "bg-red-500"
  if (text.includes("running") || text.includes("pending") || text.includes("refresh")) return "bg-amber-500"
  return "bg-muted-foreground/50"
}

function humanSourceLabel(source?: string) {
  if (source === "copilot") return "Copilot"
  if (source === "github") return "GitHub"
  if (source === "app_ai") return "Eganow AI"
  return source || "Review"
}

function sectionShellClasses(extra?: string) {
  return `rounded-2xl border border-border/40 bg-muted/[0.04] p-6 shadow-none ${extra || ""}`.trim()
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 text-[12px] leading-6 text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

function CleanBulletList({
  items,
  tone = "neutral",
}: {
  items: string[]
  tone?: "neutral" | "good" | "warn"
}) {
  const bulletClass =
    tone === "good"
      ? "bg-emerald-500/75"
      : tone === "warn"
        ? "bg-amber-500/75"
        : "bg-muted-foreground/50"

  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-start gap-3 text-[13px] leading-7 text-muted-foreground">
          <span className={`mt-2.5 size-1.5 shrink-0 rounded-full ${bulletClass}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function ReviewSnippet({ code }: { code: string }) {
  const lines = React.useMemo(() => code.trimEnd().split("\n"), [code])

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/40 bg-background">
      <div className="border-b border-border/40 bg-muted/10 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Code Reference
      </div>
      <div className="overflow-x-auto text-[12px] [&::-webkit-scrollbar]:hidden">
        {lines.map((line, index) => {
          const isHunk = line.startsWith("@@")
          const isInsert = line.startsWith("+") && !line.startsWith("+++")
          const isDelete = line.startsWith("-") && !line.startsWith("---")
          const tone = isHunk
            ? {
                row: "bg-muted/20 text-muted-foreground",
                gutter: "bg-muted/30 text-muted-foreground/80",
              }
            : isInsert
              ? {
                  row: "bg-emerald-500/10 text-foreground",
                  gutter: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300",
                }
              : isDelete
                ? {
                    row: "bg-red-500/10 text-foreground",
                    gutter: "bg-red-500/20 text-red-600 dark:text-red-300",
                  }
                : {
                    row: "bg-background text-foreground/90",
                    gutter: "bg-muted/10 text-muted-foreground/70",
                  }

          const marker = isHunk ? "@@" : isInsert ? "+" : isDelete ? "-" : " "
          const content = isHunk ? line : isInsert || isDelete ? line.slice(1) : line

          return (
            <div
              key={`${index}-${line}`}
              className={`grid min-w-full grid-cols-[46px_minmax(0,1fr)] font-mono leading-6 ${tone.row}`}
            >
              <div className={`border-r border-border/30 px-3 py-1 text-right ${tone.gutter}`}>
                {marker}
              </div>
              <div className="whitespace-pre px-3 py-1">{content || " "}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewBodyBlock({ text }: { text: string }) {
  const blocks = React.useMemo(
    () =>
      text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean),
    [text]
  )

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const isDivider = block === "---"
        if (isDivider) {
          return <div key={`divider-${index}`} className="border-t border-border/40" />
        }

        const isHeading = /^[A-Z][A-Za-z\s-]+:?$/.test(block) && block.split("\n").length === 1 && block.length < 40

        if (isHeading) {
          return (
            <h4 key={`heading-${index}`} className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {block.replace(/:$/, "")}
            </h4>
          )
        }

        if (block.includes("\n- ")) {
          const [lead, ...rest] = block.split("\n")
          const items = rest.map((item) => item.replace(/^- /, "").trim()).filter(Boolean)
          return (
            <div key={`list-${index}`} className="space-y-3">
              {lead && lead !== rest[0] && (
                <p className="text-[13px] leading-7 text-muted-foreground">{lead}</p>
              )}
              {items.length > 0 && <CleanBulletList items={items} />}
            </div>
          )
        }

        return (
          <p key={`paragraph-${index}`} className="text-[13px] leading-7 text-muted-foreground whitespace-pre-wrap">
            {block}
          </p>
        )
      })}
    </div>
  )
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:mb-2 prose-headings:mt-0 prose-headings:text-foreground prose-p:my-0 prose-p:text-[13px] prose-p:leading-7 prose-p:text-muted-foreground prose-strong:text-foreground prose-ol:my-2 prose-ol:pl-5 prose-ol:text-[13px] prose-ol:leading-7 prose-ol:text-muted-foreground prose-ul:my-2 prose-ul:pl-5 prose-ul:text-[13px] prose-ul:leading-7 prose-ul:text-muted-foreground prose-li:my-1 prose-code:rounded prose-code:bg-muted/30 prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function PullReviewChat(props: PullReviewChatProps) {
  const {
    repoLabel,
    prTitle,
    aiReview,
    aiChatMessages,
    reviewHub,
    filteredReviewThreads,
    reviewSourceFilter,
    setReviewSourceFilter,
    chatInput,
    setChatInput,
    handleTriggerReview,
    handleSendChat,
    handleRefreshReviews,
    isTriggering,
    isRefreshingReviews,
    githubUrl,
    reviewStatusLabel,
    reviewSourceLabel,
    reviewFreshnessLabel,
    staleReviewReason,
    additions,
    deletions,
    changedFiles,
  } = props

  const hasCompletedReview = aiReview?.step === "completed" && !!aiReview?.review
  const isRunning = !!aiReview && aiReview.step !== "completed" && aiReview.step !== "failed"
  const review = aiReview?.review
  const allMessages = aiChatMessages ?? []
  
  const initialAssistantReview =
    hasCompletedReview && allMessages[0]?.role === "assistant" ? allMessages[0].content : null

  const followUpMessages =
    hasCompletedReview && allMessages[0]?.role === "assistant"
      ? allMessages.slice(1)
      : allMessages
  const hasAnyReviewContent = !!aiReview || allMessages.length > 0

  const inlineEntries: InlineEntry[] =
    filteredReviewThreads.length > 0
      ? filteredReviewThreads.map((thread: ReviewThread) => ({
          id: String(thread._id),
          title: thread.title || thread.path || "Review note",
          source: humanSourceLabel(thread.source),
          severity: thread.severity || (thread.freshness === "stale" ? "warning" : "info"),
          summary: thread.summary || "Open this note for more context.",
          suggestion: thread.metadata?.suggestion,
          path: thread.path,
          line: thread.line,
          snippet: thread.snippet,
          comments: (thread.comments || []).map((comment: ReviewThreadComment) => ({
            author: comment.authorGithubUsername,
            body: comment.body,
            role: comment.role,
          })),
        }))
      : (review?.potentialIssues || []).map((issue: ReviewIssue, index: number) => ({
          id: `issue-${index}`,
          title: issue.file || `Finding ${index + 1}`,
          source: reviewSourceLabel,
          severity: issue.severity || "info",
          summary: issue.description || "No detail provided.",
          suggestion: issue.suggestion,
          path: issue.file,
          comments: [],
        }))

  const concernItems =
    inlineEntries.length > 0
      ? inlineEntries.slice(0, 4).map((entry) => entry.summary)
      : review?.nextSteps?.length
        ? review.nextSteps.slice(0, 4)
        : hasCompletedReview
          ? ["No major concern was expanded into an inline note in this pass."]
          : []

  const healthyItems = (() => {
    const items: string[] = []
    if (hasCompletedReview && review?.verdict !== "request-changes") {
      items.push("No blocking issue was raised in this pass.")
    }
    if (reviewHub?.freshness?.isFresh) {
      items.push("The review matches the current head commit.")
    }
    if ((reviewHub?.stats?.openThreads || 0) === 0) {
      items.push("There are no unresolved synced review threads.")
    }
    if (changedFiles <= 8) {
      items.push("The change set is still compact enough for a focused review.")
    }
    return items.slice(0, 3)
  })()

  const nextStepItems = (() => {
    const suggestions = inlineEntries
      .map((entry) => entry.suggestion)
      .filter((value): value is string => !!value)
    if (suggestions.length > 0) return suggestions.slice(0, 4)
    if (review?.nextSteps?.length) return review.nextSteps.slice(0, 4)
    if (staleReviewReason) return ["Refresh the review so the analysis matches the latest commit."]
    return []
  })()

  return (
    <div className="relative flex h-full w-[33.333%] shrink-0 flex-col border-l border-border/40 bg-background text-foreground overflow-hidden">
      
      {/* Scrollable Document Area */}
      <div className={`flex-1 overflow-y-auto px-16 py-12 [&::-webkit-scrollbar]:hidden ${hasAnyReviewContent ? "" : "flex items-center justify-center"}`}>
        <div className="max-w-3xl mx-auto w-full">
        
        {/* Top Health Indicators */}
        {hasAnyReviewContent && (
        <div className="flex flex-col items-start gap-1 pb-8">
          <div className="group flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            Review status <ChevronRight className="size-3.5 opacity-50 transition-transform group-hover:translate-x-0.5" />
          </div>
          
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground/80">
            <span className="flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${statusDotClass(reviewStatusLabel)}`} />
              {reviewStatusLabel}
            </span>
            <span>&bull;</span>
            <span className="flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${statusDotClass(reviewFreshnessLabel)}`} />
              {reviewFreshnessLabel}
            </span>
            <span>&bull;</span>
            <span>{reviewSourceLabel}</span>
            <span>&bull;</span>
            <span className="flex items-center gap-1.5 font-mono">
              <span className="text-emerald-500 font-medium bg-emerald-500/10 px-1 rounded">+{additions}</span>
              <span className="text-red-500 font-medium bg-red-500/10 px-1 rounded">-{deletions}</span>
              <span>{changedFiles} files</span>
            </span>
          </div>

          <div className="flex items-center gap-2 mt-4">
             <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-full border-border/50 bg-transparent px-3 text-[11px] text-muted-foreground shadow-none hover:bg-muted"
                onClick={() => handleRefreshReviews(true)}
                disabled={isRefreshingReviews}
              >
                {isRefreshingReviews ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
                Refresh
              </Button>
              {githubUrl && (
                <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm" className="h-7 rounded-full px-3 text-[11px] text-muted-foreground shadow-none hover:bg-muted">
                    GitHub <ExternalLink className="size-3 ml-1" />
                  </Button>
                </a>
              )}
          </div>
        </div>
        )}

        {/* Content Body */}
        <div className="w-full">
          {hasAnyReviewContent && (
          <div className="mb-8">
            <h1 className="text-[18px] font-semibold text-foreground tracking-tight">
              {prTitle ? `Review: ${prTitle}` : "Pull Request Review"}
            </h1>
            <div className="mt-1 text-[13px] text-muted-foreground">
              {repoLabel}
            </div>
          </div>
          )}

          {!aiReview && allMessages.length === 0 && (
            <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-border/40 bg-muted/[0.05]">
                <Bot className="size-11 text-foreground/90" strokeWidth={1.7} />
              </div>

              <div className="mt-7 space-y-2">
                <h1 className="text-[27px] font-semibold tracking-tight text-foreground">
                  Let&apos;s review this pull request
                </h1>
                <p className="text-[15px] font-medium text-muted-foreground/80">
                  {repoLabel}
                </p>
              </div>

              <p className="mt-5 max-w-xl text-[13px] leading-6 text-muted-foreground">
                Run a full AI review to generate a clear summary, highlight important risks, and leave focused file-level suggestions for this PR.
              </p>

              <div className="mt-4 rounded-full border border-border/40 bg-muted/[0.04] px-3 py-1.5 text-[11px] text-muted-foreground">
                Review orchestration is still under development and being tuned for optimal performance.
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button
                  onClick={handleTriggerReview}
                  disabled={isTriggering}
                  className="h-10 rounded-full bg-foreground px-5 text-[13px] text-background shadow-none hover:bg-foreground/85"
                >
                  {isTriggering ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Run full review
                </Button>
                {githubUrl && (
                  <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                    <Button
                      variant="outline"
                      className="h-10 rounded-full border-border/50 bg-transparent px-5 text-[13px] text-muted-foreground shadow-none hover:bg-muted"
                    >
                      Open on GitHub
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )}

          {(aiReview || allMessages.length > 0) && (
            <div className="flex flex-col gap-6 pb-10">
              
              {/* Summary Section */}
              <section className={sectionShellClasses()}>
                <SectionHeader title="Summary" />
                <p className="text-[14px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {hasCompletedReview
                    ? review?.summary
                    : isRunning
                      ? `The review is currently running across ${changedFiles} changed files. The orchestration is gathering findings and will publish a written summary here once that pass completes.`
                      : aiReview?.step === "failed"
                        ? aiReview?.error || "The review did not complete successfully."
                        : "Review context is ready, but a completed summary is not available yet."}
                </p>
                {staleReviewReason && (
                  <p className="mt-3 text-[13px] leading-relaxed text-amber-500/80">
                    {staleReviewReason}
                  </p>
                )}
              </section>

              {/* High-Level Feedback */}
              {hasCompletedReview && (
                <section className={sectionShellClasses()}>
                  <SectionHeader title="High-Level Feedback" description="A quick pass on what feels solid, what needs attention, and what to do next." />
                  
                  <div className="space-y-5 divide-y divide-border/30">
                    {healthyItems.length > 0 && (
                      <div className="pb-5">
                        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">What looks healthy</div>
                        <CleanBulletList items={healthyItems} tone="good" />
                      </div>
                    )}

                    {concernItems.length > 0 && (
                      <div className="py-5">
                        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">What needs attention</div>
                        <CleanBulletList items={concernItems} tone="warn" />
                      </div>
                    )}

                    {nextStepItems.length > 0 && (
                      <div className="pt-5">
                        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Suggested next steps</div>
                        <CleanBulletList items={nextStepItems} />
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Initial Assistant Review String (if provided) */}
              {initialAssistantReview && (
                 <section className={sectionShellClasses()}>
                   <SectionHeader title="Detailed Review" description="The full written review exactly as generated by the review orchestration." />
                   <ReviewBodyBlock text={initialAssistantReview} />
                 </section>
              )}

              {/* Inline Comments */}
              {(hasCompletedReview || inlineEntries.length > 0) && (
                <section className={sectionShellClasses()}>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <SectionHeader title="Inline Comments" description="Focused findings tied to files, references, and suggested fixes." />
                    {filteredReviewThreads.length > 0 && (
                      <div className="flex bg-muted/30 rounded-md p-0.5 border border-border/30">
                        {filterOptions.map((option) => (
                          <button
                            key={option}
                            onClick={() => setReviewSourceFilter(option)}
                            className={`px-3 py-1 text-[11px] font-medium rounded-sm transition-colors ${
                              reviewSourceFilter === option
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {prettyFilterLabel(option)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {inlineEntries.length === 0 ? (
                    <p className="text-[14px] leading-relaxed text-muted-foreground italic">
                      No inline comments generated.
                    </p>
                  ) : (
                    <div className="rounded-xl border border-border/40 bg-background divide-y divide-border/30">
                      {inlineEntries.slice(0, 8).map((entry, index) => (
                        <div key={entry.id} className="p-5 transition-colors">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[12px] text-foreground/80">{entry.path || "General"}</span>
                                {entry.line ? (
                                  <span className="rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground">
                                    line {entry.line}
                                  </span>
                                ) : null}
                              </div>
                              <div className={`text-[11px] ${severityTone(entry.severity)}`}>{entry.source}</div>
                            </div>

                            <div className="border-t border-border/30 pt-3">
                              <p className="text-[13px] leading-7 text-muted-foreground whitespace-pre-wrap">
                                 {entry.summary}
                              </p>
                            </div>

                            {entry.comments.length > 0 && (
                              <div className="mt-1 space-y-2 border-t border-border/30 pt-3">
                                {entry.comments.map((comment, commentIndex) => (
                                  <div key={`${entry.id}-comment-${commentIndex}`} className="rounded-lg bg-muted/20 px-3 py-2.5">
                                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                      {comment.author || (comment.role === "assistant" ? "Eganow AI" : "Comment")}
                                    </div>
                                    <p className="text-[12px] leading-6 text-muted-foreground whitespace-pre-wrap">
                                      {comment.body}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {entry.snippet && (
                               <ReviewSnippet code={entry.snippet} />
                            )}

                            {entry.suggestion && (
                               <div className="mt-1 rounded-xl border border-border/40 bg-muted/20 p-3.5">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Suggestion</div>
                                  <p className="mt-1.5 text-[13px] leading-7 text-muted-foreground">
                                    {entry.suggestion}
                                  </p>
                               </div>
                            )}

                            {index < inlineEntries.slice(0, 8).length - 1 && (
                              <div className="pt-1" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Follow-up Conversation */}
              {followUpMessages.length > 0 && (
                 <section className={sectionShellClasses()}>
                   <SectionHeader title="Follow-up Conversation" description="Questions and clarifications after the main review pass." />
                   <div className="space-y-4">
                      {followUpMessages.map((msg, idx) => (
                         <div key={idx} className="rounded-xl border border-border/30 bg-background px-4 py-3">
                            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                               {msg.role === "user" ? "You" : "Eganow AI"}
                            </div>
                            {msg.role === "assistant" ? (
                              <MarkdownMessage content={msg.content || ""} />
                            ) : (
                              <div className="text-[13px] leading-7 text-muted-foreground whitespace-pre-wrap">
                                {msg.content}
                              </div>
                            )}
                         </div>
                      ))}
                   </div>
                 </section>
              )}

            </div>
          )}
        </div>
        </div>
      </div>

      {/* Composer Input matching AI layout */}
      {hasAnyReviewContent && (
      <div className="px-16 py-5 bg-background border-t border-border/40 shrink-0">
         <div className="max-w-3xl mx-auto w-full">
           <div className="rounded-2xl border border-border/60 bg-muted/20 shadow-sm focus-within:ring-1 focus-within:ring-border/80 focus-within:border-border/80 transition-all flex flex-col pt-3 pb-2 px-3">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (hasCompletedReview) handleSendChat()
                }
              }}
              placeholder={
                hasCompletedReview
                  ? "Ask for follow-up changes..."
                  : "Run a review first or draft a question..."
              }
              className="w-full min-h-[44px] max-h-[200px] resize-none border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 px-1"
            />
            
            <div className="mt-1 flex items-center justify-between">
               <div className="flex items-center space-x-1">
                 <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted/50 transition-colors">
                   <Plus className="size-3.5" />
                 </Button>
                 <div className="flex items-center gap-1.5 rounded-md hover:bg-muted/50 px-2 py-1 cursor-pointer transition-colors">
                    <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                       Eganow-AI <ChevronDown className="size-3 opacity-60" />
                    </span>
                 </div>
                 <div className="flex items-center gap-1.5 rounded-md hover:bg-muted/50 px-2 py-1 cursor-pointer transition-colors">
                    <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                       High <ChevronDown className="size-3 opacity-60" />
                    </span>
                 </div>
               </div>

               <div className="flex items-center space-x-1">
                 <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted/50 transition-colors">
                   <Mic className="size-3.5" />
                 </Button>
                 <Button 
                   size="icon" 
                   onClick={hasCompletedReview ? handleSendChat : handleTriggerReview}
                   disabled={!hasCompletedReview && isTriggering}
                   className="h-7 w-7 rounded-full bg-foreground text-background hover:bg-foreground/80 transition-colors shadow-none ml-1 flex items-center justify-center">
                   {(!hasCompletedReview && isTriggering) ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                 </Button>
               </div>
               </div>
            </div>
         </div>
      </div>
      )}
      
    </div>
  )
}
