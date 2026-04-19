"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { createGitHubComment, updateGitHubIssue } from "@/lib/github/actions"
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
import {
  MoreHorizontal, ListFilter, SlidersHorizontal, AlertCircle, ChevronRight, CheckCircle2, CircleDashed, SignalHigh, SignalMedium, SignalLow, Plus, Calendar, MessageSquare, Zap, Bug, Users, Bookmark, CircleDot, GitPullRequest, GitMerge, XCircle, Milestone, Activity, Link2, GitBranch, ChevronDown, Check, Star, Copy, X, Loader2, Bold, Italic, Link as LinkIcon, List, Eye, Edit2, History, MessageCircle, Paperclip, Circle, PlayCircle, FolderKanban, User, Tag
} from "lucide-react"

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ─── Config Maps ──────────────────────────────────────────────
type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled"
type IssuePriority = "urgent" | "high" | "medium" | "low" | "none"

const statusOptions: { value: IssueStatus; label: string; icon: any; color: string }[] = [
  { value: "backlog", label: "Backlog", icon: CircleDashed, color: "text-muted-foreground" },
  { value: "todo", label: "Todo", icon: Circle, color: "text-muted-foreground" },
  { value: "in_progress", label: "In Progress", icon: CircleDot, color: "text-yellow-500" },
  { value: "in_review", label: "In Review", icon: CircleDot, color: "text-blue-500" },
  { value: "done", label: "Done", icon: CheckCircle2, color: "text-purple-500" },
  { value: "cancelled", label: "Cancelled", icon: XCircle, color: "text-muted-foreground" },
]

const priorityOptions: { value: IssuePriority; label: string; icon: any; color: string }[] = [
  { value: "none", label: "No priority", icon: CircleDashed, color: "text-muted-foreground" },
  { value: "low", label: "Low", icon: SignalLow, color: "text-muted-foreground" },
  { value: "medium", label: "Medium", icon: SignalMedium, color: "text-orange-500" },
  { value: "high", label: "High", icon: SignalHigh, color: "text-orange-500" },
  { value: "urgent", label: "Urgent", icon: AlertCircle, color: "text-red-500" },
]

