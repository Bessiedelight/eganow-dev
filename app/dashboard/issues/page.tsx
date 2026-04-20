"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  MoreHorizontal, ListFilter, SlidersHorizontal, AlertCircle, ChevronRight, CheckCircle2, CircleDashed, SignalHigh, SignalMedium, SignalLow, Plus, Calendar, MessageSquare, Zap, Bug, Users, Bookmark, CircleDot, GitPullRequest, GitMerge, XCircle, Milestone, Check, Circle
} from "lucide-react"
import { CreateIssueDialog } from "@/components/create-issue-dialog"

// ─── Mapping helpers ──────────────────────────────────────────
const priorityIconMap: Record<string, any> = {
  urgent: AlertCircle,
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
  none: CircleDashed,
}

const priorityColorMap: Record<string, string> = {
  urgent: "text-red-500",
  high: "text-orange-500",
  medium: "text-amber-500",
  low: "text-sky-500",
  none: "text-muted-foreground/50",
}

const statusConfigMap: Record<string, { icon: any; color: string; group: "open" | "closed" }> = {
  backlog: { icon: CircleDashed, color: "text-muted-foreground", group: "open" },
  todo: { icon: Circle, color: "text-muted-foreground", group: "open" },
  in_progress: { icon: CircleDot, color: "text-yellow-500", group: "open" },
  in_review: { icon: CircleDot, color: "text-blue-500", group: "open" },
  done: { icon: CheckCircle2, color: "text-purple-500", group: "closed" },
  cancelled: { icon: XCircle, color: "text-muted-foreground", group: "closed" },
}

const labelColorMap: Record<string, string> = {
  "#ef4444": "text-red-500",
  "#3b82f6": "text-blue-500",
  "#f97316": "text-orange-500",
  "#a855f7": "text-purple-500",
  "#eab308": "text-yellow-500",
  "#06b6d4": "text-cyan-500",
  "#22c55e": "text-green-500",
  "#ec4899": "text-pink-500",
}

function getLabelColor(hex: string): string {
  return labelColorMap[hex] || "text-muted-foreground"
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  return `${weeks}w`
}

