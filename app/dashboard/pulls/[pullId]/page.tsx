"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { fetchPullRequestDetail, fetchCommitDetail, fetchBranchComparison, createGitHubPullRequest, deleteGitHubBranch } from "@/lib/github/actions"
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

import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"

import {
  GitPullRequest, GitMerge, ChevronRight, CheckCircle2, CircleDashed, Users, Plus,
  MessageSquare, FileCode2, Activity, MoreHorizontal,
  MessageCircle, Star, Link2, Copy, GitFork, ChevronDown,
  Paperclip, ArrowUpCircle, User, Tag, GitBranch, Bot,
  XCircle, RefreshCw, FolderKanban, Check, Clock, CalendarDays, GitCommit, ShieldCheck,
  Sparkles, AlertTriangle, Info, Loader2, Shield, Zap, RotateCcw, ThumbsUp, ThumbsDown, HelpCircle
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

// ─── Editable Property Row ────────────────────────────────────
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

// ─── Read-Only Property Row (GitHub-controlled) ───────────────
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

// ─── Branch Detail View (create PR from branch) ────────
function BranchDetailView({ pullIdRaw, organization, router }: { pullIdRaw: string; organization: any; router: any }) {
  const branchParts = pullIdRaw.substring(7).split(":")
  const branchRepo = branchParts[0] || ""
  const branchName = branchParts.slice(1).join(":") || ""

  const branch = useQuery(
    api.branches.getByRepoAndBranch,
    organization ? { orgId: organization._id, repoFullName: branchRepo, branchName } : "skip"
  )

  const syncPR = useMutation(api.pullRequests.syncFromGitHub)

  const [comparison, setComparison] = React.useState<any>(null)
  const [compLoading, setCompLoading] = React.useState(true)
  const [prTitle, setPrTitle] = React.useState("")
  const [prBody, setPrBody] = React.useState("")
  const [isDraft, setIsDraft] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)

  const baseBranch = branch?.baseBranch || "main"

  // Fetch branch comparison from GitHub
  React.useEffect(() => {
    if (!organization || !branchRepo || !branchName) return
    setCompLoading(true)
    fetchBranchComparison(organization.githubInstallationId, branchRepo, baseBranch, branchName)
      .then(data => {
        setComparison(data)
        if (data && !prTitle) {
          // Default PR title from branch name
          const humanized = branchName
            .replace(/^(feature|fix|chore|hotfix|release)\//i, "")
            .replace(/[-_]/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase())
          setPrTitle(humanized)
        }
      })
      .catch(console.error)
      .finally(() => setCompLoading(false))
  }, [organization, branchRepo, branchName, baseBranch])

  const canCreate = !compLoading && comparison && comparison.aheadBy > 0

  const handleCreatePR = async () => {
    if (!organization || !prTitle.trim()) return
    setIsCreating(true)
    try {
      const result = await createGitHubPullRequest(
        organization.githubInstallationId,
        branchRepo,
        prTitle.trim(),
        prBody || undefined,
        branchName,
        baseBranch,
        isDraft
      )
      toast.success(`Pull request #${result.number} created`)

      // Sync the new PR to Convex
      try {
        await syncPR({
          orgId: organization._id,
          githubRepoFullName: branchRepo,
          githubPrNumber: result.number,
          githubPrId: result.githubPrId,
          githubUrl: result.githubUrl,
          title: result.title,
          state: result.isDraft ? "open" : "open",
          isDraft: result.isDraft,
          baseBranch: result.baseBranch,
          headBranch: result.headBranch,
          authorGithubUsername: result.authorGithubUsername,
          additions: comparison?.files?.reduce((s: number, f: any) => s + (f.additions || 0), 0) || 0,
          deletions: comparison?.files?.reduce((s: number, f: any) => s + (f.deletions || 0), 0) || 0,
          changedFiles: comparison?.files?.length || 0,
        })
      } catch { /* non-blocking */ }

      // Navigate to the new PR
      const prId = `${branchRepo}#${result.number}`
      router.push(`/dashboard/pulls/${encodeURIComponent(prId)}`)
    } catch (err: any) {
      const msg = err?.message || "Failed to create pull request"
      if (msg.includes("No commits between")) {
        toast.error("This branch has no new commits compared to the base branch.")
      } else if (msg.includes("A pull request already exists")) {
        toast.error("A pull request already exists for this branch.")
      } else {
        toast.error(msg)
      }
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteBranch = async () => {
    if (!organization || !branchRepo || !branchName) return
    const confirmed = window.confirm(`Delete branch "${branchName}" from ${branchRepo}? This cannot be undone.`)
    if (!confirmed) return
    setIsDeleting(true)
    try {
      await deleteGitHubBranch(organization.githubInstallationId, branchRepo, branchName)
      toast.success(`Branch "${branchName}" deleted`)
      router.push("/dashboard/pulls")
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete branch")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col overflow-hidden text-sm bg-background">

          {/* Header */}
          <div className="h-14 flex items-center justify-between px-6 border-b shrink-0 bg-background/95 backdrop-blur z-20 text-sm">
            <div className="flex items-center text-[13px] font-medium text-foreground gap-1.5">
              <SidebarTrigger className="-ml-3 mr-1" />
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => router.push("/dashboard/pulls")}>
                <GitPullRequest className="size-3.5 text-emerald-500" /> Reviews
              </Button>
              <ChevronRight className="size-3 text-muted-foreground/40" />
              <GitBranch className="size-3.5 text-sky-500" />
              <span className="text-foreground font-mono text-[12px]">{branchName}</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <div className="max-w-[820px] mx-auto w-full px-12 py-10">

              {/* Branch Info */}
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <div className="size-10 rounded-xl flex items-center justify-center bg-sky-500/10 border border-sky-500/20">
                    <GitBranch className="size-5 text-sky-500" />
                  </div>
                  <div>
                    <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Open a Pull Request</h1>
                    <p className="text-[13px] text-muted-foreground">
                      Create a pull request to merge <span className="font-mono text-sky-500 bg-sky-500/10 px-1.5 py-0.5 rounded text-[12px]">{branchName}</span> into <span className="font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded text-[12px]">{baseBranch}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Comparison Stats */}
              {compLoading ? (
                <div className="flex items-center gap-3 py-8 text-muted-foreground">
                  <span className="size-4 border-2 border-muted-foreground border-t-foreground rounded-full animate-spin" />
                  <span className="text-[13px]">Comparing branches…</span>
                </div>
              ) : comparison ? (
                <div className="mb-8 grid grid-cols-3 gap-4">
                  <div className="bg-muted/20 border border-border/50 rounded-xl p-4 text-center">
                    <div className="text-[22px] font-bold text-foreground tabular-nums">{comparison.aheadBy}</div>
                    <div className="text-[11.5px] text-muted-foreground font-medium mt-1">Commits Ahead</div>
                  </div>
                  <div className="bg-muted/20 border border-border/50 rounded-xl p-4 text-center">
                    <div className="text-[22px] font-bold text-foreground tabular-nums">{comparison.behindBy}</div>
                    <div className="text-[11.5px] text-muted-foreground font-medium mt-1">Commits Behind</div>
                  </div>
                  <div className="bg-muted/20 border border-border/50 rounded-xl p-4 text-center">
                    <div className="text-[22px] font-bold text-foreground tabular-nums">{comparison.files?.length || 0}</div>
                    <div className="text-[11.5px] text-muted-foreground font-medium mt-1">Files Changed</div>
                  </div>
                </div>
              ) : (
                <div className="mb-8 p-4 border border-amber-500/20 bg-amber-500/5 rounded-xl text-[13px] text-amber-600 flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0" />
                  Could not compare branches. The base branch <span className="font-mono font-medium">{baseBranch}</span> may not exist.
                </div>
              )}

              {/* PR Form */}
              <div className="border border-border/60 rounded-[12px] bg-background overflow-hidden mb-8">
                <div className="p-5 border-b border-border/40">
                  <label className="text-[11.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">Title</label>
                  <input
                    value={prTitle}
                    onChange={e => setPrTitle(e.target.value)}
                    placeholder="Pull request title…"
                    className="w-full text-[15px] font-semibold text-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="p-5 border-b border-border/40">
                  <label className="text-[11.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">Description</label>
                  <textarea
                    value={prBody}
                    onChange={e => setPrBody(e.target.value)}
                    placeholder="Describe what this PR does…"
                    rows={4}
                    className="w-full text-[13.5px] text-foreground bg-transparent border-none outline-none resize-none placeholder:text-muted-foreground/40 leading-relaxed"
                  />
                </div>
                <div className="p-5 flex items-center justify-between">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isDraft}
                      onChange={e => setIsDraft(e.target.checked)}
                      className="size-4 rounded border-border accent-foreground"
                    />
                    <div>
                      <span className="text-[13px] font-medium text-foreground">Create as Draft</span>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5">Draft PRs cannot be merged until marked ready.</p>
                    </div>
                  </label>
                  <Button
                    onClick={handleCreatePR}
                    disabled={!prTitle.trim() || isCreating || !organization || !canCreate}
                    className="h-9 gap-2 px-5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-none font-medium disabled:opacity-50"
                  >
                    {isCreating ? (
                      <><Loader2 className="size-3.5 animate-spin" /> Creating…</>
                    ) : (
                      <><GitPullRequest className="size-3.5" /> Create Pull Request</>
                    )}
                  </Button>
                </div>
                {!compLoading && comparison && comparison.aheadBy === 0 && (
                  <div className="px-5 pb-5 -mt-1 flex items-center justify-between">
                    <p className="text-[12px] text-amber-500 flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      No new commits compared to <span className="font-mono font-medium">{baseBranch}</span>.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteBranch}
                      disabled={isDeleting}
                      className="h-8 gap-1.5 text-[12px] text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-600"
                    >
                      {isDeleting ? (
                        <><Loader2 className="size-3 animate-spin" /> Deleting…</>
                      ) : (
                        <><XCircle className="size-3.5" /> Delete Branch</>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Recent commits on this branch */}
              {comparison?.commits && comparison.commits.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-[11.5px] font-bold text-muted-foreground uppercase tracking-wider mb-4 px-1">
                    Commits on this branch · {comparison.commits.length}
                  </h3>
                  <div className="border border-border/60 rounded-[12px] overflow-hidden divide-y divide-border/30">
                    {comparison.commits.map((c: any, idx: number) => {
                      const firstLine = c.message.split("\n")[0]
                      return (
                        <div key={c.sha || idx} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/5 transition-colors">
                          <GitCommit className="size-4 text-blue-500 shrink-0" />
                          <span className="text-[12px] font-mono text-blue-500/70 shrink-0 w-[60px]">{c.sha.slice(0, 7)}</span>
                          <span className="text-[13px] font-medium text-foreground truncate flex-1">{firstLine}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0">{c.authorGithubUsername}</span>
                          <span className="text-[11px] text-muted-foreground/60 shrink-0 tabular-nums">{timeAgo(c.committedAt)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Changed files */}
              {comparison?.files && comparison.files.length > 0 && (
                <div>
                  <h3 className="text-[11.5px] font-bold text-muted-foreground uppercase tracking-wider mb-4 px-1">
                    Changed files · {comparison.files.length}
                  </h3>
                  <div className="border border-border/60 rounded-[12px] overflow-hidden divide-y divide-border/30">
                    {comparison.files.map((f: any, idx: number) => (
                      <div key={f.filename || idx} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/5 transition-colors">
                        <FileCode2 className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-[13px] font-medium text-foreground truncate flex-1">{f.filename}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                          f.status === "added" ? "text-emerald-500 bg-emerald-500/10" :
                          f.status === "removed" ? "text-red-500 bg-red-500/10" :
                          "text-amber-500 bg-amber-500/10"
                        }`}>{f.status}</span>
                        <span className="text-[10.5px] font-mono text-emerald-500 bg-emerald-500/10 px-1 rounded">+{f.additions}</span>
                        <span className="text-[10.5px] font-mono text-red-500 bg-red-500/10 px-1 rounded">-{f.deletions}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function GitPullDetailPage({ params }: { params: Promise<{ pullId: string }> }) {
  const resolvedParams = React.use(params)
  const router = useRouter()
  const { organization } = useOrganization()
  const pullIdRaw = resolvedParams.pullId ? decodeURIComponent(resolvedParams.pullId) : ""

  // Detect if this is a commit route: "commit:{owner}/{repo}:{sha}"
  const isCommitView = pullIdRaw.startsWith("commit:")
  const commitParts = isCommitView ? pullIdRaw.substring(7).split(":") : []
  const commitRepoFullName = isCommitView ? commitParts[0] : ""
  const commitSha = isCommitView ? commitParts[1] : ""

  // Detect if this is a branch route: "branch:{owner}/{repo}:{branchName}"
  const isBranchView = pullIdRaw.startsWith("branch:")

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

  // AI Review (Convex-connected) — hooks placed after `pr` query below
  const [chatInput, setChatInput] = React.useState("")
  const [isTriggering, setIsTriggering] = React.useState(false)

  // Comment
  const [commentText, setCommentText] = React.useState("")
  const [isCommenting, setIsCommenting] = React.useState(false)

  // GitHub data
  const [ghDiff, setGhDiff] = React.useState<string>("")
  const [ghDetail, setGhDetail] = React.useState<any>(null)
  const [ghLoading, setGhLoading] = React.useState(true)

  // Convex queries
  const pr = useQuery(
    api.pullRequests.getByRepoAndNumber,
    !isCommitView && organization && repoFullName && prNumber
      ? { orgId: organization._id, repoFullName, prNumber }
      : "skip"
  )
  const teams = useQuery(api.teams.listByOrg, organization ? { orgId: organization._id } : "skip")
  const projects = useQuery(api.projects.listByOrg, organization ? { orgId: organization._id } : "skip")

  // AI Review queries (must be after `pr` query)
  const aiReview = useQuery(
    api.aiReviews.getByPullRequest,
    pr?._id ? { pullRequestId: pr._id } : "skip"
  )
  const aiChatMessages = useQuery(
    api.aiReviews.getChatMessages,
    aiReview?._id ? { reviewId: aiReview._id } : "skip"
  )
  const reviewChatMessages = aiChatMessages ?? []
  const isReviewResponding = Boolean(
    aiReview && aiReview.step !== "completed" && aiReview.step !== "failed"
  )
  const triggerReview = useMutation(api.aiReviews.triggerReview)
  const sendChatMessage = useMutation(api.aiReviews.sendChatMessage)

  // Commit-specific state
  const [commitDetail, setCommitDetail] = React.useState<any>(null)
  const syncCommit = useMutation(api.commits.syncFromGitHub)

  const updatePR = useMutation(api.pullRequests.update)
  const syncPR = useMutation(api.pullRequests.syncFromGitHub)

  // ─── Update helper ────────────────────────────────────
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

  // ─── Fetch GitHub PR details & ALWAYS sync to Convex ────
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

  // ─── Fetch Commit details ────
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

  // ─── AI Review Handlers ────────────────────────────────
  const handleTriggerReview = async () => {
    if (!pr?._id || !organization || !repoFullName || !prNumber) return
    setIsTriggering(true)
    try {
      await triggerReview({
        orgId: organization._id,
        pullRequestId: pr._id,
        repoFullName,
        prNumber,
        installationId: organization.githubInstallationId,
      })
      toast.success("AI review started")
    } catch (err: any) {
      toast.error(err.message || "Failed to start review")
    } finally {
      setIsTriggering(false)
    }
  }

  const handleSendChat = async () => {
    if (!chatInput.trim() || !pr?._id || !organization || !aiReview?._id) return
    const text = chatInput
    setChatInput("")
    try {
      await sendChatMessage({
        orgId: organization._id,
        pullRequestId: pr._id,
        reviewId: aiReview._id,
        message: text,
      })
    } catch {
      toast.error("Failed to send message")
    }
  }

  // ─── GSAP animation ──────────────────────────────────
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

  // ─── Merge data: ghDetail (fresh from GitHub) overrides Convex for GitHub-native fields ───
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

  // ─── Loading states ───────────────────────────────────
  if (isBranchView) {
    return <BranchDetailView pullIdRaw={pullIdRaw} organization={organization} router={router} />
  }

  if (isCommitView) {
    // ═══ COMMIT DETAIL VIEW ═══
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
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/dashboard/pulls")}>← Back to Reviews</Button>
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
                <div className="w-1/3 h-full overflow-y-auto flex flex-col">
                  <div className="flex-1 px-6 py-6 space-y-4 overflow-y-auto">
                    {reviewChatMessages.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Bot className="size-10 mb-3 opacity-20" />
                        <p className="text-[14px] font-medium">AI Review Chat</p>
                        <p className="text-[12px] mt-1 opacity-60">Ask a follow-up question about this review</p>
                      </div>
                    )}
                    {reviewChatMessages.map((m, i) => (
                      <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] p-3 rounded-xl text-[13px] ${m.role === "user" ? "bg-[#5e6ad2] text-white" : "bg-muted/40 border border-border/40"}`}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                    {isReviewResponding && <div className="flex gap-1 px-3 py-2"><span className="size-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]" /><span className="size-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]" /><span className="size-2 bg-muted-foreground/40 rounded-full animate-bounce" /></div>}
                  </div>
                  <div className="p-4 border-t border-border/40 bg-muted/5">
                    <div className="flex items-center gap-2">
                      <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSendChat()} placeholder="Ask a follow-up question..." className="flex-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#5e6ad2]/40" />
                      <Button size="sm" onClick={handleSendChat} className="h-8 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white"><ArrowUpCircle className="size-4" /></Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // ═══ PR DETAIL VIEW (existing) ═══
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
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/dashboard/pulls")}>← Back to Reviews</Button>
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

          {/* ─── Header ─────────────────────────────────────── */}
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
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><Star className="size-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><MoreHorizontal className="size-3.5" /></Button>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Link2 className="size-3.5" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Copy className="size-3.5" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><GitFork className="size-3.5" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><ChevronDown className="size-3.5" /></Button>
            </div>
          </div>

          {/* ─── Split Layout ───────────────────────────────── */}
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
                  <Bot className="size-4" /> AI Review
                </button>
              </div>

              {/* GSAP Canvas */}
              <div className="w-[300%] flex-1 min-h-0 flex overflow-hidden" ref={sliderRef}>

                {/* ════ TAB 1: CONVERSATION ════ */}
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
                      <textarea
                        autoFocus value={bodyDraft}
                        onChange={e => setBodyDraft(e.target.value)}
                        onBlur={handleBodySave}
                        className="w-full text-[15px] leading-relaxed text-foreground mb-8 p-3 rounded-md border border-blue-500/30 bg-background outline-none resize-none min-h-[120px]"
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Paperclip className="size-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Link2 className="size-4" /></Button>
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
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/60 rounded-full"><MoreHorizontal className="size-3.5" /></Button>
                          </div>
                          {review.body && <div className="p-4 py-3"><p className="text-[14px] text-foreground leading-relaxed">{review.body}</p></div>}
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
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><Paperclip className="size-3.5" /></Button>
                          <Button variant="secondary" size="sm" disabled={!commentText.trim() || isCommenting} onClick={() => { setCommentText(""); toast.success("Comment posted") }} className="h-7 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium ml-2 rounded-[6px]">
                            {isCommenting ? "Posting..." : "Comment"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ════ TAB 2: FILES CHANGED ════ */}
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

                {/* ════ TAB 3: AI REVIEW ════ */}
                <div className="w-[33.333%] h-full relative flex flex-col items-center bg-background">
                  <div className="flex-1 w-full max-w-4xl mx-auto overflow-y-auto px-8 pt-10 pb-40 [&::-webkit-scrollbar]:hidden flex flex-col gap-6">

                    {/* ── No review yet ── */}
                    {!aiReview && (
                      <div className="h-full flex flex-col items-center justify-center mt-20">
                        <div className="size-14 rounded-2xl bg-[#5e6ad2]/10 flex items-center justify-center mb-5">
                          <Sparkles className="size-7 text-[#5e6ad2]" />
                        </div>
                        <span className="text-[16px] font-semibold text-foreground tracking-tight">AI Pull Request Review</span>
                        <span className="text-[13px] text-muted-foreground mt-1.5 max-w-xs text-center leading-relaxed">Generate a structured code review covering quality, security, and potential issues.</span>
                        <Button
                          onClick={handleTriggerReview}
                          disabled={isTriggering || !pr?._id}
                          className="mt-6 h-9 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium text-[13px] rounded-lg shadow-none gap-2 px-5"
                        >
                          {isTriggering ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                          Generate Review
                        </Button>
                      </div>
                    )}

                    {/* ── Review in progress ── */}
                    {aiReview && aiReview.step !== "completed" && aiReview.step !== "failed" && (
                      <div className="mt-16 flex flex-col items-center gap-6">
                        <div className="size-12 rounded-2xl bg-[#5e6ad2]/10 flex items-center justify-center">
                          <Loader2 className="size-6 text-[#5e6ad2] animate-spin" />
                        </div>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[14px] font-semibold text-foreground">Analyzing Pull Request</span>
                          <span className="text-[12px] text-muted-foreground capitalize">{(aiReview.step || "pending").replace(/_/g, " ")}</span>
                        </div>
                        {/* Progress steps */}
                        <div className="flex flex-col gap-2 mt-4 w-full max-w-xs">
                          {["gathering_context", "analyzing_files", "synthesizing"].map((step) => {
                            const stepOrder = ["pending","gathering_context","context_gathered","analyzing_files","files_analyzed","expanding_context","context_expanded","synthesizing","completed"]
                            const currentIdx = stepOrder.indexOf(aiReview.step)
                            const stepIdx = stepOrder.indexOf(step)
                            const isDone = currentIdx > stepIdx
                            const isActive = aiReview.step === step
                            return (
                              <div key={step} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-medium transition-all ${
                                isDone ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/5" :
                                isActive ? "text-[#5e6ad2] bg-[#5e6ad2]/5" :
                                "text-muted-foreground/50"
                              }`}>
                                {isDone ? <CheckCircle2 className="size-4 shrink-0" /> : isActive ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <CircleDashed className="size-4 shrink-0" />}
                                {step === "gathering_context" ? "Gathering PR context" : step === "analyzing_files" ? "Analyzing changed files" : "Synthesizing review"}
                              </div>
                            )
                          })}
                        </div>
                        {aiReview.contextStats && (
                          <div className="text-[11px] text-muted-foreground/60 mt-2">
                            {aiReview.contextStats.filesAnalyzed} files · {aiReview.contextStats.totalDiffLines} diff lines · {aiReview.contextStats.linkedIssuesCount} linked issues
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Review failed ── */}
                    {aiReview?.step === "failed" && (
                      <div className="mt-16 flex flex-col items-center gap-4">
                        <div className="size-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
                          <XCircle className="size-6 text-red-500" />
                        </div>
                        <span className="text-[14px] font-semibold text-foreground">Review Failed</span>
                        <span className="text-[12px] text-muted-foreground max-w-sm text-center leading-relaxed">{aiReview.error || "An unknown error occurred."}</span>
                        <Button onClick={handleTriggerReview} disabled={isTriggering} variant="outline" size="sm" className="gap-2 mt-2 text-[12px] shadow-none">
                          <RotateCcw className="size-3.5" /> Retry Review
                        </Button>
                      </div>
                    )}

                    {/* ── Completed review ── */}
                    {aiReview?.step === "completed" && aiReview.review && (() => {
                      const rv = aiReview.review as any
                      const verdictConfig = rv.verdict === "approve"
                        ? { icon: ThumbsUp, label: "Approve", color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20" }
                        : rv.verdict === "request-changes"
                        ? { icon: ThumbsDown, label: "Request Changes", color: "text-red-500", bg: "bg-red-500/10 border-red-500/20" }
                        : { icon: HelpCircle, label: "Discuss", color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20" }
                      const VerdictIcon = verdictConfig.icon
                      return (
                        <>
                          {/* Verdict banner */}
                          <div className={`flex items-center justify-between px-5 py-4 rounded-xl border ${verdictConfig.bg}`}>
                            <div className="flex items-center gap-3">
                              <VerdictIcon className={`size-5 ${verdictConfig.color}`} />
                              <div>
                                <span className={`text-[14px] font-semibold ${verdictConfig.color}`}>{verdictConfig.label}</span>
                                <span className="text-[11px] text-muted-foreground ml-2">Confidence: {Math.round((rv.confidence || 0) * 100)}%</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-mono">{aiReview.model || aiReview.provider}</span>
                              <span className="text-[10px] text-muted-foreground">{aiReview.processingTimeMs ? `${(aiReview.processingTimeMs / 1000).toFixed(1)}s` : ""}</span>
                            </div>
                          </div>

                          {/* Summary */}
                          <div className="bg-muted/10 border border-border/40 rounded-xl p-5">
                            <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Summary</h4>
                            <p className="text-[13px] text-foreground leading-relaxed">{rv.summary}</p>
                            <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed"><span className="font-semibold text-foreground">Intent:</span> {rv.intent}</p>
                          </div>

                          {/* Code Quality */}
                          <div className="bg-muted/10 border border-border/40 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2"><Zap className="size-3.5" /> Code Quality</h4>
                              <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${(rv.codeQuality?.score || 5) * 10}%`, backgroundColor: rv.codeQuality?.score >= 7 ? '#22c55e' : rv.codeQuality?.score >= 5 ? '#eab308' : '#ef4444' }} />
                                </div>
                                <span className={`text-[13px] font-bold tabular-nums ${rv.codeQuality?.score >= 7 ? 'text-emerald-500' : rv.codeQuality?.score >= 5 ? 'text-amber-500' : 'text-red-500'}`}>{rv.codeQuality?.score}/10</span>
                              </div>
                            </div>
                            {(rv.codeQuality?.highlights || []).length > 0 && (
                              <div className="mb-3">
                                <span className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wider">Highlights</span>
                                <ul className="mt-1.5 space-y-1">
                                  {rv.codeQuality.highlights.map((h: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80"><CheckCircle2 className="size-3.5 text-emerald-500 mt-0.5 shrink-0" />{h}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {(rv.codeQuality?.concerns || []).length > 0 && (
                              <div>
                                <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wider">Concerns</span>
                                <ul className="mt-1.5 space-y-1">
                                  {rv.codeQuality.concerns.map((c: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80"><AlertTriangle className="size-3.5 text-amber-500 mt-0.5 shrink-0" />{c}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Issues */}
                          {(rv.potentialIssues || []).length > 0 && (
                            <div className="bg-muted/10 border border-border/40 rounded-xl p-5">
                              <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2"><AlertTriangle className="size-3.5" /> Potential Issues</h4>
                              <div className="space-y-3">
                                {rv.potentialIssues.map((issue: any, i: number) => (
                                  <div key={i} className="flex items-start gap-3 text-[12px]">
                                    <span className={`px-1.5 py-[1px] rounded text-[10px] font-bold uppercase tracking-wider shrink-0 mt-0.5 ${
                                      issue.severity === "critical" ? "bg-red-500/10 text-red-500" :
                                      issue.severity === "warning" ? "bg-amber-500/10 text-amber-500" :
                                      "bg-blue-500/10 text-blue-500"
                                    }`}>{issue.severity}</span>
                                    <div className="flex-1">
                                      <span className="font-mono text-[11px] text-muted-foreground">{issue.file}</span>
                                      <p className="text-foreground/80 mt-0.5">{issue.description}</p>
                                      {issue.suggestion && <p className="text-muted-foreground mt-1 italic">→ {issue.suggestion}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Security */}
                          {rv.security?.hasRisks && (
                            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
                              <h4 className="text-[12px] font-semibold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-2"><Shield className="size-3.5" /> Security Findings</h4>
                              <ul className="space-y-1.5">
                                {(rv.security.findings || []).map((f: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80"><XCircle className="size-3.5 text-red-500 mt-0.5 shrink-0" />{f}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Tradeoffs */}
                          {(rv.tradeoffs || []).length > 0 && (
                            <div className="bg-muted/10 border border-border/40 rounded-xl p-5">
                              <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2"><Info className="size-3.5" /> Trade-offs</h4>
                              <ul className="space-y-1.5">
                                {rv.tradeoffs.map((t: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80"><CircleDashed className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />{t}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Retry button */}
                          <div className="flex justify-center pt-2">
                            <Button onClick={handleTriggerReview} disabled={isTriggering} variant="ghost" size="sm" className="gap-2 text-[11px] text-muted-foreground hover:text-foreground">
                              <RotateCcw className="size-3" /> Re-run Review
                            </Button>
                          </div>

                          {/* ── Follow-up Chat ── */}
                          {(aiChatMessages || []).length > 0 && (
                            <>
                              <div className="py-2"><Separator className="bg-border/60" /></div>
                              <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Follow-up</h4>
                              {aiChatMessages!.map((msg, i) => (
                                <div key={i} className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                  {msg.role === "user" ? (
                                    <div className="bg-muted/40 text-foreground text-[13px] px-4 py-2.5 rounded-[14px] rounded-tr-[4px] max-w-[80%] font-medium leading-relaxed border border-border/40">{msg.content}</div>
                                  ) : (
                                    <div className="flex gap-3 w-full max-w-[95%]">
                                      <Avatar className="size-[22px] border border-border/40 bg-zinc-100 dark:bg-zinc-800 shrink-0 mt-1"><AvatarFallback className="text-[10px]"><Bot className="size-3" /></AvatarFallback></Avatar>
                                      <div className="text-[13px] text-foreground/90 leading-[1.6] pt-1 font-medium bg-transparent whitespace-pre-wrap">{msg.content}</div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                        </>
                      )
                    })()}

                  </div>

                  {/* Chat input — only shown when review is completed */}
                  {aiReview?.step === "completed" && (
                    <div className="absolute w-full max-w-3xl px-8 bottom-6 left-1/2 -translate-x-1/2 z-20">
                      <div className="w-full bg-background border border-border/60 rounded-xl overflow-hidden flex flex-col min-h-[90px] transition-all focus-within:border-[#5e6ad2]/50">
                        <div className="flex-1 p-3 px-4">
                          <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat() } }} placeholder="Ask a follow-up question about this review..." className="w-full h-full bg-transparent resize-none border-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground/50 leading-relaxed font-medium [&::-webkit-scrollbar]:hidden" />
                        </div>
                        <div className="px-2 pb-2 flex items-center justify-end mt-auto bg-transparent">
                          <Button onClick={handleSendChat} disabled={!chatInput.trim()} size="icon" className="h-7 w-7 rounded-lg bg-[#5e6ad2] text-white hover:bg-[#5e6ad2]/90 transition-colors shadow-none disabled:opacity-50"><ArrowUpCircle className="size-4" strokeWidth={2.3} /></Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* ─── RIGHT: Properties Sidebar ─────────────────── */}
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
                  <div className="flex flex-col gap-1">
                    {ghReviewers.length > 0 ? ghReviewers.map((r: any, i: number) => (
                      <span key={i} className="flex items-center gap-1.5">
                        <Avatar className="size-[18px] border bg-emerald-100 text-emerald-600"><AvatarFallback className="text-[8px] font-bold">{getInitials(r.githubUsername)}</AvatarFallback></Avatar>
                        {r.githubUsername}
                        <span className={`ml-1 px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-wider ${
                          r.state === "approved" ? "bg-emerald-500/10 text-emerald-500" :
                          r.state === "changes_requested" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500"
                        }`}>{(r.state || "pending").replace(/_/g, " ")}</span>
                      </span>
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