const labelBgMap: Record<string, string> = {
  "#ef4444": "bg-red-500", "#3b82f6": "bg-blue-500", "#f97316": "bg-orange-500",
  "#a855f7": "bg-purple-500", "#eab308": "bg-yellow-500", "#06b6d4": "bg-cyan-500",
  "#22c55e": "bg-green-500", "#ec4899": "bg-pink-500",
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "just now"
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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

// ─── Main Page ────────────────────────────────────────────────
export default function IssueDetailPage({ params }: { params: Promise<{ issueId: string }> }) {
  const resolvedParams = React.use(params)
  const router = useRouter()
  const { organization } = useOrganization()
  const [commentText, setCommentText] = React.useState("")
  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState("")
  const [editingBody, setEditingBody] = React.useState(false)
  const [bodyDraft, setBodyDraft] = React.useState("")
  const [isCommenting, setIsCommenting] = React.useState(false)

  const issue = useQuery(
    api.issues.getByIdentifier,
    organization ? { orgId: organization._id, identifier: resolvedParams.issueId } : "skip"
  )
  const comments = useQuery(api.comments.listByIssue, issue ? { issueId: issue._id } : "skip")
  const activityEvents = useQuery(api.activityEvents.listByIssue, issue ? { issueId: issue._id } : "skip")
  const members = useQuery(api.members.listByOrg, organization ? { orgId: organization._id } : "skip")
  const teams = useQuery(api.teams.listByOrg, organization ? { orgId: organization._id } : "skip")
  const projects = useQuery(api.projects.listByOrg, organization ? { orgId: organization._id } : "skip")
  const labels = useQuery(api.labels.listByOrg, organization ? { orgId: organization._id } : "skip")

  const updateIssue = useMutation(api.issues.update)
  const createComment = useMutation(api.comments.create)
  const linkCommentToGH = useMutation(api.comments.linkToGitHub)

  // ─── Update helpers ───────────────────────────────────────
  const handleUpdate = async (field: string, value: any, toastMsg?: string) => {
    if (!issue) return
    try {
      await updateIssue({ issueId: issue._id, [field]: value })
      if (toastMsg) toast.success(toastMsg)
    } catch (err) {
      toast.error("Failed to update issue")
    }
  }

  const handleStatusChange = async (newStatus: IssueStatus) => {
    if (!issue || newStatus === issue.status) return
    const label = statusOptions.find(s => s.value === newStatus)?.label || newStatus
    await handleUpdate("status", newStatus, `Status changed to ${label}`)
    // Sync to GitHub if linked
    if (issue.githubRepoFullName && issue.githubIssueNumber && organization) {
      const ghState = (newStatus === "done" || newStatus === "cancelled") ? "closed" : "open"
      try {
        await updateGitHubIssue(organization.githubInstallationId, issue.githubRepoFullName, issue.githubIssueNumber, { state: ghState })
      } catch { /* non-blocking */ }
    }
  }

  const handleTitleSave = async () => {
    if (!issue || !titleDraft.trim() || titleDraft.trim() === issue.title) {
      setEditingTitle(false); return
    }
    await handleUpdate("title", titleDraft.trim(), "Title updated")
    if (issue.githubRepoFullName && issue.githubIssueNumber && organization) {
      try { await updateGitHubIssue(organization.githubInstallationId, issue.githubRepoFullName, issue.githubIssueNumber, { title: titleDraft.trim() }) } catch {}
    }
    setEditingTitle(false)
  }

  const handleBodySave = async () => {
    if (!issue) { setEditingBody(false); return }
    const newBody = bodyDraft.trim()
    if (newBody === (issue.body || "")) { setEditingBody(false); return }
    await handleUpdate("body", newBody || undefined)
    if (issue.githubRepoFullName && issue.githubIssueNumber && organization) {
      try { await updateGitHubIssue(organization.githubInstallationId, issue.githubRepoFullName, issue.githubIssueNumber, { body: newBody }) } catch {}
    }
    setEditingBody(false)
  }

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !issue) return
    setIsCommenting(true)
    try {
      const commentId = await createComment({ issueId: issue._id, body: commentText })
      // Sync to GitHub
      if (issue.githubRepoFullName && issue.githubIssueNumber && organization) {
        try {
          const ghResult = await createGitHubComment(
            organization.githubInstallationId, issue.githubRepoFullName,
            issue.githubIssueNumber, commentText
          )
          await linkCommentToGH({ commentId, githubCommentId: ghResult.id })
        } catch { /* non-blocking */ }
      }
      setCommentText("")
    } catch {
      toast.error("Failed to post comment")
    } finally {
      setIsCommenting(false)
    }
  }

  const handleLabelToggle = async (labelId: string) => {
    if (!issue) return
    const current = issue.labelIds || []
    const newIds = current.includes(labelId as any)
      ? current.filter((id: any) => id !== labelId)
      : [...current, labelId]
    await handleUpdate("labelIds", newIds)
  }

  // ─── Loading / Not Found ──────────────────────────────────
  if (issue === undefined) {
    return (
      <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </SidebarInset></SidebarProvider>
    )
  }
  if (issue === null) {
    return (
      <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
          <CircleDot className="size-8 mb-3 opacity-30" />
          <p className="text-[14px] font-medium">Issue not found</p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/dashboard/issues")}>← Back to Issues</Button>
        </div>
      </SidebarInset></SidebarProvider>
    )
  }

  const sc = statusOptions.find(s => s.value === issue.status) || statusOptions[1]
  const pc = priorityOptions.find(p => p.value === issue.priority) || priorityOptions[0]
  const StatusIcon = sc.icon
  const displayId = issue.identifier.startsWith("#") ? issue.identifier : `#${issue.sequenceNumber}`

  // Unified timeline
  const timeline = [
    ...(activityEvents || []).map((e: any) => ({ type: "event" as const, createdAt: e.createdAt, data: e })),
    ...(comments || []).map((c: any) => ({ type: "comment" as const, createdAt: c.createdAt, data: c })),
  ].sort((a, b) => a.createdAt - b.createdAt)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col overflow-hidden text-sm bg-background">

          {/* Header */}
          <div className="h-14 flex items-center justify-between px-6 border-b shrink-0 bg-background/95 backdrop-blur z-20 relative text-sm">
            <div className="flex items-center text-[13px] font-medium text-foreground gap-1.5">
              <SidebarTrigger className="-ml-3 mr-1" />
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => router.push("/dashboard/issues")}>
                <CircleDot className="size-3.5 fill-green-500/20 text-green-500" /> Issues
              </Button>
              <ChevronRight className="size-3 text-muted-foreground/40" />
              <span className="text-muted-foreground/60 tabular-nums">{issue.identifier}</span>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><Star className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Star issue</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><MoreHorizontal className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">More actions</TooltipContent></Tooltip>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Link2 className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Copy link</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Copy className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Copy ID</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-blue-500 border-border/60 bg-blue-500/5"><GitBranch className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Create branch</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><ChevronDown className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Workflow templates</TooltipContent></Tooltip>
            </div>
          </div>

          {/* Split Layout */}
          <div className="flex-1 flex min-h-0 overflow-hidden">

            {/* LEFT: Issue Body */}
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden bg-background">
              <div className="max-w-[780px] mx-auto w-full px-16 py-12">

                {/* Status badge + meta */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12.5px] font-medium ${
                    sc.value === "done" ? "bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400" :
                    sc.value === "cancelled" ? "bg-muted/40 border-border/40 text-muted-foreground" :
                    "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
                  }`}>
                    <StatusIcon className="size-3.5" strokeWidth={2.5} /> {sc.label}
                  </div>
                  <div className="text-[13px] text-muted-foreground flex items-center gap-1 font-medium">
                    <span className="text-foreground">{issue.creator?.displayName || "Unknown"}</span> opened {timeAgo(issue.createdAt)} · {issue.commentCount} comment{issue.commentCount !== 1 ? "s" : ""}
                  </div>
                </div>

                {/* Editable Title */}
                {editingTitle ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={e => { if (e.key === "Enter") handleTitleSave(); if (e.key === "Escape") setEditingTitle(false) }}
                    className="text-3xl font-semibold tracking-tight mb-8 text-foreground leading-[1.3] w-full bg-transparent outline-none border-b-2 border-blue-500/40 pb-1"
                  />
                ) : (
                  <h1
                    className="text-3xl font-semibold tracking-tight mb-8 text-foreground leading-[1.3] flex items-baseline gap-3 cursor-pointer hover:bg-muted/10 rounded-md px-2 -mx-2 py-1 transition-colors"
                    onClick={() => { setTitleDraft(issue.title); setEditingTitle(true) }}
                  >
                    {issue.title}
                    <span className="text-muted-foreground/40 font-medium text-2xl tabular-nums">{displayId}</span>
                  </h1>
                )}

                {/* Editable Description */}
                {editingBody ? (
                  <textarea
                    autoFocus
                    value={bodyDraft}
                    onChange={e => setBodyDraft(e.target.value)}
                    onBlur={handleBodySave}
                    className="w-full text-[15px] leading-relaxed text-foreground mb-8 p-3 rounded-md border border-blue-500/30 bg-background outline-none resize-none min-h-[120px]"
                  />
                ) : (
                  <div 
                    onClick={() => { setBodyDraft(issue.body || ""); setEditingBody(true) }}
                    className="mb-8 p-2 rounded-md hover:bg-muted/10 cursor-text transition-colors -ml-2 prose prose-sm max-w-none text-muted-foreground dark:prose-invert prose-headings:text-foreground prose-a:text-[#5e6ad2] prose-headings:font-medium prose-p:leading-relaxed"
                  >
                    {!issue.body ? (
                      <p className="text-[15px] text-muted-foreground/60 m-0">Add description...</p>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {issue.body}
                      </ReactMarkdown>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-8">
                  <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Paperclip className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Add attachment</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Link2 className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Add link</TooltipContent></Tooltip>
                </div>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground -ml-2 mb-8">
                  <Plus className="size-4" /> Add sub-issues
                  {issue.subIssues && issue.subIssues.length > 0 && <span className="text-[11px] bg-muted/60 px-1.5 rounded-full ml-1">{issue.subIssues.length}</span>}
                </Button>
                <div className="py-12 mt-4"><Separator className="bg-border/60" /></div>

                {/* Activity Feed */}
                <div className="mt-4">
                  <h3 className="font-semibold text-[14px] text-foreground flex items-center justify-between mb-8">Activity Feed</h3>

                  {timeline.map((item, idx) => {
                    if (item.type === "event") {
                      const evt = item.data
                      if (evt.eventType === "comment_created") return null
                      let text = evt.eventType.replace(/_/g, " ")
                      let iconBg = "bg-muted/40 border-border/40 text-muted-foreground"
                      let EvtIcon = Activity
                      if (evt.eventType === "issue_created") { text = "created the issue"; iconBg = "bg-green-500/10 border-green-500/20 text-green-600"; EvtIcon = CircleDot }
                      else if (evt.eventType === "issue_status_changed") {
                        const m = evt.metadata as any; text = `changed status from ${m?.from || "?"} to ${m?.to || "?"}`
                      }
                      return (
                        <div key={`e-${idx}`} className="flex items-start gap-3 mb-6 px-2">
                          <div className={`size-6 shrink-0 rounded-full flex items-center justify-center border mt-0.5 ${iconBg}`}><EvtIcon className="size-3" strokeWidth={2.5} /></div>
                          <div className="text-[13px] text-muted-foreground leading-relaxed pt-1">
                            <span className="font-semibold text-foreground">{evt.actorDisplayName}</span> {text}
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
                                {c.githubCommentId && <span className="text-[10px] bg-muted/40 px-1.5 py-0.5 rounded-full ml-1 text-muted-foreground">synced</span>}
                              </div>
                            </div>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/60 rounded-full"><MoreHorizontal className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="left" className="text-xs">Comment actions</TooltipContent></Tooltip>
                          </div>
                          <div className="p-4 py-3"><p className="text-[14px] text-foreground leading-relaxed whitespace-pre-wrap">{c.body}</p></div>
                        </div>
                      )
                    }
                    return null
                  })}

                  {/* Comment Input */}
                  <div className="bg-muted/20 border border-border/60 rounded-xl overflow-hidden flex flex-col min-h-[90px] hover:bg-muted/30 mt-4 transition-colors">
                    <div className="p-4 px-5 flex-1">
                      <textarea value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a comment..." className="w-full h-full bg-transparent resize-none border-none outline-none text-[14px] text-foreground placeholder:text-muted-foreground font-medium min-h-[40px]" />
                    </div>
                    <div className="px-4 py-2 bg-muted/10 flex items-center justify-end gap-1 border-t border-border/10">
                      <Button variant="ghost" size="sm" className="h-7 text-muted-foreground gap-1.5 hover:bg-transparent" onClick={() => handleStatusChange("cancelled")}><AlertCircle className="size-3.5" /> Close as not planned</Button>
                      <Button variant="secondary" size="sm" disabled={!commentText.trim() || isCommenting} onClick={handleSubmitComment} className="h-7 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium ml-2 rounded-[6px]">
                        {isCommenting ? "Posting..." : "Comment"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Properties Sidebar */}
            <div className="w-[300px] xl:w-[320px] overflow-y-auto p-6 shrink-0 [&::-webkit-scrollbar]:hidden border-l border-border/60 bg-background flex flex-col gap-6">
              <div className="flex flex-col gap-1 bg-muted/30 p-4 rounded-xl">

                {/* Status */}
                <EditablePropertyRow label="State" icon={CircleDot}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
                        <sc.icon className={`size-3.5 ${sc.color}`} strokeWidth={2.5} /> {sc.label}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px] p-1">
                      {statusOptions.map(opt => (
                        <DropdownMenuItem key={opt.value} onClick={() => handleStatusChange(opt.value)} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <div className="flex items-center gap-2"><opt.icon className={`size-3.5 ${opt.color}`} /> {opt.label}</div>
                          {issue.status === opt.value && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                {/* Assignee */}
                <EditablePropertyRow label="Assignee" icon={User}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
                        {issue.assignee ? (
                          <><Avatar className="size-[18px] border bg-orange-100 text-orange-600"><AvatarFallback className="text-[8px] font-bold">{getInitials(issue.assignee.displayName)}</AvatarFallback></Avatar> {issue.assignee.displayName}</>
                        ) : <span className="text-muted-foreground">Unassigned</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[200px] p-1">
                      <DropdownMenuItem onClick={() => handleUpdate("assigneeId", undefined)} className="py-1.5 px-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                        <User className="size-3.5" /> Unassigned
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(members || []).map(m => (
                        <DropdownMenuItem key={m._id} onClick={() => handleUpdate("assigneeId", m._id, `Assigned to ${m.displayName}`)} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <div className="flex items-center gap-2">
                            <Avatar className="size-5"><AvatarFallback className="text-[8px] bg-blue-500/10 text-blue-600">{getInitials(m.displayName)}</AvatarFallback></Avatar>
                            {m.displayName}
                          </div>
                          {issue.assigneeId === m._id && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                {/* Priority */}
                <EditablePropertyRow label="Priority" icon={pc.icon}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
                        <pc.icon className={`size-3.5 ${pc.color}`} /> {pc.label}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[150px] p-1">
                      {priorityOptions.map(opt => (
                        <DropdownMenuItem key={opt.value} onClick={() => handleUpdate("priority", opt.value, `Priority set to ${opt.label}`)} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <div className="flex items-center gap-2"><opt.icon className={`size-3.5 ${opt.color}`} /> {opt.label}</div>
                          {issue.priority === opt.value && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                {/* Labels */}
                <EditablePropertyRow label="Labels" icon={Tag}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer flex-wrap">
                        {issue.labels && issue.labels.length > 0 ? (
                          issue.labels.map((lbl: any, i: number) => (
                            <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-border/40 text-[10px] bg-muted/20 font-medium">
                              <span className={`size-1.5 rounded-full ${labelBgMap[lbl.color] || "bg-muted-foreground"}`} />{lbl.name}
                            </span>
                          ))
                        ) : <span className="text-muted-foreground">No labels</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px] p-1">
                      {(labels || []).map(lbl => (
                        <DropdownMenuItem key={lbl._id} onClick={(e) => { e.preventDefault(); handleLabelToggle(lbl._id) }} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <div className="flex items-center gap-2">
                            <div className={`size-2.5 rounded-full ${labelBgMap[lbl.color] || "bg-muted-foreground"}`} /> {lbl.name}
                          </div>
                          {issue.labelIds?.includes(lbl._id as any) && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                {/* Team */}
                <EditablePropertyRow label="Team" icon={Users}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
                        {issue.team ? <span>{issue.team.name}</span> : <span className="text-muted-foreground">No team</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px] p-1">
                      <DropdownMenuItem onClick={() => handleUpdate("teamId", undefined)} className="py-1.5 px-2 text-[12px] text-muted-foreground">None</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(teams || []).map(t => (
                        <DropdownMenuItem key={t._id} onClick={() => handleUpdate("teamId", t._id, `Moved to ${t.name}`)} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <span>{t.name}</span>
                          {issue.teamId === t._id && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                {/* Project */}
                <EditablePropertyRow label="Project" icon={FolderKanban}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
                        {issue.project ? <span>{issue.project.name}</span> : <span className="text-muted-foreground">No project</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px] p-1">
                      <DropdownMenuItem onClick={() => handleUpdate("projectId", undefined)} className="py-1.5 px-2 text-[12px] text-muted-foreground">None</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(projects || []).map(p => (
                        <DropdownMenuItem key={p._id} onClick={() => handleUpdate("projectId", p._id)} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                          <span>{p.name}</span>
                          {issue.projectId === p._id && <Check className="size-3" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </EditablePropertyRow>

                {/* Milestone (read-only from GitHub) */}
                {issue.githubMilestone && (
                  <EditablePropertyRow label="Milestone" icon={Milestone}>
                    <span className="text-foreground flex items-center gap-1.5"><Milestone className="size-3 text-muted-foreground" /> {issue.githubMilestone}</span>
                  </EditablePropertyRow>
                )}

              </div>

              {/* Linked PRs (read-only from GitHub) */}
              {issue.linkedPRs && issue.linkedPRs.length > 0 && (
                <>
                  <Separator className="bg-border/60" />
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Linked Pull Requests</span>
                    {issue.linkedPRs.map((pr: any, i: number) => (
                      <a key={i} href={pr.githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/40 hover:bg-muted/30 transition-colors cursor-pointer group">
                        <GitPullRequest className={`size-4 shrink-0 ${pr.state === "merged" ? "text-purple-500" : pr.state === "open" ? "text-green-500" : "text-red-500"}`} />
                        <div className="flex flex-col min-w-0">
                          <span className="text-[12px] font-medium text-foreground truncate group-hover:underline">#{pr.githubPrNumber} {pr.title}</span>
                          <span className="text-[11px] text-muted-foreground capitalize">{pr.state}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </>
              )}

              {/* GitHub Repo Link */}
              {issue.githubRepoFullName && (
                <>
                  <Separator className="bg-border/60" />
                  <a href={issue.githubUrl || `https://github.com/${issue.githubRepoFullName}/issues/${issue.githubIssueNumber}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between group cursor-pointer">
                    <div className="flex items-center gap-2.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground group-hover:text-foreground transition-colors">
                        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" />
                      </svg>
                      <span className="text-[13px] font-medium text-muted-foreground group-hover:text-foreground transition-colors tracking-tight">{issue.githubRepoFullName}</span>
                    </div>
                    <ChevronRight className="size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </a>
                </>
              )}
            </div>

          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
