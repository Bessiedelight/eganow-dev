"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import gsap from "gsap"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
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
  FolderKanban, Star, MoreHorizontal, Link2, Copy, GitFork, ChevronDown,
  Sparkles, Target, Plus, Lock, AlignLeft, Users, CalendarClock, Smile,
  Filter, SortAsc, Grid2X2, Settings2, CheckCircle2, ChevronRight, PieChart,
  Calendar, LayoutGrid, List, CircleDot, User, SignalHigh, Activity, Paperclip, AlertCircle, RefreshCw, MessageSquare,
  GitPullRequest, GitMerge, FileCode2, GitCommit,
  Timer, Gauge, ShieldAlert, Hourglass, XCircle, Clock
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd"
import type { Id } from "@/convex/_generated/dataModel"

type Tab = "overview" | "board" | "traceability" | "dashboard"

const statusMap: Record<string, { label: string; color: string; bg: string; border: string; dotColor: string }> = {
  planned: { label: "Planned", color: "text-muted-foreground", bg: "bg-muted/40", border: "border-border/40", dotColor: "text-muted-foreground" },
  in_progress: { label: "In progress", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", dotColor: "text-blue-500" },
  paused: { label: "Paused", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", dotColor: "text-yellow-500" },
  completed: { label: "Completed", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20", dotColor: "text-emerald-500" },
  cancelled: { label: "Cancelled", color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20", dotColor: "text-red-500" },
}

export default function ProjectDetailView({ params }: { params: Promise<{ projectId: string }> }) {
  const router = useRouter()
  const resolvedParams = React.use(params)
  const projectId = resolvedParams.projectId as Id<"projects">
  const { organization } = useOrganization()

  const project = useQuery(api.projects.getByIdEnriched, { projectId })
  const issues = useQuery(api.projects.listIssues, { projectId })
  const prs = useQuery(api.projects.listPullRequests, { projectId })
  const stats = useQuery(api.projects.getStats, { projectId })
  const activity = useQuery(api.projects.listActivity, { projectId })
  const updateIssue = useMutation(api.issues.update)

  const [view, setView] = React.useState<Tab>("overview")
  const sliderRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!sliderRef.current) return
    const index = { overview: 0, board: 1, traceability: 2, dashboard: 3 }[view] || 0
    gsap.to(sliderRef.current, {
      x: `-${index * (100 / 4)}%`,
      duration: 0.4,
      ease: "power2.inOut"
    })
  }, [view])

  const st = statusMap[project?.status || "planned"] || statusMap.planned

  if (project === undefined) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-hidden bg-background">
          <div className="flex items-center justify-center h-full">
            <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  if (project === null) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-hidden bg-background">
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FolderKanban className="size-8 mb-3 opacity-30" />
            <p className="text-[14px] font-medium">Project not found</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push("/dashboard/projects")}>Back to Projects</Button>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col overflow-hidden text-sm bg-background">
          
          {/* ─── Header ─────────────────────────────────────── */}
          <div className="h-14 flex items-center justify-between px-6 border-b shrink-0 bg-background/95 backdrop-blur z-20 relative text-sm">
            <div className="flex items-center text-[13px] font-medium text-foreground gap-1.5">
              <SidebarTrigger className="-ml-3 mr-1" />
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => router.push("/dashboard/projects")}>
                Projects
              </Button>
              <ChevronRight className="size-3 text-muted-foreground/40" />
              <span className="text-foreground tracking-tight font-medium">{project.name}</span>
              <div className={`flex items-center gap-1.5 px-2 py-0.5 ml-2 rounded-full border text-[11px] font-medium ${st.bg} ${st.border} ${st.color}`}>
                <span className="size-1.5 rounded-full bg-current opacity-80" /> {st.label}
              </div>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground ml-1"><Star className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Star project</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><MoreHorizontal className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">More actions</TooltipContent></Tooltip>
            </div>
            
            <div className="flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Link2 className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Copy link</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Copy className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Copy ID</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><ChevronDown className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">More options</TooltipContent></Tooltip>
            </div>
          </div>

          {/* ─── Tab Navigator ──────────────────────────────── */}
          <div className="h-12 border-b border-border/40 flex items-center px-6 gap-6 text-[13px] font-medium text-muted-foreground bg-background z-10 shrink-0">
            <button onClick={() => setView('overview')} className={`h-full border-b-2 transition-colors flex items-center gap-1.5 ${view === 'overview' ? 'border-[#5e6ad2] text-foreground font-semibold' : 'border-transparent hover:text-foreground'}`}>
               <Target className="size-3.5" /> Overview
            </button>
            <button onClick={() => setView('board')} className={`h-full border-b-2 transition-colors flex items-center gap-1.5 ${view === 'board' ? 'border-[#5e6ad2] text-foreground font-semibold' : 'border-transparent hover:text-foreground'}`}>
               <FolderKanban className="size-3.5" /> Board
            </button>
            <button onClick={() => setView('traceability')} className={`h-full border-b-2 transition-colors flex items-center gap-1.5 ${view === 'traceability' ? 'border-[#5e6ad2] text-foreground font-semibold' : 'border-transparent hover:text-foreground'}`}>
               <GitCommit className="size-3.5" /> Traceability
            </button>
            <button onClick={() => setView('dashboard')} className={`h-full border-b-2 transition-colors flex items-center gap-1.5 ${view === 'dashboard' ? 'border-[#5e6ad2] text-foreground font-semibold' : 'border-transparent hover:text-foreground'}`}>
               <PieChart className="size-3.5" /> Dashboard
            </button>
          </div>

          {/* ─── Main Content Area ──────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <div className="h-full flex" style={{ width: "400%" }} ref={sliderRef}>
              <div className="h-full flex-col flex overflow-hidden shrink-0" style={{ width: "25%" }}><OverviewTab project={project} activity={activity} issues={issues} prs={prs} /></div>
              <div className="h-full flex-col flex overflow-hidden shrink-0" style={{ width: "25%" }}><BoardTab issues={issues} updateIssue={updateIssue} /></div>
              <div className="h-full flex-col flex overflow-hidden shrink-0" style={{ width: "25%" }}><TraceabilityTab issues={issues} prs={prs} activity={activity} /></div>
              <div className="h-full flex-col flex overflow-hidden shrink-0" style={{ width: "25%" }}><DashboardTab stats={stats} prs={prs} /></div>
            </div>
          </div>

        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// ─── Editable Property Row Helper ──────────────────────────────────────────
function EditablePropertyRow({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) {
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

// ───────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ───────────────────────────────────────────────────────────────────────────
function OverviewTab({ project, activity, issues, prs }: { project: any; activity: any[] | undefined; issues: any[] | undefined; prs: any[] | undefined }) {
  const recentIssues = issues?.slice(0, 5) || []
  const recentPRs = prs?.filter((p: any) => p.state === "open").slice(0, 5) || []
  const recentActivity = activity?.slice(0, 10) || []
  const repos = project.githubRepoFullNames || []
  const totalIssues = project.counts?.totalIssues ?? 0
  const doneIssues = project.counts?.doneIssues ?? 0
  const progressPct = totalIssues > 0 ? Math.round((doneIssues / totalIssues) * 100) : 0

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* ─── LEFT: Main Content ─────────────────────────── */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden bg-background">
        <div className="max-w-[880px] mx-auto w-full px-12 py-12">
          
          {/* Top Section: Brief & Description */}
          <h1 className="text-3xl font-semibold tracking-tight mb-6 text-foreground leading-[1.3] flex items-center gap-3">
            {project.name}
          </h1>

          <p className="text-[15px] leading-relaxed text-muted-foreground mb-8 p-2 -mx-2 rounded-md hover:bg-muted/10 cursor-text transition-colors">
            {project.description || "No description provided. Click to add one."}
          </p>

          <div className="flex items-center gap-2 mb-8">
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Paperclip className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Add attachment</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/40"><Link2 className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom" className="text-xs">Add link</TooltipContent></Tooltip>
          </div>

          <div className="py-2 mb-10"><Separator className="bg-border" /></div>

          {/* Linked Repositories */}
          <div className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[15px] font-semibold text-foreground">Linked Repositories</h3>
            </div>
            
            {repos.length === 0 ? (
              <div className="border border-border/60 rounded-xl p-6 text-center text-[13px] text-muted-foreground bg-muted/10">
                <GitFork className="size-5 mx-auto mb-2 opacity-40" />
                No repositories linked. Edit the project to connect GitHub repos.
              </div>
            ) : (
              <div className="border border-border/60 rounded-xl overflow-hidden bg-background">
                <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-border/40 bg-muted/20 text-[12px] font-medium text-muted-foreground">
                  <div className="col-span-6">Repository</div>
                  <div className="col-span-3">Issues</div>
                  <div className="col-span-3">Open PRs</div>
                </div>
                <div className="divide-y divide-border/40">
                  {repos.map((repo: string) => {
                    const repoIssues = issues?.filter((i: any) => i.githubRepoFullName === repo) || []
                    const repoPRs = prs?.filter((p: any) => p.githubRepoFullName === repo && p.state === "open") || []
                    return (
                      <div key={repo} className="grid grid-cols-12 gap-4 px-5 py-3.5 items-center group hover:bg-muted/10 transition-colors">
                        <div className="col-span-6 flex items-center gap-3">
                          <div className="size-6 rounded bg-muted/40 border border-border/40 flex items-center justify-center shrink-0">
                            <GitFork className="size-3 text-muted-foreground" />
                          </div>
                          <span className="text-[13px] font-medium text-foreground font-mono">{repo}</span>
                        </div>
                        <div className="col-span-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <CircleDot className="size-3 opacity-60" /> {repoIssues.length} issue{repoIssues.length !== 1 ? "s" : ""}
                        </div>
                        <div className="col-span-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <GitPullRequest className="size-3 opacity-60" /> {repoPRs.length} open
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="py-2 mb-10"><Separator className="bg-border" /></div>

          {/* Recent Issues */}
          <div className="mb-12">
            <h3 className="text-[15px] font-semibold text-foreground mb-6">Recent Issues</h3>
            {recentIssues.length === 0 ? (
              <div className="text-[13px] text-muted-foreground/60 py-4">No issues linked to this project yet.</div>
            ) : (
              <div className="space-y-2">
                {recentIssues.map((issue: any) => (
                  <div key={issue._id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/20 transition-colors group border border-transparent hover:border-border/40">
                    <CircleDot className={`size-3.5 shrink-0 ${issue.status === "done" ? "text-emerald-500" : issue.status === "in_progress" ? "text-yellow-500" : "text-muted-foreground/50"}`} />
                    <span className="text-[12px] font-mono text-muted-foreground shrink-0">{issue.identifier}</span>
                    <span className="text-[13px] font-medium text-foreground truncate flex-1">{issue.title}</span>
                    {issue.priority !== "none" && (
                      <SignalHigh className={`size-3.5 shrink-0 ${issue.priority === "urgent" ? "text-red-500" : issue.priority === "high" ? "text-orange-500" : "text-yellow-500"}`} />
                    )}
                    {issue.assignee && (
                      <Avatar className="size-[20px] border shrink-0"><AvatarFallback className="text-[7px] bg-blue-100 text-blue-600 font-bold">{issue.assignee.displayName?.substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="py-2 mb-10"><Separator className="bg-border" /></div>

          {/* Activity Feed */}
          <div className="mb-8">
            <h3 className="font-semibold text-[15px] text-foreground flex items-center justify-between mb-8">Recent Activity</h3>
            
            {recentActivity.length === 0 ? (
              <div className="text-[13px] text-muted-foreground/60 py-4">No activity recorded yet. Activity will appear here as issues and PRs are updated.</div>
            ) : (
              <div className="space-y-6">
                {recentActivity.map((event: any) => (
                  <div key={event._id} className="flex items-start gap-3 px-2">
                    <div className="size-6 shrink-0 rounded-full flex items-center justify-center border mt-0.5 bg-muted/40 border-border/40 text-muted-foreground">
                      {event.eventType === "issue_created" && <Target className="size-3" strokeWidth={2.5} />}
                      {event.eventType === "issue_status_changed" && <CircleDot className="size-3" strokeWidth={2.5} />}
                      {event.eventType === "pr_opened" && <GitPullRequest className="size-3" strokeWidth={2.5} />}
                      {event.eventType === "pr_merged" && <GitMerge className="size-3" strokeWidth={2.5} />}
                      {event.eventType === "comment_added" && <MessageSquare className="size-3" strokeWidth={2.5} />}
                      {!["issue_created", "issue_status_changed", "pr_opened", "pr_merged", "comment_added"].includes(event.eventType) && <Activity className="size-3" strokeWidth={2.5} />}
                    </div>
                    <div className="text-[13px] text-muted-foreground leading-relaxed pt-1">
                      <span className="font-semibold text-foreground">{event.actorDisplayName || "System"}</span>{" "}
                      {event.eventType === "issue_created" && "created an issue"}
                      {event.eventType === "issue_status_changed" && `changed status to ${event.newValue || "updated"}`}
                      {event.eventType === "pr_opened" && "opened a pull request"}
                      {event.eventType === "pr_merged" && "merged a pull request"}
                      {event.eventType === "comment_added" && "added a comment"}
                      {!["issue_created", "issue_status_changed", "pr_opened", "pr_merged", "comment_added"].includes(event.eventType) && event.eventType?.replace(/_/g, " ")}
                      <div className="text-[11.5px] mt-1 text-muted-foreground/60">
                        {event.createdAt ? new Date(event.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ─── RIGHT: Properties Sidebar ──────────────────── */}
      <div className="w-[300px] xl:w-[320px] overflow-y-auto p-6 shrink-0 [&::-webkit-scrollbar]:hidden border-l border-border/60 bg-background flex flex-col gap-6">
        
        <div className="flex flex-col gap-1 bg-muted/20 border border-border/40 p-4 rounded-xl">
          {/* Status */}
          <EditablePropertyRow label="Status" icon={CircleDot}>
            <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
              <CircleDot className={`size-3.5 ${(statusMap[project.status] || statusMap.planned).dotColor}`} strokeWidth={2.5} /> {(statusMap[project.status] || statusMap.planned).label}
            </button>
          </EditablePropertyRow>

          {/* Lead */}
          <EditablePropertyRow label="Lead" icon={User}>
            <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer">
              {project.leadMember ? (
                <><Avatar className="size-[18px] border bg-blue-100 text-blue-600"><AvatarFallback className="text-[8px] font-bold">{project.leadMember.displayName?.substring(0,2).toUpperCase() || "??"}</AvatarFallback></Avatar> {project.leadMember.displayName}</>
              ) : (
                <span className="text-muted-foreground">No lead</span>
              )}
            </button>
          </EditablePropertyRow>

          {/* Issues / PRs */}
          <EditablePropertyRow label="Issues" icon={CircleDot}>
            <span className="text-foreground text-[12.5px]">{doneIssues} / {totalIssues} done</span>
          </EditablePropertyRow>
          <EditablePropertyRow label="PRs" icon={GitPullRequest}>
            <span className="text-foreground text-[12.5px]">{project.counts?.mergedPRs ?? 0} merged, {project.counts?.openPRs ?? 0} open</span>
          </EditablePropertyRow>
          
          {/* Due Date */}
          <EditablePropertyRow label="Due Date" icon={Calendar}>
             <button className="flex items-center gap-1.5 text-foreground hover:bg-muted/40 px-2 py-0.5 rounded-md transition-colors -mx-2 cursor-pointer text-[12px]">
              {project.targetDate ? new Date(project.targetDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date set"}
            </button>
          </EditablePropertyRow>
        </div>

        {/* Progress Section */}
        <div className="bg-muted/20 border border-border/40 rounded-xl p-4 hover:border-border/60 transition-colors">
          <h4 className="text-[12px] font-medium text-muted-foreground mb-4 px-1">Project Progress</h4>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
              <div className="h-full bg-[#5e6ad2] rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[13px] font-semibold text-foreground tabular-nums">{progressPct}%</span>
          </div>
          <div className="text-[12px] text-muted-foreground">
            {doneIssues} of {totalIssues} issues completed
          </div>
          {recentPRs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/40">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Open PRs</div>
              {recentPRs.slice(0, 3).map((pr: any) => (
                <div key={pr._id} className="flex items-center gap-2 text-[12px] py-1">
                  <GitPullRequest className="size-3 text-green-500 shrink-0" />
                  <span className="text-foreground truncate flex-1">{pr.title}</span>
                  <span className="font-mono text-muted-foreground text-[10px]">#{pr.githubPrNumber}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}


// ───────────────────────────────────────────────────────────────────────────
// BOARD TAB
// ───────────────────────────────────────────────────────────────────────────
const boardColumns = [
  { id: "backlog", title: "Backlog", dot: "bg-purple-500" },
  { id: "todo", title: "To Do", dot: "bg-blue-500" },
  { id: "in_progress", title: "In Progress", dot: "bg-yellow-500" },
  { id: "in_review", title: "In Review", dot: "bg-orange-400" },
  { id: "done", title: "Done", dot: "bg-emerald-500" },
]

function BoardTab({ issues, updateIssue }: { issues: any[] | undefined; updateIssue: any }) {
  const [isBrowser, setIsBrowser] = React.useState(false)

  React.useEffect(() => {
    setIsBrowser(true)
  }, [])

  // Group issues by status
  const groupedIssues = React.useMemo(() => {
    const groups: Record<string, any[]> = {}
    for (const col of boardColumns) groups[col.id] = []
    if (issues) {
      for (const issue of issues) {
        const status = issue.status || "backlog"
        if (groups[status]) {
          groups[status].push(issue)
        } else {
          groups.backlog.push(issue)
        }
      }
    }
    return groups
  }, [issues])

  const onDragEnd = async (result: any) => {
    if (!result.destination) return
    const { source, destination, draggableId } = result
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    // Map column id to issue status
    const newStatus = destination.droppableId as "backlog" | "todo" | "in_progress" | "in_review" | "done"
    try {
      await updateIssue({ issueId: draggableId, status: newStatus })
    } catch (err) {
      console.error("Failed to update issue status:", err)
    }
  }

  if (!isBrowser) {
    return <div className="flex-1 flex flex-col min-h-0 bg-background/50" />
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background/50">
      <div className="h-16 border-b border-border/40 flex items-center justify-between px-8 shrink-0 bg-background">
        <h2 className="text-[19px] font-semibold text-foreground tracking-tight">Progress Board</h2>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="h-8 text-[13px] font-medium border-border/60 hover:bg-muted/30">Export</Button>
          <Button size="sm" className="h-8 text-[13px] font-medium bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white gap-2">
            <Plus className="size-3.5" /> Add task
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 flex flex-row items-start gap-4 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full">
        <DragDropContext onDragEnd={onDragEnd}>
          {boardColumns.map((column) => {
            const items = groupedIssues[column.id] || []
            return (
              <div key={column.id} className="flex-1 min-w-[280px] shrink-0 flex flex-col max-h-full bg-muted/30 rounded-xl overflow-hidden border border-border/40">
                <div className="flex items-center gap-2 p-4 shrink-0">
                  <div className={`size-2.5 rounded-full ${column.dot}`} />
                  <h3 className="text-[13px] font-bold text-foreground">{column.title}</h3>
                  <span className="text-[11px] text-muted-foreground font-medium ml-1">{items.length}</span>
                </div>
                
                <Droppable droppableId={column.id}>
                  {(provided) => (
                    <div 
                      {...provided.droppableProps} 
                      ref={provided.innerRef}
                      className="flex-1 overflow-y-auto space-y-3 p-3 pt-0 [&::-webkit-scrollbar]:hidden flex flex-col"
                    >
                      {items.length === 0 && (
                        <div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground/50">No issues</div>
                      )}
                      {items.map((item: any, index: number) => (
                        <Draggable key={item._id} draggableId={item._id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`bg-background rounded-[10px] p-4 transition-all ${snapshot.isDragging ? 'border-2 border-[#5e6ad2] ring-4 ring-[#5e6ad2]/10 scale-[1.02] z-50 shadow-none' : 'border border-border/60 hover:border-border'}`}
                              style={{ ...provided.draggableProps.style }}
                            >
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                                <span className="flex items-center gap-1.5 font-mono text-[10.5px]">
                                  <CircleDot className="size-3 opacity-60" /> {item.identifier || `#${item.sequenceNumber}`}
                                </span>
                                <MoreHorizontal className="size-[14px] opacity-60 hover:text-foreground cursor-pointer transition-colors" />
                              </div>
                              
                              <p className="text-[13px] font-medium text-foreground leading-snug mb-4 whitespace-normal pr-1">
                                {item.title}
                              </p>

                              {/* PR Health Card if linked */}
                              {item.prHealth && (
                                <div className="mb-4 bg-muted/20 border border-border/50 rounded-lg p-2.5 flex flex-col gap-2">
                                  <div className="flex items-center justify-between">
                                   <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                                     {item.prHealth.state === "merged" ? <GitMerge className="size-3.5 text-purple-500" /> : <GitPullRequest className="size-3.5 text-green-500" />}
                                     <span className="font-mono opacity-80">#{item.prHealth.prNumber}</span>
                                   </div>
                                   <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-tight">
                                     <span className="text-emerald-500 font-semibold bg-emerald-500/10 px-1 rounded">+{item.prHealth.additions}</span>
                                     <span className="text-red-500 font-semibold bg-red-500/10 px-1 rounded">-{item.prHealth.deletions}</span>
                                   </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {item.prHealth.checks === "success" && <div className="flex gap-1 items-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 px-1.5 py-[2px] rounded-[4px] text-[9px] uppercase font-bold tracking-wider"><CheckCircle2 className="size-2.5" strokeWidth={3} /> Checks passed</div>}
                                    {item.prHealth.checks === "failure" && <div className="flex gap-1 items-center bg-red-500/10 border border-red-500/20 text-red-600 px-1.5 py-[2px] rounded-[4px] text-[9px] uppercase font-bold tracking-wider"><AlertCircle className="size-2.5" strokeWidth={3} /> Checks failed</div>}
                                    {item.prHealth.checks === "pending" && <div className="flex gap-1 items-center bg-amber-500/10 border border-amber-500/20 text-amber-600 px-1.5 py-[2px] rounded-[4px] text-[9px] uppercase font-bold tracking-wider"><RefreshCw className="size-2.5 animate-spin" strokeWidth={3} /> Pending</div>}
                                    {item.prHealth.mergeable === false && <div className="bg-red-500/10 border border-red-500/20 text-red-600 px-1.5 py-[2px] rounded-[4px] text-[9px] uppercase font-bold tracking-wider">Conflicts</div>}
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center justify-between mt-auto pt-1">
                                <div>
                                  {item.priority === "urgent" && <SignalHigh className="size-3.5 text-red-500" strokeWidth={2.5} />}
                                  {item.priority === "high" && <SignalHigh className="size-3.5 text-orange-500" strokeWidth={2.5} />}
                                  {item.priority === "medium" && <SignalHigh className="size-3.5 text-yellow-500" strokeWidth={2} />}
                                  {item.priority === "low" && <SignalHigh className="size-3.5 text-blue-500" />}
                                  {item.priority === "none" && <SignalHigh className="size-3.5 text-muted-foreground/40" />}
                                </div>
                                {item.assignee && (
                                  <Avatar className="size-[22px] border-2 border-background ring-1 ring-border/20 z-10">
                                    <AvatarFallback className="text-[8px] bg-blue-100 text-blue-600 font-bold">
                                      {item.assignee.displayName?.substring(0, 2).toUpperCase() || "??"}
                                    </AvatarFallback>
                                  </Avatar>
                                )}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}
        </DragDropContext>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// DASHBOARD, TIMELINE, CALENDAR placeholders
// ───────────────────────────────────────────────────────────────────────────
function DashboardTab({ stats, prs }: { stats: any; prs: any[] | undefined }) {
  const avgMergeDays = stats ? Math.round((stats.avgMergeTimeHours / 24) * 10) / 10 : 0
  const ciRate = stats?.ciSuccessRate ?? 100
  const blocked = stats?.blockedTasks ?? 0
  const failedPRs = prs?.filter((p: any) => p.checksStatus === "failure" && p.state === "open") || []

  return (
    <div className="flex-1 overflow-y-auto px-12 py-12 bg-background [&::-webkit-scrollbar]:hidden">
      <div className="max-w-[1400px] mx-auto w-full">
        
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h2 className="text-[22px] font-semibold text-foreground tracking-tight mb-2">Delivery Analytics</h2>
            <p className="text-[13.5px] text-muted-foreground font-medium">Tracking PR lifecycles, velocity bottlenecks, and CI/CD delays across the project.</p>
          </div>
          <Button variant="secondary" size="sm" className="h-8 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium rounded-[6px] shadow-none gap-2">
            <RefreshCw className="size-3.5" /> Sync GitHub Data
          </Button>
        </div>

        {/* Top Metrics Grid */}
        <div className="grid grid-cols-4 gap-5 mb-12">
          <div className="bg-muted/10 border border-border/60 rounded-[14px] p-5 hover:border-border/80 transition-colors shadow-none relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform duration-500"><Timer className="size-20" /></div>
            <div className="flex items-center gap-2 text-muted-foreground mb-4 relative z-10">
              <Timer className="size-4" />
              <h4 className="text-[11.5px] font-bold tracking-wider uppercase text-foreground/70">Avg Merge Time</h4>
            </div>
            <div className="flex items-end gap-2 relative z-10 text-foreground">
              <span className="text-[32px] font-semibold tracking-tight leading-none">{avgMergeDays || 0}</span>
              <span className="text-[13px] text-muted-foreground font-semibold pb-1">Days</span>
            </div>
          </div>
          
          <div className="bg-muted/10 border border-border/60 rounded-[14px] p-5 hover:border-border/80 transition-colors shadow-none relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform duration-500"><Gauge className="size-20" /></div>
            <div className="flex items-center gap-2 text-muted-foreground mb-4 relative z-10">
              <Gauge className="size-4" />
              <h4 className="text-[11.5px] font-bold tracking-wider uppercase text-foreground/70">CI Success Rate</h4>
            </div>
            <div className="flex items-end gap-2 relative z-10 text-foreground">
              <span className="text-[32px] font-semibold tracking-tight leading-none">{ciRate}</span>
              <span className="text-[13px] text-muted-foreground font-semibold pb-1">%</span>
            </div>
          </div>

          <div className="bg-red-500/5 border border-red-500/20 rounded-[14px] p-5 hover:border-red-500/30 transition-colors shadow-none relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-red-500 group-hover:scale-110 transition-transform duration-500"><ShieldAlert className="size-20" /></div>
            <div className="flex items-center gap-2 text-red-500/80 mb-4 relative z-10">
              <ShieldAlert className="size-4" />
              <h4 className="text-[11.5px] font-bold tracking-wider uppercase">Blocked Tasks</h4>
            </div>
            <div className="flex items-end gap-2 relative z-10">
              <span className="text-[32px] font-semibold text-red-600 dark:text-red-400 tracking-tight leading-none">{blocked}</span>
              <span className="text-[13px] text-red-500/80 font-semibold pb-1">Tasks</span>
            </div>
          </div>

          <div className="bg-orange-500/5 border border-orange-500/20 rounded-[14px] p-5 hover:border-orange-500/30 transition-colors shadow-none relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-orange-500 group-hover:scale-110 transition-transform duration-500"><Hourglass className="size-20" /></div>
            <div className="flex items-center gap-2 text-orange-500/80 mb-4 relative z-10">
              <Hourglass className="size-4" />
              <h4 className="text-[11.5px] font-bold tracking-wider uppercase">Avg Pipeline Delay</h4>
            </div>
            <div className="flex items-end gap-2 relative z-10">
              <span className="text-[32px] font-semibold text-orange-600 dark:text-orange-400 tracking-tight leading-none">{failedPRs.length}</span>
              <span className="text-[13px] text-orange-500/80 font-semibold pb-1">PRs</span>
            </div>
          </div>
        </div>

        {/* Subfeature C: CI/CD Failure Delays Analysis */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-6">
             <div className="flex items-center gap-3">
               <div className="size-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500">
                 <ShieldAlert className="size-4" />
               </div>
               <div>
                 <h3 className="text-[16px] font-semibold text-foreground">CI/CD Failure Delay Report</h3>
                 <p className="text-[12px] text-muted-foreground mt-0.5 font-medium">Tasks explicitly delayed by continuous integration failures.</p>
               </div>
             </div>
             <Button variant="outline" size="sm" className="h-8 text-[12px] font-medium border-border/60 gap-2">
               <Filter className="size-3.5" /> Filter Report
             </Button>
          </div>

          <div className="bg-background border border-border/60 rounded-[12px] overflow-hidden shadow-none">
             <div className="grid grid-cols-12 gap-6 px-6 py-3.5 border-b border-border/40 bg-muted/20 text-[11.5px] font-bold text-muted-foreground uppercase tracking-wider">
               <div className="col-span-5">Failing Pull Request & Blocked Task</div>
               <div className="col-span-4">Failed Pipeline Checks</div>
               <div className="col-span-3">Delay Impact</div>
             </div>

             <div className="divide-y divide-border/40 pb-2">
                {failedPRs.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-[13px] text-muted-foreground/60">
                    No failing PRs — all pipelines are healthy.
                  </div>
                ) : (
                  failedPRs.map((pr: any) => (
                    <div key={pr._id} className="grid grid-cols-12 gap-6 px-6 py-5 items-start group hover:bg-muted/10 transition-colors">
                      <div className="col-span-5 flex flex-col gap-2.5">
                        <div className="flex items-start gap-3">
                          <GitPullRequest className="size-[18px] text-green-500 mt-0.5 shrink-0" strokeWidth={2.5} />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13.5px] font-semibold text-foreground hover:text-[#5e6ad2] hover:underline cursor-pointer transition-colors leading-snug">{pr.title}</span>
                              <span className="text-[11px] font-mono text-muted-foreground bg-background border border-border/60 px-1.5 py-[1px] rounded font-semibold">#{pr.githubPrNumber}</span>
                            </div>
                            {pr.linkedIssues && pr.linkedIssues.length > 0 && (
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-[11.5px] text-muted-foreground font-semibold flex items-center gap-1.5"><Target className="size-3 text-red-500" /> Blocks: </span>
                                {pr.linkedIssues.map((li: any, i: number) => (
                                  <span key={i} className="text-[11px] font-mono font-bold text-foreground bg-muted/50 px-1.5 py-[1px] rounded border border-border/40 hover:bg-muted cursor-pointer transition-colors">{li.identifier}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="col-span-4 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-red-600 dark:text-red-400 bg-red-500/5 border border-red-500/20 px-2.5 py-1.5 rounded-md w-fit">
                          <XCircle className="size-3.5 shrink-0" strokeWidth={2.5} /> CI checks failed
                        </div>
                      </div>
                      <div className="col-span-3 flex flex-col gap-2.5 pt-0.5">
                        <div className="flex items-center gap-2 text-[13px] font-bold text-orange-600 dark:text-orange-400">
                          <Clock className="size-4" strokeWidth={2.5} /> Blocking merge
                        </div>
                        {pr.authorMember && (
                          <div className="flex items-center gap-2 mt-1">
                            <Avatar className="size-[22px] border bg-blue-100 text-blue-600"><AvatarFallback className="text-[8px] font-bold">{pr.authorMember.displayName?.substring(0,2).toUpperCase() || "??"}</AvatarFallback></Avatar>
                            <span className="text-[11.5px] font-semibold text-foreground/70">{pr.authorMember.displayName}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
             </div>
          </div>
        </div>

      </div>
    </div>
  )
}

function TraceabilityTab({ issues, prs, activity }: { issues: any[] | undefined; prs: any[] | undefined; activity: any[] | undefined }) {
  // Build a unified timeline from real data
  const timeline = React.useMemo(() => {
    const events: { id: string; type: string; title: string; time: number; icon: string; detail?: any }[] = []

    if (issues) {
      for (const issue of issues) {
        events.push({ id: `issue-${issue._id}`, type: "issue", title: issue.title, time: issue.createdAt, icon: "issue", detail: issue })
      }
    }
    if (prs) {
      for (const pr of prs) {
        events.push({ id: `pr-${pr._id}`, type: "pr", title: pr.title, time: pr.createdAt, icon: pr.state === "merged" ? "merged" : "pr", detail: pr })
      }
    }
    if (activity) {
      for (const event of activity) {
        events.push({ id: `activity-${event._id}`, type: "activity", title: event.eventType?.replace(/_/g, " ") || "Event", time: event.createdAt, icon: "activity", detail: event })
      }
    }

    events.sort((a, b) => b.time - a.time)
    return events.slice(0, 30)
  }, [issues, prs, activity])

  // Build dependency traces: issues that have linked PRs
  const dependencies = React.useMemo(() => {
    if (!issues) return []
    return issues
      .filter((issue: any) => issue.prHealth)
      .map((issue: any) => ({
        issue,
        pr: issue.prHealth,
        isBlocked: issue.prHealth?.checks === "failure" || issue.prHealth?.mergeable === false,
      }))
      .slice(0, 10)
  }, [issues])

  const formatTime = (ts: number) => {
    const diffH = Math.floor((Date.now() - ts) / (1000 * 60 * 60))
    if (diffH < 1) return "Just now"
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `${diffD}d ago`
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-background">
      {/* LEFT: Timeline Feed */}
      <div className="flex-1 overflow-y-auto px-12 py-12 [&::-webkit-scrollbar]:hidden">
        <div className="max-w-[1000px] mx-auto w-full">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-[20px] font-semibold text-foreground tracking-tight">Project Timeline</h2>
            <Button variant="outline" size="sm" className="h-8 text-[12px] font-medium border-border/60 gap-1.5">
              <Filter className="size-3.5" /> Filter Events
            </Button>
          </div>

          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <GitCommit className="size-8 mb-3 opacity-30" />
              <p className="text-[14px] font-medium">No activity yet</p>
              <p className="text-[12px] mt-1 opacity-70">Events will appear as issues, PRs, and commits flow in from GitHub.</p>
            </div>
          ) : (
            <div className="relative pl-6 border-l border-border/60 space-y-10">
              {timeline.map((event) => (
                <div key={event.id} className="relative">
                  <div className={`absolute -left-[29px] top-1 rounded-full bg-background border p-1 z-10 ${
                    event.icon === "merged" ? "border-purple-500/50 text-purple-500" :
                    event.icon === "pr" ? "border-green-500/50 text-green-500" :
                    "border-border/80 text-muted-foreground"
                  }`}>
                    {event.icon === "issue" && <Target className="size-3.5" />}
                    {event.icon === "pr" && <GitPullRequest className="size-3.5" />}
                    {event.icon === "merged" && <GitMerge className="size-3.5" />}
                    {event.icon === "activity" && <Activity className="size-3.5" />}
                  </div>

                  {event.type === "issue" && (
                    <>
                      <div className="text-[13px] text-muted-foreground mb-3 font-medium">
                        Issue created
                        <span className="font-mono text-[11px] bg-muted py-[1px] px-1.5 rounded-md border text-foreground ml-2">{event.detail.identifier}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground/60">{formatTime(event.time)}</span>
                      </div>
                      <div className="bg-background border border-border/40 rounded-xl p-4 shadow-none">
                        <h4 className="text-[13.5px] font-medium text-foreground mb-1">{event.title}</h4>
                        {event.detail.body && <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2">{event.detail.body}</p>}
                        <div className="flex items-center gap-3 mt-3">
                          {event.detail.assignee && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Avatar className="size-[18px] border"><AvatarFallback className="text-[7px] bg-blue-100 text-blue-600 font-bold">{event.detail.assignee.displayName?.substring(0,2).toUpperCase()}</AvatarFallback></Avatar>
                              {event.detail.assignee.displayName}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {event.type === "pr" && (
                    <>
                      <div className="text-[13px] text-muted-foreground mb-3 font-medium">
                        {event.detail.authorMember?.displayName || event.detail.authorGithubUsername || "Someone"}
                        {event.detail.state === "merged" ? " merged" : " opened"} a pull request
                        <span className="font-mono text-[11px] bg-muted py-[1px] px-1.5 rounded-md border ml-2">#{event.detail.githubPrNumber}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground/60">{formatTime(event.time)}</span>
                      </div>
                      <div className="bg-background border border-border/40 rounded-xl p-0 overflow-hidden shadow-none">
                        <div className="p-4 py-3 bg-muted/5 border-b border-border/20 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {event.detail.state === "merged" ? <GitMerge className="size-4 text-purple-500" /> : <GitPullRequest className="size-4 text-green-500" />}
                            <span className="text-[13px] font-semibold text-foreground">{event.title}</span>
                          </div>
                          <div className={`px-2 py-[2px] rounded uppercase text-[10px] font-bold tracking-wider ${
                            event.detail.state === "merged" ? "bg-purple-500/10 text-purple-600" :
                            event.detail.state === "closed" ? "bg-red-500/10 text-red-600" :
                            "bg-green-500/10 text-green-600"
                          }`}>{event.detail.state}</div>
                        </div>
                        <div className="p-4">
                          <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
                            <span className="flex items-center gap-1"><FileCode2 className="size-3" /> {event.detail.changedFiles ?? 0} files</span>
                            <span className="text-emerald-500 font-semibold">+{event.detail.additions ?? 0}</span>
                            <span className="text-red-500 font-semibold">-{event.detail.deletions ?? 0}</span>
                            {event.detail.headBranch && <span className="font-mono text-[10px] bg-muted px-1.5 py-[1px] rounded border">{event.detail.headBranch}</span>}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {event.type === "activity" && (
                    <div className="text-[13px] text-muted-foreground font-medium">
                      <span className="font-semibold text-foreground mr-1">{event.detail.actorDisplayName || "System"}</span>
                      {event.title}
                      <span className="ml-2 text-[11px] text-muted-foreground/60">{formatTime(event.time)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Dependency Trace */}
      <div className="w-[340px] xl:w-[380px] border-l border-border/60 bg-muted/10 p-6 flex flex-col shrink-0 overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <h3 className="text-[14px] font-semibold text-foreground mb-6 flex items-center gap-2">
          <Link2 className="size-4" /> Dependency Trace
        </h3>

        <div className="text-[12px] text-muted-foreground mb-6 leading-relaxed">
          Issues linked to PRs — showing blockers and merge readiness.
        </div>

        {dependencies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
            <Link2 className="size-6 mb-2 opacity-30" />
            <p className="text-[12px] text-center">No issue↔PR dependencies found yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0 relative">
            {dependencies.map((dep: any, index: number) => (
              <React.Fragment key={dep.issue._id}>
                <div className={`bg-background border rounded-xl p-4 shadow-none z-10 relative group hover:border-[#5e6ad2]/50 transition-colors ${
                  dep.isBlocked ? "border-red-500/30" : "border-border/60"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-mono text-muted-foreground tracking-tight">{dep.issue.identifier}</div>
                    {dep.isBlocked ? (
                      <div className="flex items-center gap-1 text-[9px] bg-red-500/10 text-red-500 px-1.5 py-[2px] rounded font-bold uppercase tracking-wider"><AlertCircle className="size-2.5"/> Blocked</div>
                    ) : (
                      <div className="flex items-center gap-1 text-[9px] bg-emerald-500/10 text-emerald-600 px-1.5 py-[2px] rounded font-bold uppercase tracking-wider"><CheckCircle2 className="size-2.5"/> Ready</div>
                    )}
                  </div>
                  <h4 className="text-[13px] font-medium text-foreground line-clamp-1">{dep.issue.title}</h4>
                  <div className="mt-3 pt-3 border-t border-border/40 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      {dep.pr.state === "merged" ? <GitMerge className="size-3 text-purple-500" /> : <GitPullRequest className="size-3 text-green-500" />}
                      <span className="text-foreground">PR #{dep.pr.prNumber}</span>
                      {dep.pr.checks === "success" && <span className="ml-auto bg-emerald-500/10 text-emerald-600 px-1.5 py-[2px] rounded uppercase text-[9px] font-bold tracking-wider">Passed</span>}
                      {dep.pr.checks === "failure" && <span className="ml-auto bg-red-500/10 text-red-500 px-1.5 py-[2px] rounded uppercase text-[9px] font-bold tracking-wider">Failed</span>}
                      {dep.pr.checks === "pending" && <span className="ml-auto bg-amber-500/10 text-amber-600 px-1.5 py-[2px] rounded uppercase text-[9px] font-bold tracking-wider">Pending</span>}
                    </div>
                  </div>
                </div>
                {index < dependencies.length - 1 && (
                  <div className="ml-6 border-l-2 border-dashed border-[#5e6ad2]/40 h-6 -my-1 z-0 relative">
                    <div className="absolute -left-[5px] top-1/2 -translate-y-1/2 bg-[#5e6ad2] rounded-full size-2" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="mt-auto pt-8">
           <div className="bg-background border border-border/40 rounded-xl p-3 cursor-pointer hover:bg-muted/20 hover:border-border/60 transition-colors text-center text-[12.5px] font-medium text-foreground">
             View Full Pipeline Graph
           </div>
        </div>
      </div>
    </div>
  )
}


