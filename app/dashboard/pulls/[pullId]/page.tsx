"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { fetchPullRequestDetail, fetchCommitDetail, fetchBranchDetail, createGitHubPullRequest } from "@/lib/github/actions"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PullReviewChat } from "@/components/pull-review-chat"
import { AutoGrowTextarea } from "@/components/auto-grow-textarea"
import { gsap } from "gsap"

import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"

import {
  GitPullRequest, GitMerge, ChevronRight, CheckCircle2, CircleDashed, Users,
  MessageSquare, FileCode2, Activity, MoreHorizontal,
  MessageCircle, Star, Link2, Copy, GitFork, ChevronDown,
  Paperclip, User, Tag, GitBranch, Bot,
  XCircle, RefreshCw, FolderKanban, Check, Clock, CalendarDays, GitCommit, ShieldCheck,
  Loader2
} from "lucide-react"

function getInitials(name: string) {
  return name.split(/[\s._-]+/).map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "just now"
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// â”€â”€â”€ Editable Property Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function EditablePropertyRow({ label, icon: Icon, children }: {
  label: string; icon: any; children: React.ReactNode
}) {
  return (
    <div className="flex items-center text-[13px] font-medium text-foreground py-1.5 rounded-md px-2 -mx-2">
      <div className="w-[100px] flex items-center gap-2.5 text-muted-foreground/80 shrink-0">
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center">{children}</div>
    </div>
  )
}

// â”€â”€â”€ Read-Only Property Row (GitHub-controlled) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ReadOnlyPropertyRow({ label, value, icon, iconColor = "text-muted-foreground" }: {
  label: string; value: React.ReactNode; icon: any; iconColor?: string
}) {
  const Icon = icon
  return (
    <div className="flex items-center text-[13px] font-medium text-foreground py-1.5 rounded-md px-2 -mx-2">
      <div className="w-[100px] flex items-center gap-2.5 text-muted-foreground/80 shrink-0">
        <Icon className={`size-4 shrink-0 ${iconColor}`} />
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center">{value}</div>
    </div>
  )
}

type ParsedInlineReviewItem = {
  title: string
  issue?: string
  reference?: string
  code?: string
  suggestion?: string
}

type ParsedActivityReview = {
  title?: string
  summary?: string
  health: string[]
  healthy: string[]
  inlineComments: ParsedInlineReviewItem[]
  nextSteps: string[]
}

function parseStructuredReviewBody(body: string): ParsedActivityReview | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const parsed: ParsedActivityReview = {
    health: [],
    healthy: [],
    inlineComments: [],
    nextSteps: [],
  }

  let section: "summary" | "health" | "healthy" | "inline" | "next" | null = null
  let currentItem: ParsedInlineReviewItem | null = null
  let readingCode = false
  const summaryParts: string[] = []

  const flushInlineItem = () => {
    if (!currentItem) return
    parsed.inlineComments.push({
      ...currentItem,
      code: currentItem.code?.trim() || undefined,
    })
    currentItem = null
    readingCode = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      if (readingCode) {
        readingCode = false
      } else if (section === "inline") {
        flushInlineItem()
      }
      continue
    }

    if (trimmed === "Pull Request Review" || trimmed === "Pull Request Review Summary") {
      parsed.title = trimmed
      continue
    }
    if (trimmed === "Summary") {
      flushInlineItem()
      section = "summary"
      continue
    }
    if (trimmed === "Health") {
      flushInlineItem()
      section = "health"
      continue
    }
    if (trimmed === "What looks healthy:") {
      flushInlineItem()
      section = "healthy"
      continue
    }
    if (trimmed === "Inline comments:") {
      flushInlineItem()
      section = "inline"
      continue
    }
    if (trimmed === "Suggested next steps:") {
      flushInlineItem()
      section = "next"
      continue
    }
    if (trimmed === "---") {
      flushInlineItem()
      continue
    }

    if (section === "summary") {
      summaryParts.push(trimmed)
      continue
    }

    if (section === "health" && trimmed.startsWith("- ")) {
      parsed.health.push(trimmed.slice(2))
      continue
    }

    if (section === "healthy" && trimmed.startsWith("- ")) {
      parsed.healthy.push(trimmed.slice(2))
      continue
    }

    if (section === "next" && trimmed.startsWith("- ")) {
      parsed.nextSteps.push(trimmed.slice(2))
      continue
    }

    if (section === "inline") {
      if (!currentItem) {
        currentItem = { title: trimmed }
        continue
      }

      if (readingCode) {
        if (trimmed.startsWith("Suggestion: ")) {
          currentItem.suggestion = trimmed.slice("Suggestion: ".length)
          readingCode = false
        } else {
          currentItem.code = currentItem.code ? `${currentItem.code}\n${line}` : line
        }
        continue
      }

      if (trimmed.startsWith("Issue: ")) {
        currentItem.issue = trimmed.slice("Issue: ".length)
        continue
      }
      if (trimmed.startsWith("Reference: ")) {
        currentItem.reference = trimmed.slice("Reference: ".length)
        continue
      }
      if (trimmed === "Code:") {
        currentItem.code = ""
        readingCode = true
        continue
      }
      if (trimmed.startsWith("Suggestion: ")) {
        currentItem.suggestion = trimmed.slice("Suggestion: ".length)
        continue
      }

      flushInlineItem()
      currentItem = { title: trimmed }
    }
  }

  flushInlineItem()
  parsed.summary = summaryParts.join(" ").trim()

  if (!parsed.summary && parsed.inlineComments.length === 0 && parsed.nextSteps.length === 0) {
    return null
  }

  return parsed
}