export default function UserIssuesPage() {
  const router = useRouter()
  const { organization, isLoading: orgLoading, needsInstallation } = useOrganization()
  const [viewMode, setViewMode] = React.useState<"all" | "project" | "team">("all")
  const [statusFilter, setStatusFilter] = React.useState<"open" | "closed">("open")

  const issues = useQuery(
    api.issues.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )

  const teams = useQuery(
    api.teams.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )

  const projects = useQuery(
    api.projects.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )

  // Transform issues into grouped format based on viewMode
  const activeData = React.useMemo(() => {
    if (!issues) return []

    // Filter by open/closed
    const openStatuses = ["backlog", "todo", "in_progress", "in_review"]
    const closedStatuses = ["done", "cancelled"]
    const filtered = issues.filter((i) =>
      statusFilter === "open"
        ? openStatuses.includes(i.status)
        : closedStatuses.includes(i.status)
    )

    // Transform each issue for the UI
    const transformIssue = (issue: (typeof issues)[0]) => {
      const sc = statusConfigMap[issue.status] || statusConfigMap.todo
      return {
        id: issue.identifier,
        _id: issue._id,
        priority: priorityIconMap[issue.priority] || CircleDashed,
        priorityColor: priorityColorMap[issue.priority] || "text-muted-foreground/50",
        priorityLabel: issue.priority === "none"
          ? "No priority"
          : issue.priority.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        status: sc.icon,
        statusColor: sc.color,
        title: issue.title,
        labels: (issue.labels || []).map((lbl: any) => ({
          name: lbl.name,
          icon: CircleDot,
          color: getLabelColor(lbl.color),
        })),
        milestone: issue.githubMilestone
          ? issue.githubMilestone
          : issue.sequenceNumber,
        comments: issue.commentCount,
        updated: timeAgo(issue.updatedAt),
        hasUnseenThreadUpdates: issue.hasUnseenThreadUpdates,
        assignee: issue.assignee
          ? getInitials(issue.assignee.displayName)
          : undefined,
        assigneeName: issue.assignee?.displayName,
        teamName: issue.team
          ? `${issue.team.name}${issue.team.identifier ? ` (${issue.team.identifier})` : ""}`
          : undefined,
        pr: issue.prSummary
          ? {
              icon: issue.prSummary.state === "merged" ? GitMerge : GitPullRequest,
              color: issue.prSummary.state === "merged" ? "text-purple-500" : "text-green-500",
              text: issue.prSummary.text,
            }
          : undefined,
      }
    }

    if (viewMode === "all") {
      // Group by status filter label
      if (statusFilter === "open") {
        return [
          {
            group: "Open",
            groupIcon: CircleDot,
            groupColor: "text-green-500",
            issues: filtered.map(transformIssue),
          },
        ].filter((g) => g.issues.length > 0)
      } else {
        return [
          {
            group: "Closed",
            groupIcon: CheckCircle2,
            groupColor: "text-purple-500",
            issues: filtered.map(transformIssue),
          },
        ].filter((g) => g.issues.length > 0)
      }
    }

    if (viewMode === "project") {
      const grouped: Record<string, any[]> = { Unassigned: [] }
      for (const issue of filtered) {
        const projectName = issue.project?.name || "Unassigned"
        if (!grouped[projectName]) grouped[projectName] = []
        grouped[projectName].push(transformIssue(issue))
      }
      return Object.entries(grouped)
        .filter(([, issues]) => issues.length > 0)
        .map(([name, issues]) => ({
          group: name,
          groupIcon: name === "Unassigned" ? CircleDashed : CircleDot,
          groupColor: name === "Unassigned" ? "text-muted-foreground" : "text-green-500",
          issues,
        }))
    }

    if (viewMode === "team") {
      const grouped: Record<string, any[]> = { Unassigned: [] }
      for (const issue of filtered) {
        const teamName = issue.team
          ? `${issue.team.name} (${issue.team.identifier})`
          : "Unassigned"
        if (!grouped[teamName]) grouped[teamName] = []
        grouped[teamName].push(transformIssue(issue))
      }
      return Object.entries(grouped)
        .filter(([, issues]) => issues.length > 0)
        .map(([name, issues]) => ({
          group: name,
          groupIcon: name === "Unassigned" ? CircleDashed : Zap,
          groupColor: name === "Unassigned" ? "text-muted-foreground" : "text-yellow-500",
          issues,
        }))
    }

    return []
  }, [issues, viewMode, statusFilter])

  const isLoading = orgLoading || (organization !== null && issues === undefined)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex w-full flex-col overflow-hidden text-sm bg-background">
          
          {/* Header */}
          <div className="h-14 flex items-center justify-between px-5 border-b shrink-0 bg-background z-10 transition-all">
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
              <SidebarTrigger className="-ml-2" />
              
              {/* Breadcrumb section */}
              <div className="flex items-center gap-1.5 font-medium text-[13px] text-muted-foreground ml-1">
                <span className="hover:text-foreground cursor-pointer transition-colors" onClick={() => router.push("/dashboard")}>Workspace</span>
                <ChevronRight className="size-3.5 opacity-50" />
                <div className="flex items-center gap-1.5 text-foreground px-1.5 py-1 rounded-md cursor-pointer hover:bg-muted/40 transition-colors">
                  <CircleDot className="size-4 text-green-500" /> Issues
                </div>
              </div>
              
              {/* Filters / Views pills */}
              <div className="flex items-center gap-1.5 ml-4 border-l pl-4 border-border/40 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                <Button
                  variant={statusFilter === "open" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("open")}
                  className={`h-7 gap-1.5 text-[12px] font-medium rounded-md shadow-none px-2.5 ${statusFilter === "open" ? "bg-muted/60 hover:bg-muted/80 text-foreground" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <CircleDot className="size-3 text-green-500" /> Open
                </Button>
                <Button
                  variant={statusFilter === "closed" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("closed")}
                  className={`h-7 gap-1.5 text-[12px] font-medium rounded-md shadow-none px-2.5 ${statusFilter === "closed" ? "bg-muted/60 hover:bg-muted/80 text-foreground" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <Check className="size-3 text-muted-foreground" /> Closed
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-2">
              <CreateIssueDialog>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px] font-normal shadow-none border-border/60 hover:bg-muted/40 transition-colors bg-background">
                  <Plus className="size-3.5" /> New Issue
                </Button>
              </CreateIssueDialog>
            </div>
          </div>

          {/* Sub-header / Primary List Toolbar */}
          <div className="h-12 flex items-center justify-between px-5 border-b shrink-0 bg-background text-sm">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" className="h-7 gap-2 text-muted-foreground -ml-2 transition-colors hover:text-foreground text-[13px] font-normal">
                <ListFilter className="size-4" strokeWidth={2} /> Filter
              </Button>
              
              {/* Segmented View Toggle */}
              <div className="h-[26px] flex items-center bg-muted/40 p-0.5 rounded-[6px] border border-border/40">
                <button 
                  onClick={() => setViewMode("all")}
                  className={`px-3 h-full flex items-center justify-center text-[11.5px] font-medium rounded-[4px] transition-all ${viewMode === 'all' ? 'bg-background text-foreground border border-border/20' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  All
                </button>
                <button 
                  onClick={() => setViewMode("project")}
                  className={`px-3 h-full flex items-center justify-center text-[11.5px] font-medium rounded-[4px] transition-all ${viewMode === 'project' ? 'bg-background text-foreground border border-border/20' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  By Project
                </button>
                <button 
                  onClick={() => setViewMode("team")}
                  className={`px-3 h-full flex items-center justify-center text-[11.5px] font-medium rounded-[4px] transition-all ${viewMode === 'team' ? 'bg-background text-foreground border border-border/20' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  By Team
                </button>
              </div>
            </div>

            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px] font-normal border-border/80 shadow-none transition-colors hover:bg-muted/50 rounded-md">
              <SlidersHorizontal className="size-3.5" /> Display
            </Button>
          </div>

          {/* Scrollable Issue Canvas */}
          <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full">
            
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              </div>
            ) : activeData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <CircleDot className="size-8 mb-3 opacity-30" />
                <p className="text-[14px] font-medium">No issues found</p>
                <p className="text-[12px] mt-1 opacity-70">Create your first issue to get started</p>
              </div>
            ) : (
              <div className="w-full pb-12 mt-1">
                {activeData.map((group: any, gIdx: number) => (
                  <div key={gIdx} className="mb-0.5">
                    {/* Subject Header */}
                    <div className="flex items-center justify-between px-6 py-2 border-b border-border/40 bg-muted/5 sticky top-0 z-10 backdrop-blur-sm">
                      <div className="flex items-center gap-2.5 font-medium text-[13px] text-foreground">
                        <group.groupIcon className={`size-[15px] ${group.groupColor}`} strokeWidth={2.3} />
                        {group.group} <span className="text-[11px] font-medium text-muted-foreground pt-0.5">{group.issues.length}</span>
                      </div>
                      <CreateIssueDialog>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><Plus className="size-3.5" /></Button>
                      </CreateIssueDialog>
                    </div>

                    {/* Issues List Rows */}
                    <div className="flex flex-col">
                      {group.issues.map((issue: any, idx: number) => (
                        <Link href={`/dashboard/issues/${issue.id.replace('#','')}`} key={idx} className="flex items-center justify-between px-6 py-1.5 border-b border-border/40 even:bg-muted/20 hover:bg-muted/30 transition-colors group/issue cursor-pointer h-10">
                          
                          {/* Left Side: ID & Title */}
                          <div className="flex items-center gap-3 overflow-hidden flex-1 max-w-[800px]">
                            <MoreHorizontal className="size-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover/issue:opacity-100 transition-opacity" />
                            <span className="text-[12px] font-medium text-muted-foreground/60 shrink-0 tabular-nums w-[65px] tracking-wide">{issue.id}</span>
                            <issue.status className={`size-4 shrink-0 ${issue.statusColor}`} strokeWidth={2.5} />
                            <span className="text-[13px] font-medium text-foreground truncate">{issue.title}</span>
                            {issue.hasUnseenThreadUpdates && (
                              <span className="size-2 rounded-full bg-blue-500 shrink-0" />
                            )}
                            
                            {/* Optional GitHub PR Link Block */}
                            {issue.pr && (
                              <span className={`flex items-center gap-1.5 px-2 py-[2px] ml-1 rounded-full text-[10px] font-medium bg-muted/40 border border-border/40 ${issue.pr.color}`}>
                                <issue.pr.icon className="size-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{issue.pr.text}</span>
                              </span>
                            )}
                          </div>

                          {/* Right Side: Meta Data Metrics */}
                          <div className="flex items-center shrink-0 ml-4 opacity-70 group-hover/issue:opacity-100 transition-opacity justify-end gap-0">
                            
                            {/* Label Pill Matrix */}
                            <div className="hidden lg:flex justify-end gap-1.5 w-[220px]">
                              {issue.labels.map((lbl: any, lIdx: number) => (
                                <div key={lIdx} className="flex items-center gap-1.5 px-2 py-[2px] border border-border/60 rounded-full text-[10.5px] font-medium text-muted-foreground bg-background shadow-none max-w-[200px]">
                                  <div className={`size-2 rounded-full bg-current ${lbl.color}`} /> 
                                  <span className="truncate leading-tight mb-[1px]">{lbl.name}</span>
                                </div>
                              ))}
                            </div>

                            {/* Milestone / Sequence Block */}
                            <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground w-[60px] justify-start pl-6">
                              <Milestone className="size-3.5" /> <span className="tabular-nums opacity-80">{typeof issue.milestone === 'string' ? issue.milestone : `#${issue.milestone}`}</span>
                            </div>

                            {/* Comments Block */}
                            <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground w-[50px] justify-start pl-4 hover:text-foreground transition-colors">
                              <MessageSquare className="size-3.5" /> <span className="tabular-nums leading-none tracking-tight">{issue.comments}</span>
                            </div>

                            {/* Last Updated Time Block */}
                            <div className="text-[12px] text-muted-foreground/80 w-[50px] text-left font-medium tabular-nums hidden xl:block pl-2">
                              {issue.updated}
                            </div>

                            {/* Priority Block */}
                            <div className="w-[30px] flex justify-end px-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center justify-center">
                                    <issue.priority className={`size-3.5 ${issue.priorityColor}`} />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  {issue.priorityLabel}
                                </TooltipContent>
                              </Tooltip>
                            </div>

                            {/* Assigned Avatar Block */}
                            <div className="w-[30px] flex justify-end">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {issue.assignee ? (
                                    <Avatar className="size-[20px] border">
                                      <AvatarFallback className="text-[8px] font-bold bg-muted/60 text-muted-foreground">{issue.assignee}</AvatarFallback>
                                    </Avatar>
                                  ) : (
                                    <div className="size-[20px] flex items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/40">
                                      <Users className="size-3" />
                                    </div>
                                  )}
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  {issue.assigneeName
                                    ? `Assigned to ${issue.assigneeName}`
                                    : issue.teamName
                                      ? `Assigned to team ${issue.teamName}`
                                      : "Unassigned"}
                                </TooltipContent>
                              </Tooltip>
                            </div>

                          </div>

                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