function getReviewIndicatorTone(value: string) {
  const normalized = value.toLowerCase()

  if (
    normalized.includes("request-changes") ||
    normalized.includes("critical") ||
    normalized.includes("high") ||
    normalized.includes("risk")
  ) {
    return {
      dot: "bg-red-500/80",
      pill: "border-red-500/20 bg-red-500/10 text-red-500",
      bullet: "bg-red-500/75",
    }
  }

  if (
    normalized.includes("comment") ||
    normalized.includes("medium") ||
    normalized.includes("warning") ||
    normalized.includes("watch")
  ) {
    return {
      dot: "bg-amber-500/80",
      pill: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300",
      bullet: "bg-amber-500/75",
    }
  }

  if (
    normalized.includes("healthy") ||
    normalized.includes("good") ||
    normalized.includes("pass") ||
    normalized.includes("low")
  ) {
    return {
      dot: "bg-emerald-500/80",
      pill: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      bullet: "bg-emerald-500/75",
    }
  }

  return {
    dot: "bg-muted-foreground/60",
    pill: "border-border/60 bg-muted/20 text-muted-foreground",
    bullet: "bg-muted-foreground/55",
  }
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
          const content =
            isHunk ? line : isInsert || isDelete ? line.slice(1) : line

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

function ReviewActivityBody({ body }: { body: string }) {
  const [expanded, setExpanded] = React.useState(false)
  const parsed = React.useMemo(() => parseStructuredReviewBody(body), [body])
  const detailsRef = React.useRef<HTMLDivElement>(null)
  const hasAnimatedRef = React.useRef(false)

  const previewText = parsed?.summary || body
  const compactText =
    previewText.length > 260 ? `${previewText.slice(0, 260).trimEnd()}...` : previewText
  const shouldCollapse = body.length > 320 || !!parsed
  const displayText = parsed && expanded ? previewText : compactText

  React.useLayoutEffect(() => {
    const el = detailsRef.current
    if (!el) return

    gsap.killTweensOf(el)

    if (!hasAnimatedRef.current) {
      gsap.set(el, {
        display: expanded ? "block" : "none",
        height: expanded ? "auto" : 0,
        opacity: expanded ? 1 : 0,
      })
      hasAnimatedRef.current = true
      return
    }

    if (expanded) {
      gsap.set(el, { display: "block", height: 0, opacity: 0, overflow: "hidden" })
      gsap.to(el, {
        height: "auto",
        opacity: 1,
        duration: 0.3,
        ease: "power2.out",
        clearProps: "height,overflow",
      })
      return
    }

    gsap.set(el, { height: el.offsetHeight, overflow: "hidden" })
    gsap.to(el, {
      height: 0,
      opacity: 0,
      duration: 0.24,
      ease: "power2.inOut",
      onComplete: () => {
        gsap.set(el, { display: "none" })
      },
    })

    return () => {
      gsap.killTweensOf(el)
    }
  }, [expanded])

  return (
    <div className="p-4 py-3">
      <div className="max-w-none">
        <p className="text-[13px] leading-7 text-foreground/90 whitespace-pre-wrap">{displayText}</p>

        {parsed && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {parsed.health.slice(0, 2).map((item) => {
              const tone = getReviewIndicatorTone(item)
              return (
                <span
                  key={item}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${tone.pill}`}
                >
                  <span className={`size-1.5 rounded-full ${tone.dot}`} />
                  {item}
                </span>
              )
            })}
            {parsed.inlineComments.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/20 px-2.5 py-1 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                {parsed.inlineComments.length} inline note{parsed.inlineComments.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        <div ref={detailsRef}>
          {parsed ? (
            <div className="mt-5 space-y-5 border-t border-border/40 pt-5">
              {parsed.health.length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Health
                  </h4>
                  <ul className="mt-3 space-y-2.5 text-[13px] leading-7 text-foreground/90">
                    {parsed.health.map((item) => {
                      const tone = getReviewIndicatorTone(item)
                      return (
                        <li key={item} className="flex gap-2.5">
                          <span className={`mt-2 size-1.5 shrink-0 rounded-full ${tone.bullet}`} />
                          <span>{item}</span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {parsed.healthy.length > 0 && (
                <section className="border-t border-border/30 pt-5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    What Looks Healthy
                  </h4>
                  <ul className="mt-3 space-y-2.5 text-[13px] leading-7 text-foreground/90">
                    {parsed.healthy.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500/75" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {parsed.inlineComments.length > 0 && (
                <section className="border-t border-border/30 pt-5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Inline Comments
                  </h4>
                  <div className="mt-4 space-y-4">
                    {parsed.inlineComments.map((item, index) => (
                      <article
                        key={`${item.title}-${index}`}
                        className="rounded-xl border border-border/40 bg-muted/[0.03] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h5 className="text-[13px] font-semibold text-foreground">
                            {index + 1}. {item.title}
                          </h5>
                          {item.reference && (
                            <div className="rounded-full border border-border/40 bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground">
                              {item.reference}
                            </div>
                          )}
                        </div>

                        {item.issue && (
                          <div className="mt-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              Issue
                            </div>
                            <p className="mt-1.5 text-[13px] leading-7 text-foreground/90">{item.issue}</p>
                          </div>
                        )}

                        {item.code && <ReviewSnippet code={item.code} />}

                        {item.suggestion && (
                          <div className="mt-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              Suggestion
                            </div>
                            <p className="mt-1.5 text-[13px] leading-7 text-foreground/90">{item.suggestion}</p>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {parsed.nextSteps.length > 0 && (
                <section className="border-t border-border/30 pt-5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Suggested Next Steps
                  </h4>
                  <ul className="mt-3 space-y-2.5 text-[13px] leading-7 text-foreground/90">
                    {parsed.nextSteps.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500/75" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : (
            <div className="mt-5 border-t border-border/40 pt-5">
              <div className="text-[13px] leading-7 text-foreground/90 whitespace-pre-wrap">{body}</div>
            </div>
          )}
        </div>

        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "Show less" : "Read full review"}
          </button>
        )}
      </div>
    </div>
  )
}

const fallbackDiff = `
--- a/README.md
+++ b/README.md
@@ -1,3 +1,5 @@
 # Project
-TODO: Add description
+## Overview
+This project is actively maintained.
+See docs for setup instructions.
`

export default function GitPullDetailPage({ params }: { params: Promise<{ pullId: string }> }) {
  const resolvedParams = React.use(params)
  const router = useRouter()
  const { organization } = useOrganization()
  const pullIdRaw = resolvedParams.pullId ? decodeURIComponent(resolvedParams.pullId) : ""

  // Detect if this is a commit route: "commit:{owner}/{repo}:{sha}"
  const isCommitView = pullIdRaw.startsWith("commit:")
  const isBranchView = pullIdRaw.startsWith("branch:")
  const commitParts = isCommitView ? pullIdRaw.substring(7).split(":") : []
  const commitRepoFullName = isCommitView ? commitParts[0] : ""
  const commitSha = isCommitView ? commitParts[1] : ""
  const branchParts = isBranchView ? pullIdRaw.substring(7).split(":") : []
  const branchRepoFullName = isBranchView ? branchParts[0] : ""
  const branchName = isBranchView ? branchParts.slice(1).join(":") : ""

  // PR route parsing
  const hashIdx = !isCommitView && !isBranchView ? pullIdRaw.lastIndexOf("#") : -1
  const repoFullName = hashIdx > 0 ? pullIdRaw.substring(0, hashIdx) : ""
  const prNumber = hashIdx > 0 ? parseInt(pullIdRaw.substring(hashIdx + 1), 10) : 0

  const [view, setView] = React.useState<"conversation" | "files" | "ai">("conversation")
  const sliderRef = React.useRef<HTMLDivElement>(null)

  // Editing state
  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState("")
  const [editingBody, setEditingBody] = React.useState(false)
  const [bodyDraft, setBodyDraft] = React.useState("")

  // AI Review (Convex-connected) â€” hooks placed after `pr` query below
  // Comment
  const [commentText, setCommentText] = React.useState("")
  const [isCommenting] = React.useState(false)

  // GitHub data
  const [ghDiff, setGhDiff] = React.useState<string>("")
  const [ghDetail, setGhDetail] = React.useState<any>(null)
  const [branchDetail, setBranchDetail] = React.useState<any>(null)
  const [ghLoading, setGhLoading] = React.useState(true)
  const [isCreatingPr, setIsCreatingPr] = React.useState(false)

  // Convex queries
  const pr = useQuery(
    api.pullRequests.getByRepoAndNumber,
    !isCommitView && !isBranchView && organization && repoFullName && prNumber
      ? { orgId: organization._id, repoFullName, prNumber }
      : "skip"
  )
  const branchRecord = useQuery(
    api.branches.getByRepoAndBranch,
    isBranchView && organization && branchRepoFullName && branchName
      ? { orgId: organization._id, repoFullName: branchRepoFullName, branchName }
      : "skip"
  )
  const teams = useQuery(api.teams.listByOrg, organization ? { orgId: organization._id } : "skip")
  const projects = useQuery(api.projects.listByOrg, organization ? { orgId: organization._id } : "skip")
  const reviewHub = useQuery(
    api.prReviews.getHubByPullRequest,
    !isCommitView && !isBranchView && pr?._id ? { pullRequestId: pr._id } : "skip"
  )
  const latestReviewRunRecord = useQuery(
    api.reviewOrchestration.getLatestRunByPullRequest,
    !isCommitView && !isBranchView && pr?._id ? { pullRequestId: pr._id } : "skip"
  )
  const reviewMessages = useQuery(
    api.reviewOrchestration.getMessagesByRun,
    latestReviewRunRecord?._id ? { runId: latestReviewRunRecord._id } : "skip"
  )
  const reviewFindings = useQuery(
    api.reviewOrchestration.getFindingsByRun,
    latestReviewRunRecord?._id ? { runId: latestReviewRunRecord._id } : "skip"
  )

  // AI Review queries (must be after `pr` query)
  // Commit-specific state
  const [commitDetail, setCommitDetail] = React.useState<any>(null)
  const syncCommit = useMutation(api.commits.syncFromGitHub)

  const updatePR = useMutation(api.pullRequests.update)
  const syncPR = useMutation(api.pullRequests.syncFromGitHub)
    const triggerOrchestratedReview = useMutation(api.reviewOrchestration.triggerReview)
  const sendReviewMessage = useMutation(api.reviewOrchestration.sendMessage)
  const [reviewSourceFilter, setReviewSourceFilter] = React.useState<"all" | "copilot" | "github" | "outdated">("all")
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null)
  const [chatInput, setChatInput] = React.useState("")
  const [isTriggering, setIsTriggering] = React.useState(false)
  const [isRefreshingReviews, setIsRefreshingReviews] = React.useState(false)

  // â”€â”€â”€ Update helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleUpdate = async (field: string, value: any, toastMsg?: string) => {
    if (!pr) return
    try {
      await updatePR({ prId: pr._id, [field]: value })
      if (toastMsg) toast.success(toastMsg)
    } catch {
      toast.error("Failed to update")
    }
  }

  const handleTitleSave = async () => {
    if (!pr || !titleDraft.trim() || titleDraft.trim() === pr.title) { setEditingTitle(false); return }
    await handleUpdate("title", titleDraft.trim(), "Title updated")
    setEditingTitle(false)
  }

  const handleBodySave = async () => {
    if (!pr) { setEditingBody(false); return }
    const newBody = bodyDraft.trim()
    if (newBody === (pr.body || "")) { setEditingBody(false); return }
    await handleUpdate("body", newBody || undefined)
    setEditingBody(false)
  }

  // â”€â”€â”€ Fetch GitHub PR details & ALWAYS sync to Convex â”€â”€â”€â”€
  React.useEffect(() => {
    if (isCommitView || !organization || !repoFullName || !prNumber) return
    setGhLoading(true)
    fetchPullRequestDetail(organization.githubInstallationId, repoFullName, prNumber)
      .then((detail) => {
        setGhDetail(detail)
        if (detail.diff) setGhDiff(detail.diff)
        syncPR({
          orgId: organization._id,
          githubPrNumber: detail.githubPrNumber,
          githubRepoFullName: detail.githubRepoFullName,
          githubPrId: detail.githubPrId,
          githubUrl: detail.githubUrl,
          title: detail.title,
          body: detail.body,
          state: detail.state,
          isDraft: detail.isDraft,
          baseBranch: detail.baseBranch,
          headBranch: detail.headBranch,
          baseSha: detail.baseSha,
          headSha: detail.headSha,
          authorGithubUsername: detail.authorGithubUsername,
          additions: detail.additions,
          deletions: detail.deletions,
          changedFiles: detail.changedFiles,
          mergedBy: detail.mergedBy,
          mergedAt: detail.mergedAt,
          reviewers: detail.reviewers?.map((r: any) => ({
            githubUsername: r.githubUsername,
            state: r.state || "pending",
            submittedAt: r.submittedAt,
          })),
          githubLabels: detail.githubLabels,
        }).catch(console.error)
      })
      .catch(console.error)
      .finally(() => setGhLoading(false))
  }, [organization, repoFullName, prNumber, isCommitView])

  // â”€â”€â”€ Fetch Commit details â”€â”€â”€â”€
  React.useEffect(() => {
    if (!isCommitView || !organization || !commitRepoFullName || !commitSha) return
    setGhLoading(true)
    fetchCommitDetail(organization.githubInstallationId, commitRepoFullName, commitSha)
      .then((detail) => {
        setCommitDetail(detail)
        if (detail.diff) setGhDiff(detail.diff)
        // Sync commit to Convex
        syncCommit({
          orgId: organization._id,
          githubRepoFullName: commitRepoFullName,
          sha: detail.sha,
          message: detail.message,
          authorGithubUsername: detail.authorGithubUsername,
          committedAt: detail.committedAt,
          additions: detail.additions,
          deletions: detail.deletions,
          changedFiles: detail.changedFiles,
        }).catch(console.error)
      })
      .catch(console.error)
      .finally(() => setGhLoading(false))
  }, [organization, commitRepoFullName, commitSha, isCommitView])

  React.useEffect(() => {
    if (!isBranchView || !organization || !branchRepoFullName || !branchName) return
    setGhLoading(true)
    fetchBranchDetail(
      organization.githubInstallationId,
      branchRepoFullName,
      branchName,
      branchRecord?.baseBranch
    )
      .then((detail) => {
        setBranchDetail(detail)
        if (detail.diff) setGhDiff(detail.diff)
        setTitleDraft((current) => current || detail.title || branchName)
        setBodyDraft((current) => current || detail.body || "")
      })
      .catch(console.error)
      .finally(() => setGhLoading(false))
  }, [organization, branchRepoFullName, branchName, isBranchView, branchRecord?.baseBranch])

  // â”€â”€â”€ AI Review Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreatePullRequest = async () => {
    if (!organization || !branchDetail || !titleDraft.trim()) return
    setIsCreatingPr(true)
    try {
      const created = await createGitHubPullRequest(
        organization.githubInstallationId,
        branchDetail.githubRepoFullName,
        titleDraft.trim(),
        bodyDraft.trim() || undefined,
        branchDetail.headBranch,
        branchDetail.baseBranch
      )
      const detail = await fetchPullRequestDetail(
        organization.githubInstallationId,
        created.githubRepoFullName,
        created.githubPrNumber
      )
      await syncPR({
        orgId: organization._id,
        githubPrNumber: detail.githubPrNumber,
        githubRepoFullName: detail.githubRepoFullName,
        githubPrId: detail.githubPrId,
        githubUrl: detail.githubUrl,
        title: detail.title,
        body: detail.body,
        state: detail.state,
        isDraft: detail.isDraft,
        baseBranch: detail.baseBranch,
        headBranch: detail.headBranch,
        baseSha: detail.baseSha,
        headSha: detail.headSha,
        authorGithubUsername: detail.authorGithubUsername,
        additions: detail.additions,
        deletions: detail.deletions,
        changedFiles: detail.changedFiles,
        mergedBy: detail.mergedBy,
        mergedAt: detail.mergedAt,
        reviewers: detail.reviewers?.map((r: any) => ({
          githubUsername: r.githubUsername,
          state: r.state || "pending",
          submittedAt: r.submittedAt,
        })),
        githubLabels: detail.githubLabels,
      })
      toast.success("Pull request created")
      router.push(`/dashboard/pulls/${encodeURIComponent(`${created.githubRepoFullName}#${created.githubPrNumber}`)}`)
    } catch {
      toast.error("Failed to create pull request")
    } finally {
      setIsCreatingPr(false)
    }
  }

  // â”€â”€â”€ GSAP animation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  React.useEffect(() => {
    import("gsap").then(({ gsap }) => {
      if (!sliderRef.current) return
      gsap.to(sliderRef.current, {
        x: view === "conversation" ? "0%" : view === "files" ? "-33.333%" : "-66.666%",
        duration: 0.45,
        ease: "power3.inOut"
      })
    })
  }, [view])

  // â”€â”€â”€ Merge data: ghDetail (fresh from GitHub) overrides Convex for GitHub-native fields â”€â”€â”€
  // pr = Convex data (has app-native fields: team, project, comments, activity)
  // ghDetail = fresh from GitHub API (has accurate additions, deletions, reviewers, state)
  const prData = React.useMemo(() => {
    if (!pr && !ghDetail) return null
    if (!pr) return ghDetail
    if (!ghDetail) return pr
    // Merge: Convex is base, ghDetail overrides GitHub-native fields
    return {
      ...pr,                               // Convex base (has _id, team, project, comments, activity)
      // Override with fresh GitHub data for fields that may be stale in Convex
      title: ghDetail.title ?? pr.title,
      body: ghDetail.body ?? pr.body,
      state: ghDetail.state ?? pr.state,
      isDraft: ghDetail.isDraft ?? pr.isDraft,
      baseBranch: ghDetail.baseBranch ?? pr.baseBranch,
      headBranch: ghDetail.headBranch ?? pr.headBranch,
      additions: ghDetail.additions ?? pr.additions,
      deletions: ghDetail.deletions ?? pr.deletions,
      changedFiles: ghDetail.changedFiles ?? pr.changedFiles,
      mergedBy: ghDetail.mergedBy ?? pr.mergedBy,
      mergedAt: ghDetail.mergedAt ?? pr.mergedAt,
      githubLabels: ghDetail.githubLabels ?? pr.githubLabels,
      authorGithubUsername: ghDetail.authorGithubUsername ?? pr.authorGithubUsername,
    }
  }, [pr, ghDetail])

  const diffSource = ghDiff || fallbackDiff
  let files: any[] = []
  try { files = parseDiff(diffSource) } catch { files = parseDiff(fallbackDiff) }



  // â”€â”€â”€ Loading states â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const aiReview: any = React.useMemo(() => {
    if (!latestReviewRunRecord) return null

    const findings = reviewFindings || []
    const criticalFindings = findings.filter((finding: any) => finding.severity === "critical")
    const warningFindings = findings.filter((finding: any) => finding.severity === "warning")
    const infoFindings = findings.filter((finding: any) => finding.severity === "info")
    const verdict =
      criticalFindings.length > 0
        ? "request-changes"
        : warningFindings.length > 1
          ? "discuss"
          : "approve"

    return {
      ...latestReviewRunRecord,
      step: latestReviewRunRecord.status,
      contextStats: latestReviewRunRecord.metrics
        ? {
            filesAnalyzed: latestReviewRunRecord.metrics.filesAnalyzed || 0,
            totalDiffLines: latestReviewRunRecord.metrics.diffLines || 0,
            linkedIssuesCount: latestReviewRunRecord.metrics.linkedIssuesCount || 0,
            relatedFilesExpanded: latestReviewRunRecord.metrics.relatedFilesExpanded || 0,
          }
        : undefined,
      model: latestReviewRunRecord.metrics?.model,
      processingTimeMs: latestReviewRunRecord.metrics?.durationMs,
      review:
        latestReviewRunRecord.status === "completed"
          ? {
              summary: latestReviewRunRecord.summary || "AI review completed.",
              intent: "Automated pull request review across repository context, changed files, and reviewer signals.",
              codeQuality: {
                score: Math.max(1, 10 - criticalFindings.length * 4 - warningFindings.length * 2 - Math.min(infoFindings.length, 2)),
                highlights: findings.slice(0, 3).map((finding: any) => finding.title),
                concerns: findings.slice(0, 4).map((finding: any) => finding.body),
              },
              potentialIssues: findings.map((finding: any) => ({
                severity: finding.severity,
                file: finding.path || "pull-request",
                description: finding.body,
                suggestion: finding.suggestion,
              })),
              security: {
                hasRisks: findings.some((finding: any) => finding.agentName === "security"),
                findings: findings
                  .filter((finding: any) => finding.agentName === "security")
                  .map((finding: any) => finding.title),
              },
              tradeoffs: findings
                .filter((finding: any) => finding.agentName === "architecture")
                .map((finding: any) => finding.title),
              verdict,
              confidence:
                findings.length === 0
                  ? 0.92
                  : Math.max(0.45, Math.min(0.95, 0.92 - warningFindings.length * 0.08 - criticalFindings.length * 0.14)),
            }
          : null,
    }
  }, [latestReviewRunRecord, reviewFindings])

  const aiChatMessages: any[] | null = reviewMessages || []
  const filteredReviewThreads = React.useMemo(() => {
    const threads = reviewHub?.threads || []
    return threads.filter((thread: any) => {
      if (reviewSourceFilter === "all") return true
      if (reviewSourceFilter === "outdated") return thread.status === "outdated" || thread.freshness === "stale"
      return thread.source === reviewSourceFilter
    })
  }, [reviewHub?.threads, reviewSourceFilter])

  const selectedReviewThread =
    filteredReviewThreads.find((thread: any) => String(thread._id) === selectedThreadId) ||
    filteredReviewThreads[0] ||
    null
  const selectedThreadComments: any[] = selectedReviewThread?.comments || []
  const latestReviewRun: any = reviewHub?.latestFreshRun || reviewHub?.latestRun || aiReview || null
  const reviewStatusLabel = latestReviewRun
    ? latestReviewRun.status === "completed"
      ? "Completed"
      : latestReviewRun.status === "failed"
        ? "Failed"
        : latestReviewRun.status === "pending"
          ? "Pending"
          : "Running"
    : "Waiting for review"
  const reviewSourceLabel = latestReviewRun
    ? latestReviewRun.source === "copilot"
      ? "GitHub Copilot"
      : latestReviewRun.source === "app_ai"
        ? "Eganow AI"
        : "GitHub review"
    : "No review yet"
  const reviewFreshnessLabel = reviewHub?.freshness
    ? reviewHub.freshness.isFresh
      ? "Current head reviewed"
      : "Review needs refresh"
    : "Waiting for review head"
  const staleReviewReason = reviewHub?.freshness && !reviewHub.freshness.isFresh
    ? `Reviewed ${reviewHub.freshness.latestReviewedHeadSha?.slice(0, 7) || "unknown"} while current head is ${reviewHub.freshness.currentHeadSha?.slice(0, 7) || "unknown"}`
    : null

  React.useEffect(() => {
    if (!selectedThreadId && filteredReviewThreads.length > 0) {
      setSelectedThreadId(String(filteredReviewThreads[0]._id))
      return
    }

    if (
      selectedThreadId &&
      filteredReviewThreads.length > 0 &&
      !filteredReviewThreads.some((thread: any) => String(thread._id) === selectedThreadId)
    ) {
      setSelectedThreadId(String(filteredReviewThreads[0]._id))
    }
  }, [filteredReviewThreads, selectedThreadId])

  const handleTriggerReview = async () => {
    if (!organization || !pr?._id || !repoFullName || !prNumber) return
    setIsTriggering(true)
    try {
      await triggerOrchestratedReview({
        orgId: organization._id,
        pullRequestId: pr._id,
        repoFullName,
        prNumber,
        installationId: organization.githubInstallationId,
      })
      toast.success("AI review queued")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue AI review")
    } finally {
      setIsTriggering(false)
    }
  }

  const handleSendChat = async () => {
    if (!organization || !pr?._id || !aiReview?._id || !chatInput.trim()) return
    const message = chatInput.trim()
    setChatInput("")
    try {
      await sendReviewMessage({
        orgId: organization._id,
        pullRequestId: pr._id,
        runId: aiReview._id,
        message,
      })
    } catch (error) {
      setChatInput(message)
      toast.error(error instanceof Error ? error.message : "Failed to send follow-up")
    }
  }

  const handleRefreshReviews = async (forceAppSummary?: boolean) => {
    if (!organization || !repoFullName || !prNumber) return
    setIsRefreshingReviews(true)
    try {
      const detail = await fetchPullRequestDetail(
        organization.githubInstallationId,
        repoFullName,
        prNumber
      )
      setGhDetail(detail)
      if (detail.diff) setGhDiff(detail.diff)
      await syncPR({
        orgId: organization._id,
        githubPrNumber: detail.githubPrNumber,
        githubRepoFullName: detail.githubRepoFullName,
        githubPrId: detail.githubPrId,
        githubUrl: detail.githubUrl,
        title: detail.title,
        body: detail.body,
        state: detail.state,
        isDraft: detail.isDraft,
        baseBranch: detail.baseBranch,
        headBranch: detail.headBranch,
        baseSha: detail.baseSha,
        headSha: detail.headSha,
        authorGithubUsername: detail.authorGithubUsername,
        additions: detail.additions,
        deletions: detail.deletions,
        changedFiles: detail.changedFiles,
        mergedBy: detail.mergedBy,
        mergedAt: detail.mergedAt,
        reviewers: detail.reviewers?.map((r: any) => ({
          githubUsername: r.githubUsername,
          state: r.state || "pending",
          submittedAt: r.submittedAt,
        })),
        githubLabels: detail.githubLabels,
      })

      if (forceAppSummary && pr?._id) {
        await triggerOrchestratedReview({
          orgId: organization._id,
          pullRequestId: pr._id,
          repoFullName,
          prNumber,
          installationId: organization.githubInstallationId,
        })
      }

      toast.success(forceAppSummary ? "Review data refreshed and AI review queued" : "Review data refreshed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh review data")
    } finally {
      setIsRefreshingReviews(false)
    }
  }

  if (isBranchView) {
    if (ghLoading && !branchDetail) {
      return (
        <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          </div>
        </SidebarInset></SidebarProvider>
      )
    }
    if (!branchDetail) {
      return (
        <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <GitBranch className="size-8 mb-3 opacity-30" />
            <p className="text-[14px] font-medium">Branch not found</p>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/dashboard/pulls")}>Back to Reviews</Button>
          </div>
        </SidebarInset></SidebarProvider>
      )
    }

        const branchAuthor = branchRecord?.authorMember?.displayName || branchDetail.authorGithubUsername
    const branchDiffSource = branchDetail.diff || fallbackDiff
    let branchParsedFiles: any[] = []
    try { branchParsedFiles = parseDiff(branchDiffSource) } catch { branchParsedFiles = parseDiff(fallbackDiff) }

    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-hidden bg-background">
          <div className="absolute inset-0 flex w-full flex-col overflow-hidden text-sm bg-background">
            <div className="h-14 flex items-center justify-between px-5 border-b shrink-0 bg-background z-10">
              <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                <SidebarTrigger className="-ml-2" />
                <div className="flex items-center gap-1.5 font-medium text-[13px] text-muted-foreground ml-1">
                  <span className="hover:text-foreground cursor-pointer transition-colors" onClick={() => router.push("/dashboard/pulls")}>Reviews</span>
                  <ChevronRight className="size-3.5 opacity-50" />
                  <div className="flex items-center gap-1.5 text-foreground px-1.5 py-1 rounded-md">
                    <GitBranch className="size-4 text-sky-500" />
                    <span>{branchDetail.headBranch}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex">
              <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                <div className="max-w-[980px] mx-auto px-8 py-8">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[12px] font-semibold text-sky-600">
                      <GitBranch className="size-3.5" /> Branch ready to open
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {branchDetail.aheadBy} commit{branchDetail.aheadBy === 1 ? "" : "s"} ahead of {branchDetail.baseBranch}
                    </span>
                  </div>

                  <div className="rounded-2xl border border-border/50 bg-background p-6 shadow-none">
                    <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} className="text-[24px] font-semibold text-foreground leading-tight mb-4 w-full bg-transparent outline-none border-none" placeholder="Pull request title" />
                    <textarea
                      value={bodyDraft}
                      onChange={(e) => setBodyDraft(e.target.value)}
                      className="w-full text-[13px] text-muted-foreground whitespace-pre-wrap bg-muted/10 border border-border/30 rounded-xl p-4 outline-none resize-none overflow-hidden leading-relaxed"
                      style={{ height: `${Math.max(160, ((bodyDraft || "").split("\n").length + 2) * 24)}px` }}
                      placeholder="Describe what this branch introduces..."
                    />

                    <div className="grid grid-cols-2 gap-4 mt-6">
                      <ReadOnlyPropertyRow label="Author" value={<span className="text-[13px]">{branchAuthor}</span>} icon={User} />
                      <ReadOnlyPropertyRow label="Repo" value={<span className="text-[13px]">{branchDetail.githubRepoFullName}</span>} icon={GitFork} />
                      <ReadOnlyPropertyRow label="Base" value={<span className="font-mono text-[11px] bg-muted/40 px-1.5 py-0.5 rounded border border-border/40">{branchDetail.baseBranch}</span>} icon={GitMerge} />
                      <ReadOnlyPropertyRow label="Head" value={<span className="font-mono text-[11px] bg-sky-500/10 text-sky-600 px-1.5 py-0.5 rounded border border-sky-500/20">{branchDetail.headBranch}</span>} icon={GitBranch} iconColor="text-sky-500" />
                    </div>
                  </div>

                  <div className="mt-8">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[15px] font-semibold text-foreground">Files changed</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-emerald-500 font-semibold">+{branchDetail.additions ?? 0}</span>
                        <span className="text-red-500 font-semibold">-{branchDetail.deletions ?? 0}</span>
                        <span className="text-muted-foreground">{branchDetail.changedFiles ?? 0} files</span>
                      </div>
                    </div>
                    {branchParsedFiles.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-6 py-10 text-center text-muted-foreground text-[13px]">
                        No file diff available.
                      </div>
                    ) : branchParsedFiles.map((file: any, idx: number) => (
                      <div key={idx} className="mb-8 border border-border/40 rounded-xl overflow-hidden bg-background">
                        <div className="px-4 py-2.5 bg-muted/10 border-b border-border/30 flex items-center justify-between">
                          <span className="font-mono text-[12px] text-foreground">{file.newPath || file.oldPath}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <Diff viewType="split" diffType={file.type} hunks={file.hunks || []}>
                            {(hunks) => hunks.map((hunk: any, hunkIndex: number) => <Hunk key={hunkIndex} hunk={hunk} />)}
                          </Diff>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="w-[300px] xl:w-[320px] overflow-y-auto p-6 shrink-0 [&::-webkit-scrollbar]:hidden border-l border-border/60 bg-background flex flex-col gap-6">
                <div className="bg-muted/20 border border-border/40 rounded-xl p-4 px-5">
                  <h4 className="text-[12px] font-medium text-muted-foreground mb-3.5">Action Controls</h4>
                  <div className="flex flex-col gap-3">
                    <Button className="w-full bg-sky-600 hover:bg-sky-700 text-white shadow-none h-8 text-[12px] tracking-wide font-medium rounded-md" onClick={handleCreatePullRequest} disabled={isCreatingPr || !titleDraft.trim()}>
                      {isCreatingPr ? <Loader2 className="size-3.5 animate-spin" /> : <GitPullRequest className="size-3.5" />} Open Pull Request
                    </Button>
                    <a href={branchDetail.githubUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="w-full h-8 shadow-none text-muted-foreground border-border/60 hover:bg-muted/40 text-[12px] rounded-md">View Branch on GitHub</Button>
                    </a>
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-4 flex flex-col gap-1">
                  <ReadOnlyPropertyRow label="State" value={<span className="font-semibold text-sky-600">No pull request yet</span>} icon={GitBranch} iconColor="text-sky-500" />
                  <ReadOnlyPropertyRow label="Author" value={<span>{branchAuthor}</span>} icon={User} />
                  <ReadOnlyPropertyRow label="Base" value={<span className="font-mono text-[11px] bg-muted/40 px-1.5 py-0.5 rounded border border-border/40">{branchDetail.baseBranch}</span>} icon={GitMerge} />
                  <ReadOnlyPropertyRow label="Head" value={<span className="font-mono text-[11px] bg-sky-500/10 text-sky-600 px-1.5 py-0.5 rounded border border-sky-500/20">{branchDetail.headBranch}</span>} icon={GitBranch} iconColor="text-sky-500" />
                  <ReadOnlyPropertyRow label="Changes" value={<span className="flex items-center gap-2 text-[11px] font-mono"><span className="text-emerald-500 font-semibold bg-emerald-500/10 px-1 rounded">+{branchDetail.additions ?? 0}</span><span className="text-red-500 font-semibold bg-red-500/10 px-1 rounded">-{branchDetail.deletions ?? 0}</span><span className="text-muted-foreground">{branchDetail.changedFiles ?? 0} files</span></span>} icon={GitCommit} />
                  <ReadOnlyPropertyRow label="Updated" value={<span className="text-muted-foreground">{timeAgo(branchRecord?.committedAt || branchDetail.commits?.[0]?.committedAt || Date.now())}</span>} icon={Clock} />
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  if (isCommitView) {
    // --- COMMIT DETAIL VIEW ---
    if (ghLoading && !commitDetail) {
      return (
        <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          </div>
        </SidebarInset></SidebarProvider>
      )
    }
    if (!commitDetail) {
      return (
        <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <GitCommit className="size-8 mb-3 opacity-30" />
            <p className="text-[14px] font-medium">Commit not found</p>
            <p className="text-[12px] mt-1 opacity-60">{commitRepoFullName} @ {commitSha.substring(0, 7)}</p>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/dashboard/pulls")}>Back to Reviews</Button>
          </div>
        </SidebarInset></SidebarProvider>
      )
    }

    // Commit data
    const cFirstLine = commitDetail.message.split("\n")[0]
    const cBodyText = commitDetail.message.split("\n").slice(1).join("\n").trim()
    const cAdditions = commitDetail.additions ?? 0
    const cDeletions = commitDetail.deletions ?? 0
    const cFiles = commitDetail.files || []

    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-hidden bg-background">
          <div className="absolute inset-0 flex w-full flex-col overflow-hidden text-sm bg-background">
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-5 border-b shrink-0 bg-background z-10">
              <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                <SidebarTrigger className="-ml-2" />
                <div className="flex items-center gap-1.5 font-medium text-[13px] text-muted-foreground ml-1">
                  <span className="hover:text-foreground cursor-pointer transition-colors" onClick={() => router.push("/dashboard/pulls")}>Reviews</span>
                  <ChevronRight className="size-3.5 opacity-50" />
                  <div className="flex items-center gap-1.5 text-foreground px-1.5 py-1 rounded-md">
                    <GitCommit className="size-4 text-blue-500" />
                    <span className="font-mono text-[12px]">{commitDetail.sha.substring(0, 7)}</span>
                  </div>
                </div>
                {/* Tab pills */}
                <div className="flex items-center gap-1 ml-4 border-l pl-4 border-border/40">
                  {(["conversation", "files", "ai"] as const).map((t) => (
                    <Button key={t} variant={view === t ? "secondary" : "ghost"} size="sm" onClick={() => setView(t)}
                      className={`h-7 gap-1.5 text-[12px] rounded-md shadow-none px-2.5 ${view === t ? "bg-muted/60 text-foreground font-medium" : "font-normal text-muted-foreground"}`}>
                      {t === "conversation" && <><MessageSquare className="size-3" /> Overview</>}
                      {t === "files" && <><FileCode2 className="size-3" /> Files Changed <span className="text-[10px] opacity-60">{cFiles.length}</span></>}
                      {t === "ai" && <><Bot className="size-3" /> AI Review</>}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              <div ref={sliderRef} className="flex h-full" style={{ width: "300%" }}>
                {/* Panel 1: Conversation / Overview */}
                <div className="w-1/3 h-full overflow-y-auto flex">
                  <div className="flex-1 max-w-[850px] mx-auto px-8 py-8">
                    <h1 className="text-[22px] font-bold text-foreground leading-tight mb-2">{cFirstLine}</h1>
                    {cBodyText && (
                      <div className="text-[13px] text-muted-foreground whitespace-pre-wrap mt-4 bg-muted/10 border border-border/30 rounded-lg p-4">
                        {cBodyText}
                      </div>
                    )}
                    <Separator className="my-6" />
                    <div className="grid grid-cols-2 gap-4">
                      <ReadOnlyPropertyRow label="Author" value={<span className="text-[13px]">{commitDetail.authorGithubUsername}</span>} icon={User} />
                      <ReadOnlyPropertyRow label="SHA" value={<span className="font-mono text-[12px]">{commitDetail.sha.substring(0, 12)}</span>} icon={GitCommit} />
                      <ReadOnlyPropertyRow label="Repo" value={<span className="text-[13px]">{commitRepoFullName}</span>} icon={GitFork} />
                      <ReadOnlyPropertyRow label="Date" value={<span className="text-[13px]">{formatDate(commitDetail.committedAt)}</span>} icon={CalendarDays} />
                    </div>
                    <Separator className="my-6" />
                    {/* Stats */}
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="size-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{cFiles.length} files changed</span>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-500 font-mono font-semibold text-[13px]">
                        +{cAdditions}
                      </div>
                      <div className="flex items-center gap-2 text-red-500 font-mono font-semibold text-[13px]">
                        -{cDeletions}
                      </div>
                    </div>
                    {/* Files list */}
                    <div className="mt-4 space-y-1">
                      {cFiles.map((f: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-muted/20 transition-colors text-[12px]">
                          <span className="font-mono text-muted-foreground truncate max-w-[400px]">{f.filename}</span>
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-emerald-500">+{f.additions}</span>
                            <span className="text-red-500">-{f.deletions}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Panel 2: Files Changed */}
                <div className="w-1/3 h-full overflow-y-auto">
                  <div className="p-4 space-y-4">
                    {files.length > 0 ? files.map((file: any, fIdx: number) => (
                      <div key={fIdx} className="border border-border/40 rounded-lg overflow-hidden bg-background">
                        <div className="flex items-center gap-2 px-4 py-2 bg-muted/20 border-b border-border/40 text-[12px] font-mono text-muted-foreground">
                          <FileCode2 className="size-3.5" />
                          {file.newPath || file.oldPath}
                        </div>
                        <div className="overflow-x-auto text-[12px] [&_.diff-gutter]:!w-[50px] [&_.diff-gutter]:!text-muted-foreground/50 [&_.diff-gutter]:!bg-muted/20 [&_.diff-line]:!leading-5">
                          <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
                            {(hunks: any[]) => hunks.map((hunk: any) => <Hunk key={hunk.content} hunk={hunk} />)}
                          </Diff>
                        </div>
                      </div>
                    )) : (
                      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <FileCode2 className="size-6 mb-2 opacity-30" />
                        <p className="text-[13px]">No diff available</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Panel 3: AI Review */}
                <div className="w-1/3 h-full flex flex-col items-center justify-center p-6 text-center bg-muted/5 border-l border-border/40">
                  <div className="size-12 rounded-xl bg-muted/40 flex items-center justify-center mb-4">
                    <Bot className="size-6 text-muted-foreground/50" />
                  </div>
                  <h3 className="text-[14px] font-semibold text-foreground mb-1">Commit Analysis</h3>
                  <p className="text-[13px] text-muted-foreground max-w-[250px]">
                    AI review for individual commits is coming soon. For now, use the AI tab in the Pull Request view.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // --- PR DETAIL VIEW (existing) ---
  if (pr === undefined || (pr === null && ghLoading)) {
    return (
      <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </SidebarInset></SidebarProvider>
    )
  }
  if (prData === null) {
    return (
      <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
          <GitPullRequest className="size-8 mb-3 opacity-30" />
          <p className="text-[14px] font-medium">Pull request not found</p>
          <p className="text-[12px] mt-1 opacity-60">{repoFullName} #{prNumber}</p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/dashboard/pulls")}>Back to Reviews</Button>
        </div>
      </SidebarInset></SidebarProvider>
    )
  }

  const stateLabel = prData.state === "merged" ? "Merged" : prData.state === "closed" ? "Closed" : prData.isDraft ? "Draft" : "Open"
  const stateColor = prData.state === "merged" ? "bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400" :
    prData.state === "closed" ? "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400" :
    prData.isDraft ? "bg-muted/40 border-border/40 text-muted-foreground" :
    "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
  const StateIcon = prData.state === "merged" ? GitMerge : prData.state === "closed" ? XCircle : GitPullRequest
  const additions = prData.additions ?? 0
  const deletions = prData.deletions ?? 0
  const authorName = prData.authorMember?.displayName || prData.authorGithubUsername || "Unknown"
  const ghReviewers = ghDetail?.reviewers || prData.reviewers || []

  // Timeline
  const timeline = [
    ...((prData.activity || []).map((e: any) => ({ type: "event" as const, createdAt: e.createdAt, data: e }))),
    ...((prData.comments || []).map((c: any) => ({ type: "comment" as const, createdAt: c.createdAt, data: c }))),
  ].sort((a, b) => a.createdAt - b.createdAt)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col overflow-hidden text-sm bg-background">

          {/* --- Header --------------------------------------- */}
          <div className="h-14 flex items-center justify-between px-6 border-b shrink-0 transition-all bg-background/95 backdrop-blur z-20 relative text-sm">
            <div className="flex items-center text-[13px] font-medium text-foreground gap-1.5">
              <SidebarTrigger className="-ml-3 mr-1" />
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => router.push("/dashboard/pulls")}>
                <GitPullRequest className="size-3.5 fill-green-500/20 text-green-500" /> Pulls
              </Button>
              <ChevronRight className="size-3 text-muted-foreground/40" />
              <span className="text-muted-foreground/60 tabular-nums">{repoFullName}#{prNumber}</span>
              <div className="flex items-center gap-1.5 text-[11px] font-mono tracking-tight ml-2">
                <span className="text-emerald-500 font-semibold bg-emerald-500/10 px-1 rounded">+{additions}</span>
                <span className="text-red-500 font-semibold bg-red-500/10 px-1 rounded">-{deletions}</span>
              </div>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><Star className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Star PR</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><MoreHorizontal className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">More actions</TooltipContent></Tooltip>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Link2 className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Copy link</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Copy className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Copy PR ID</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><GitFork className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Checkout branch</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><ChevronDown className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">More options</TooltipContent></Tooltip>
            </div>
          </div>

          {/* --- Split Layout --------------------------------- */}
          <div className="flex-1 flex min-h-0 overflow-hidden">

            {/* LEFT: Main Content */}
            <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 bg-background">

              {/* Tab Navigator */}
              <div className="h-12 border-b border-border/40 flex items-center px-6 gap-6 text-[13px] font-medium text-muted-foreground bg-background z-10 shrink-0">
                <button onClick={() => setView('conversation')} className={`h-full border-b-2 transition-colors flex items-center gap-2 ${view === 'conversation' ? 'border-[#5e6ad2] text-foreground font-semibold' : 'border-transparent hover:text-foreground'}`}>
                  <MessageCircle className="size-4" /> Conversation
                </button>
                <button onClick={() => setView('files')} className={`h-full border-b-2 transition-colors flex items-center gap-2 ${view === 'files' ? 'border-[#5e6ad2] text-foreground font-semibold' : 'border-transparent hover:text-foreground'}`}>
                  <FileCode2 className="size-4" /> Files Changed <span className="px-1.5 py-[1px] rounded-full bg-muted border border-border/50 text-[10px] tabular-nums font-semibold mt-0.5">{prData.changedFiles || files.length}</span>
                </button>
                <button onClick={() => setView('ai')} className={`h-full border-b-2 transition-colors flex items-center gap-2 ${view === 'ai' ? 'border-[#5e6ad2] text-foreground font-semibold' : 'border-transparent hover:text-foreground'}`}>
                  <ShieldCheck className="size-4" /> Review
                </button>
              </div>

              {/* GSAP Canvas */}
              <div className="w-[300%] flex-1 min-h-0 flex overflow-hidden" ref={sliderRef}>

                {/* ---- TAB 1: CONVERSATION ---- */}
                <div className="w-[33.333%] h-full overflow-y-auto px-16 py-12 [&::-webkit-scrollbar]:hidden">
                  <div className="max-w-3xl mx-auto w-full">

                    {/* State badge + meta */}
                    <div className="flex items-center gap-2 mb-4">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12.5px] font-medium ${stateColor}`}>
                        <StateIcon className="size-3.5" strokeWidth={2.5} /> {stateLabel}
                      </div>
                      <div className="text-[13px] text-muted-foreground flex items-center gap-1 font-medium">
                        <span className="text-foreground tracking-tight ml-1 font-semibold">{authorName}</span> wants to merge into
                        <span className="bg-muted px-1.5 py-[1px] rounded-md border inline-block ml-0.5 tracking-tight font-mono text-[11px]">{prData.baseBranch}</span> from
                        <span className="bg-muted px-1.5 py-[1px] rounded-md border inline-block ml-0.5 tracking-tight font-mono text-[11px]">{prData.headBranch}</span>
                      </div>
                    </div>

                    {/* Editable Title */}
                    {editingTitle ? (
                      <input
                        autoFocus value={titleDraft}
                        onChange={e => setTitleDraft(e.target.value)}
                        onBlur={handleTitleSave}
                        onKeyDown={e => { if (e.key === "Enter") handleTitleSave(); if (e.key === "Escape") setEditingTitle(false) }}
                        className="text-3xl font-semibold tracking-tight mb-8 text-foreground leading-[1.3] w-full bg-transparent outline-none border-b-2 border-blue-500/40 pb-1"
                      />
                    ) : (
                      <h1
                        className="text-3xl font-semibold tracking-tight mb-8 text-foreground leading-[1.3] cursor-pointer hover:bg-muted/10 rounded-md px-2 -mx-2 py-1 transition-colors"
                        onClick={() => { setTitleDraft(prData.title); setEditingTitle(true) }}
                      >
                        {prData.title}
                      </h1>
                    )}

                    {/* Editable Description */}
                    {editingBody ? (
                      <AutoGrowTextarea
                        autoFocus value={bodyDraft}
                        onChange={e => setBodyDraft(e.target.value)}
                        onBlur={handleBodySave}
                        minHeight={120}
                        className="mb-8 w-full overflow-hidden border-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-foreground outline-none ring-0 placeholder:text-muted-foreground/50"
                        placeholder="Add description..."
                      />
                    ) : (
                      <p
                        className="text-[15px] leading-relaxed text-muted-foreground mb-8 whitespace-pre-line p-2 rounded-md hover:bg-muted/10 cursor-text transition-colors -ml-2"
                        onClick={() => { setBodyDraft(prData.body || ""); setEditingBody(true) }}
                      >
                        {prData.body || "Add description..."}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mb-10">
                      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Paperclip className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Add attachment</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Link2 className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Add link</TooltipContent></Tooltip>
                    </div>

                    {/* Linked Issues — only shown when PR has linked issues */}
                    {prData.linkedIssues && prData.linkedIssues.length > 0 && (
                      <div className="mb-8">
                        <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                          <Link2 className="size-3.5" /> Linked Issues
                        </h4>
                        <div className="flex flex-col gap-2">
                          {prData.linkedIssues.map((li: any, i: number) => {
                            const statusMap: Record<string, { icon: any; color: string; bg: string }> = {
                              backlog: { icon: CircleDashed, color: "text-muted-foreground", bg: "bg-muted/40" },
                              todo: { icon: CircleDashed, color: "text-muted-foreground", bg: "bg-muted/40" },
                              in_progress: { icon: CircleDashed, color: "text-yellow-500", bg: "bg-yellow-500/10" },
                              in_review: { icon: CircleDashed, color: "text-blue-500", bg: "bg-blue-500/10" },
                              done: { icon: CheckCircle2, color: "text-purple-500", bg: "bg-purple-500/10" },
                              cancelled: { icon: XCircle, color: "text-muted-foreground", bg: "bg-muted/40" },
                            }
                            const issueStatus = statusMap[li.status] || statusMap.todo
                            const IssueIcon = issueStatus.icon

                            return (
                              <div
                                key={i}
                                onClick={() => router.push(`/dashboard/issues/${li.identifier}`)}
                                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/40 hover:bg-muted/20 hover:border-border/60 transition-all cursor-pointer group"
                              >
                                <IssueIcon className={`size-4 shrink-0 ${issueStatus.color}`} strokeWidth={2.5} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-mono text-muted-foreground/60 shrink-0">{li.identifier}</span>
                                    <span className="text-[13px] font-medium text-foreground truncate group-hover:underline">{li.title}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${issueStatus.bg} ${issueStatus.color} capitalize`}>
                                    {li.status?.replace(/_/g, " ")}
                                  </span>
                                  <span className="text-[10px] font-medium text-muted-foreground/60 px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 capitalize">
                                    {li.linkType === "closes" ? "Closes" : li.linkType === "references" ? "References" : "Linked"}
                                  </span>
                                </div>
                                <ChevronRight className="size-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="py-12 mt-4"><Separator className="bg-border/60" /></div>

                    {/* Activity Feed */}
                    <div className="mt-4">
                      <h3 className="font-semibold text-[14px] text-foreground flex items-center justify-between mb-8">Activity</h3>

                      {/* GitHub Reviews */}
                      {ghReviewers.filter((r: any) => r.body || r.state !== "pending").map((review: any, rIdx: number) => (
                        <div key={`review-${rIdx}`} className="bg-background border border-border/40 rounded-xl mb-6 overflow-hidden">
                          <div className="p-4 py-3 pb-2 border-b border-border/20 bg-muted/5 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-6 border border-border/40 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"><AvatarFallback className="text-[9px] font-bold">{getInitials(review.githubUsername)}</AvatarFallback></Avatar>
                              <div className="text-[13px] text-muted-foreground">
                                <span className="font-semibold text-foreground">{review.githubUsername}</span> reviewed
                                {review.submittedAt && <span className="ml-1 text-muted-foreground/80">{timeAgo(review.submittedAt)}</span>}
                                <span className={`ml-2 px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-wider ${
                                  review.state === "approved" ? "bg-emerald-500/10 text-emerald-500" :
                                  review.state === "changes_requested" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500"
                                }`}>{review.state?.replace(/_/g, " ")}</span>
                              </div>
                            </div>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/60 rounded-full"><MoreHorizontal className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="left" className="text-xs">Review actions</TooltipContent></Tooltip>
                          </div>
                          {review.body && <ReviewActivityBody body={review.body} />}
                        </div>
                      ))}

                      {/* Convex timeline */}
                      {timeline.map((item, idx) => {
                        if (item.type === "event") {
                          const evt = item.data
                          if (evt.eventType === "comment_created") return null
                          return (
                            <div key={`e-${idx}`} className="flex items-start gap-3 mb-6 px-2">
                              <div className="size-6 shrink-0 rounded-full flex items-center justify-center border mt-0.5 bg-muted/40 border-border/40 text-muted-foreground"><Activity className="size-3" strokeWidth={2.5} /></div>
                              <div className="text-[13px] text-muted-foreground leading-relaxed pt-1">
                                <span className="font-semibold text-foreground">{evt.actorDisplayName}</span> {evt.eventType.replace(/_/g, " ")}
                                <div className="text-[11.5px] mt-1 text-muted-foreground/60">{timeAgo(evt.createdAt)}</div>
                              </div>
                            </div>
                          )
                        }
                        if (item.type === "comment") {
                          const c = item.data
                          return (
                            <div key={`c-${idx}`} className="bg-background border border-border/40 rounded-xl mb-6 overflow-hidden">
                              <div className="p-4 py-3 pb-2 border-b border-border/20 bg-muted/5 flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                  <Avatar className="size-6 border bg-blue-100 dark:bg-blue-900/30 text-blue-600"><AvatarFallback className="text-[9px] font-bold">{getInitials(c.authorDisplayName)}</AvatarFallback></Avatar>
                                  <div className="text-[13px] text-muted-foreground">
                                    <span className="font-semibold text-foreground">{c.authorDisplayName}</span> commented <span className="mx-1.5 text-muted-foreground/60">{timeAgo(c.createdAt)}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="p-4 py-3"><p className="text-[14px] text-foreground leading-relaxed whitespace-pre-wrap">{c.body}</p></div>
                            </div>
                          )
                        }
                        return null
                      })}

                      {/* Comment Input */}
                      <div className="bg-muted/20 border border-border/60 rounded-xl overflow-hidden flex flex-col min-h-[90px] transition-colors hover:bg-muted/30 mt-4">
                        <div className="p-4 px-5 flex-1">
                          <textarea value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Leave a comment..." className="w-full h-full bg-transparent resize-none border-none outline-none text-[14px] text-foreground placeholder:text-muted-foreground font-medium min-h-[40px]" />
                        </div>
                        <div className="px-4 py-2 bg-transparent flex items-center justify-end gap-1 border-t border-border/10">
                          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><Paperclip className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="top" className="text-xs">Attach file</TooltipContent></Tooltip>
                          <Button variant="secondary" size="sm" disabled={!commentText.trim() || isCommenting} onClick={() => { setCommentText(""); toast.success("Comment posted") }} className="h-7 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium ml-2 rounded-[6px]">
                            {isCommenting ? "Posting..." : "Comment"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ---- TAB 2: FILES CHANGED ---- */}
                <div className="w-[33.333%] h-full overflow-y-auto px-10 py-10 [&::-webkit-scrollbar]:hidden">

                  {/* File summary bar */}
                  <div className="max-w-5xl mx-auto mb-6 flex items-center gap-3 text-[13px] text-muted-foreground px-1">
                    <span className="font-medium text-foreground">{files.length} file{files.length !== 1 ? "s" : ""} changed</span>
                    <span className="text-emerald-500 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded text-[11px] font-mono">+{additions}</span>
                    <span className="text-red-500 font-semibold bg-red-500/10 px-1.5 py-0.5 rounded text-[11px] font-mono">-{deletions}</span>
                  </div>

                  {/* Individual file diffs */}
                  {files.map((file, idx) => {
                    // Compute per-file stats from hunks
                    let fileAdds = 0, fileDels = 0
                    file.hunks?.forEach((hunk: any) => {
                      hunk.changes?.forEach((change: any) => {
                        if (change.type === "insert") fileAdds++
                        if (change.type === "delete") fileDels++
                      })
                    })

                    return (
                      <div key={idx} className="max-w-5xl mx-auto border border-border/60 rounded-xl overflow-hidden bg-background shadow-none mb-6">
                        {/* File header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/10 border-b border-border/40 text-sm">
                          <div className="flex items-center gap-2 font-medium text-[13px] text-foreground">
                            <FileCode2 className="size-4 text-emerald-500" />
                            <span className="font-mono text-[12px]">{file.newPath || file.oldPath}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-[11px] font-mono text-emerald-600 font-semibold bg-emerald-500/10 px-1.5 rounded">+{fileAdds}</div>
                            <div className="text-[11px] font-mono text-red-600 font-semibold bg-red-500/10 px-1.5 rounded">-{fileDels}</div>
                            <div className="h-4 w-px bg-border/60 mx-1" />
                            {prData.githubUrl && (
                              <a href={`${prData.githubUrl}/files`} target="_blank" rel="noopener noreferrer">
                                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground px-2">View file</Button>
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Diff hunks */}
                        <div className="text-[12px] overflow-x-auto overflow-y-auto max-h-[575px] overscroll-contain w-full [&::-webkit-scrollbar]:hidden [&_td]:p-[2px_10px] [&_.diff-line]:min-h-[22px] [&_.diff-gutter]:!text-muted-foreground/60 [&_.diff-code]:!text-foreground [&_.diff-gutter-insert]:!bg-emerald-500/20 [&_.diff-gutter-delete]:!bg-red-500/20 [&_.diff-code-insert]:!bg-emerald-500/10 [&_.diff-code-delete]:!bg-red-500/10 bg-background">
                          <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
                            {(hunks) => hunks.map((hunk, hIdx) => <Hunk key={hIdx} hunk={hunk} />)}
                          </Diff>
                        </div>
                      </div>
                    )
                  })}

                  {/* Changes summary */}
                  <div className="max-w-5xl mx-auto flex flex-col gap-6 mt-12 pb-12">
                    <div>
                      <h3 className="font-semibold text-[14px] text-foreground mb-3 px-1">Changes Made</h3>
                      <div className="bg-muted/10 border border-border/40 rounded-xl p-4 px-5 text-[13px] text-foreground/90 leading-relaxed shadow-none">
                        <span className="font-semibold text-foreground tracking-tight block mb-1">{prData.title}</span>
                        {prData.body ? prData.body.slice(0, 200) + (prData.body.length > 200 ? "..." : "") : "No description provided."}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-[14px] text-foreground mb-3 px-1 pt-2">Change Health</h3>
                      <div className="bg-muted/10 border border-border/40 rounded-xl p-4 px-5 text-[13px] text-foreground/90 leading-relaxed shadow-none">
                        <span className="font-semibold text-foreground tracking-tight block mb-3">Metrics Summary</span>
                        <ul className="flex flex-col gap-3 mt-1">
                          <li className="flex gap-2">
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                            <div><span className="font-medium text-foreground">Files Changed:</span> {prData.changedFiles || files.length} file(s) with {additions} additions and {deletions} deletions.</div>
                          </li>
                          <li className="flex gap-2">
                            {prData.checksStatus === "success" ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500 mt-0.5" /> :
                             prData.checksStatus === "failure" ? <XCircle className="size-4 shrink-0 text-red-500 mt-0.5" /> :
                             <CircleDashed className="size-4 shrink-0 text-amber-500 mt-0.5" />}
                            <div><span className="font-medium text-foreground">CI Status:</span> {prData.checksStatus ? prData.checksStatus.charAt(0).toUpperCase() + prData.checksStatus.slice(1) : "No checks reported"}</div>
                          </li>
                          <li className="flex gap-2">
                            <ShieldCheck className="size-4 shrink-0 text-blue-500 mt-0.5" />
                            <div><span className="font-medium text-foreground">Reviews:</span> {ghReviewers.filter((r: any) => r.state === "approved").length} approved, {ghReviewers.filter((r: any) => r.state === "changes_requested").length} requesting changes, {ghReviewers.filter((r: any) => r.state === "pending").length} pending</div>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ---- TAB 3: REVIEW CHAT ---- */}
                <PullReviewChat
                  repoLabel={repoFullName || "co-work"}
                  prTitle={prData.title}
                  aiReview={aiReview}
                  aiChatMessages={aiChatMessages}
                  reviewHub={reviewHub}
                  filteredReviewThreads={filteredReviewThreads}
                  selectedThreadId={selectedThreadId}
                  selectedReviewThread={selectedReviewThread}
                  selectedThreadComments={selectedThreadComments}
                  reviewSourceFilter={reviewSourceFilter}
                  setReviewSourceFilter={setReviewSourceFilter}
                  setSelectedThreadId={setSelectedThreadId}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  handleTriggerReview={handleTriggerReview}
                  handleSendChat={handleSendChat}
                  handleRefreshReviews={handleRefreshReviews}
                  isTriggering={isTriggering}
                  isRefreshingReviews={isRefreshingReviews}
                  githubUrl={prData.githubUrl}
                  reviewStatusLabel={reviewStatusLabel}
                  reviewSourceLabel={reviewSourceLabel}
                  reviewFreshnessLabel={reviewFreshnessLabel}
                  staleReviewReason={staleReviewReason}
                  additions={additions}
                  deletions={deletions}
                  changedFiles={prData.changedFiles || files.length}
                />

              </div>
            </div>
            {/* --- RIGHT: Properties Sidebar ------------------- */}
            <div className="w-[300px] xl:w-[320px] overflow-y-auto p-6 shrink-0 [&::-webkit-scrollbar]:hidden border-l border-border/60 bg-background flex flex-col gap-6">

              {/* Action Controls */}
              <div className="bg-muted/20 border border-border/40 rounded-xl p-4 px-5 hover:border-border/60 transition-colors">
                <h4 className="text-[12px] font-medium text-muted-foreground flex items-center justify-between cursor-pointer hover:text-foreground transition-colors mb-3.5">Action Controls <ChevronDown className="size-3" /></h4>
                <div className="flex flex-col gap-3 mt-4 mb-1">
                  <Button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-none h-8 text-[12px] tracking-wide font-medium rounded-md" onClick={() => toast.success("Review submitted: Approved")}>Approve Changes</Button>
                  <Button className={`w-full bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white shadow-none h-8 text-[12px] tracking-wide font-medium rounded-md ${prData.state !== "open" ? "opacity-50 cursor-not-allowed" : ""}`} disabled={prData.state !== "open"}>Merge Pull Request</Button>
                  <Button variant="outline" className="w-full h-8 shadow-none text-muted-foreground border-border/60 hover:bg-muted/40 text-[12px] rounded-md">Request Changes</Button>
                </div>
              </div>

              {/* Editable + Read-only Properties */}
              <div className="bg-muted/30 rounded-xl p-4 flex flex-col gap-1">

                {/* State (read-only — GitHub-controlled) */}
                <ReadOnlyPropertyRow label="State" value={
                  <span className={`font-semibold ${prData.state === "merged" ? "text-purple-500" : prData.state === "closed" ? "text-red-500" : prData.isDraft ? "text-muted-foreground" : "text-green-500"}`}>{stateLabel}</span>
                } icon={StateIcon} iconColor={prData.state === "merged" ? "text-purple-500" : prData.state === "closed" ? "text-red-500" : "text-amber-500"} />

                {/* Author (read-only) */}
                <ReadOnlyPropertyRow label="Author" value={
                  <span className="flex items-center gap-1.5">
                    <Avatar className="size-[18px] border bg-orange-100 text-orange-600"><AvatarFallback className="text-[8px] font-bold">{getInitials(authorName)}</AvatarFallback></Avatar>
                    {authorName}
                  </span>
                } icon={User} />

                {/* Reviewers (read-only) */}
                <ReadOnlyPropertyRow label="Reviewers" value={
                  <div className="flex min-w-0 flex-col gap-2 py-0.5">
                    {ghReviewers.length > 0 ? ghReviewers.map((r: any, i: number) => (
                      <div
                        key={i}
                        className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/35 bg-background/55 px-2.5 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar className="size-[18px] shrink-0 border bg-emerald-100 text-emerald-600">
                            <AvatarFallback className="text-[8px] font-bold">{getInitials(r.githubUsername)}</AvatarFallback>
                          </Avatar>
                          <span className="truncate text-[12px] font-medium text-foreground/90">
                            {r.githubUsername}
                          </span>
                        </div>
                        <span
                          className={`inline-flex w-fit max-w-full items-center rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] ${
                            r.state === "approved" ? "bg-emerald-500/10 text-emerald-500" :
                            r.state === "changes_requested" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500"
                          }`}
                        >
                          {(r.state || "pending").replace(/_/g, " ")}
                        </span>
                      </div>
                    )) : <span className="text-muted-foreground">No reviewers</span>}
                  </div>
                } icon={CheckCircle2} />

                {/* Labels (read-only — from GitHub) */}
                <ReadOnlyPropertyRow label="Labels" value={
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {(prData.githubLabels || []).length > 0 ? (prData.githubLabels || []).map((lbl: any, i: number) => (
                      <span key={i} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border/40 text-[10px] bg-muted/20 font-medium">
                        <span className="size-2 rounded-full" style={{ backgroundColor: lbl.color }} />{lbl.name}
                      </span>
                    )) : <span className="text-muted-foreground">No labels</span>}
                  </div>
                } icon={Tag} />

                {/* CI/CD (read-only) */}
                <ReadOnlyPropertyRow label="CI/CD" value={
                  prData.checksStatus ? (
                    <span className={`flex items-center gap-1.5 font-semibold ${
                      prData.checksStatus === "success" ? "text-emerald-500" : prData.checksStatus === "failure" ? "text-red-500" : "text-amber-500"
                    }`}>
                      {prData.checksStatus === "success" && <CheckCircle2 className="size-3.5" />}
                      {prData.checksStatus === "failure" && <XCircle className="size-3.5" />}
                      {prData.checksStatus === "pending" && <RefreshCw className="size-3.5 animate-spin" />}
                      {prData.checksStatus.charAt(0).toUpperCase() + prData.checksStatus.slice(1)}
                    </span>
                  ) : <span className="text-muted-foreground/60">No checks</span>
                } icon={ShieldCheck} />

                <Separator className="bg-border/60 my-2" />

                {/* Team (app-editable) */}
                <EditablePropertyRow label="Team" icon={Users}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
                        {prData.team ? <span>{prData.team.name}</span> : <span className="text-muted-foreground">No team</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px] p-1">
                      <DropdownMenuItem onClick={() => handleUpdate("teamId", undefined)} className="py-1.5 px-2 text-[12px] text-muted-foreground">None</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(teams || []).map(t => (
                        <DropdownMenuItem key={t._id} onClick={() => handleUpdate("teamId", t._id, `Moved to ${t.name}`)} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <span>{t.name}</span>
                          {prData.teamId === t._id && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                {/* Project (app-editable) */}
                <EditablePropertyRow label="Project" icon={FolderKanban}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
                        {prData.project ? <span>{prData.project.name}</span> : <span className="text-muted-foreground">No project</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px] p-1">
                      <DropdownMenuItem onClick={() => handleUpdate("projectId", undefined)} className="py-1.5 px-2 text-[12px] text-muted-foreground">None</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(projects || []).map(p => (
                        <DropdownMenuItem key={p._id} onClick={() => handleUpdate("projectId", p._id)} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <span>{p.name}</span>
                          {prData.projectId === p._id && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                <Separator className="bg-border/60 my-2" />

                {/* Branch Info (read-only) */}
                <ReadOnlyPropertyRow label="Base" value={<span className="font-mono text-[11px] bg-muted/40 px-1.5 py-0.5 rounded border border-border/40">{prData.baseBranch}</span>} icon={GitMerge} />
                <ReadOnlyPropertyRow label="Head" value={<span className="font-mono text-[11px] bg-muted/40 px-1.5 py-0.5 rounded border border-border/40">{prData.headBranch}</span>} icon={GitBranch} />

                {/* Diff Stats (read-only) */}
                <ReadOnlyPropertyRow label="Changes" value={
                  <span className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-emerald-500 font-semibold bg-emerald-500/10 px-1 rounded">+{additions}</span>
                    <span className="text-red-500 font-semibold bg-red-500/10 px-1 rounded">-{deletions}</span>
                    <span className="text-muted-foreground">{prData.changedFiles || files.length} files</span>
                  </span>
                } icon={GitCommit} />

                <Separator className="bg-border/60 my-2" />

                {/* Dates */}
                <ReadOnlyPropertyRow label="Created" value={<span className="text-muted-foreground">{prData.createdAt ? formatDate(prData.createdAt) : "—"}</span>} icon={CalendarDays} />
                {prData.mergedAt && <ReadOnlyPropertyRow label="Merged" value={
                  <span className="flex items-center gap-1.5 text-purple-500">{formatDate(prData.mergedAt)}{prData.mergedBy && <span className="text-muted-foreground text-[11px]">by {prData.mergedBy}</span>}</span>
                } icon={GitMerge} iconColor="text-purple-500" />}
                <ReadOnlyPropertyRow label="Updated" value={<span className="text-muted-foreground">{prData.updatedAt ? timeAgo(prData.updatedAt) : "—"}</span>} icon={Clock} />

                {/* Linked Issues */}
                {prData.linkedIssues && prData.linkedIssues.length > 0 && (
                  <>
                    <Separator className="bg-border/60 my-2" />
                    <ReadOnlyPropertyRow label="Linked" value={
                      <div className="flex flex-col gap-1">
                        {prData.linkedIssues.map((li: any, i: number) => (
                          <span key={i} className="flex items-center gap-1.5 hover:underline cursor-pointer text-foreground" onClick={() => router.push(`/dashboard/issues/${li.identifier}`)}>
                            <CircleDashed className="size-3.5 text-muted-foreground" /> {li.identifier}
                          </span>
                        ))}
                      </div>
                    } icon={Link2} />
                  </>
                )}
              </div>

              {/* GitHub link */}
              <a href={prData.githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between group cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground group-hover:text-foreground transition-colors">
                    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" />
                  </svg>
                  <span className="text-[13px] font-medium text-muted-foreground group-hover:text-foreground transition-colors tracking-tight">{repoFullName}</span>
                </div>
                <ChevronRight className="size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </a>
            </div>

          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

