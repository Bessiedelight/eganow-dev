"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  ChevronRight, Users, FolderKanban, GitPullRequest, CheckCircle2,
  Target, GitMerge, MessageSquare, Activity, CircleDot, Crown,
  SignalHigh, FileCode2, Filter, Calendar
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

const statusMap: Record<string, { label: string; color: string; bg: string; border: string }> = {
  backlog: { label: "Backlog", color: "text-muted-foreground", bg: "bg-muted/40", border: "border-border/40" },
  todo: { label: "To Do", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  in_progress: { label: "In Progress", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  in_review: { label: "In Review", color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  done: { label: "Done", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  cancelled: { label: "Cancelled", color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
}

function initials(name: string) {
  return name.split(" ").map(s => s[0]).join("").toUpperCase().slice(0, 2)
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function EventIcon({ type }: { type: string }) {
  const cls = "size-3.5"
  switch (type) {
    case "issue_created": return <Target className={cls} />
    case "issue_status_changed": return <CircleDot className={cls} />
    case "pull_request_state_changed":
    case "pr_opened": return <GitPullRequest className={cls} />
    case "pr_merged":
    case "pull_request_linked_to_issue": return <GitMerge className={cls} />
    case "comment_added":
    case "comment_created": return <MessageSquare className={cls} />
    default: return <Activity className={cls} />
  }
}

function eventDescription(event: any): string {
  switch (event.eventType) {
    case "issue_created": return "created an issue"
    case "issue_status_changed": return `changed status to ${event.metadata?.newValue || "updated"}`
    case "pr_opened": return "opened a pull request"
    case "pr_merged": return "merged a pull request"
    case "pull_request_state_changed": return "pull request state changed"
    case "pull_request_linked_to_issue": return "linked a pull request to an issue"
    case "comment_added":
    case "comment_created": return "added a comment"
    default: return event.eventType?.replace(/_/g, " ") || "activity"
  }
}

export default function MemberDetailPage({ params }: { params: Promise<{ memberId: string }> }) {
  const router = useRouter()
  const resolvedParams = React.use(params)
  const memberId = resolvedParams.memberId as Id<"members">
  const member = useQuery(api.members.getDetailById, { memberId })
  const [showMinor, setShowMinor] = React.useState(true)

  if (member === undefined) {
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

  if (member === null) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-hidden bg-background">
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Users className="size-8 mb-3 opacity-30" />
            <p className="text-[14px] font-medium">Member not found</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push("/dashboard/members")}>Back to Members</Button>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  const openIssues = member.issues.filter(i => i.status !== "done" && i.status !== "cancelled")
  const doneIssues = member.issues.filter(i => i.status === "done")
  const openPrs = member.pullRequests.filter(pr => pr.state === "open")
  const mergedPrs = member.pullRequests.filter(pr => pr.state === "merged")

  const filteredActivity = showMinor
    ? member.activity
    : member.activity.filter((e: any) =>
      ["issue_created", "pr_opened", "pr_merged", "pull_request_linked_to_issue"].includes(e.eventType)
    )

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col overflow-hidden text-sm bg-background">

          {/* ─── Header ─────────────────────────────────────── */}
          <div className="h-14 flex items-center justify-between px-6 border-b shrink-0 bg-background/95 backdrop-blur z-20 relative text-sm">
            <div className="flex items-center text-[13px] font-medium text-foreground gap-1.5">
              <SidebarTrigger className="-ml-3 mr-1" />
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => router.push("/dashboard/members")}>
                Members
              </Button>
              <ChevronRight className="size-3 text-muted-foreground/40" />
              <span className="text-foreground tracking-tight font-medium">{member.displayName}</span>
              <div className={`flex items-center gap-1.5 px-2 py-0.5 ml-2 rounded-full border text-[11px] font-medium capitalize ${
                member.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
                member.status === "invited" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                "bg-red-500/10 text-red-500 border-red-500/20"
              }`}>
                <span className="size-1.5 rounded-full bg-current opacity-80" /> {member.status}
              </div>
            </div>
          </div>

          {/* ─── Main Content ────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-hidden flex">

            {/* ─── LEFT: Timeline ────────────────────────────── */}
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden bg-background">
              <div className="max-w-[780px] mx-auto w-full px-12 py-10">

                {/* Title */}
                <div className="flex items-center justify-between mb-8">
                  <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Member Timeline</h1>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showMinor}
                        onChange={() => setShowMinor(!showMinor)}
                        className="size-3.5 rounded border-border accent-foreground"
                      />
                      Show minor activity
                    </label>
                    <button className="flex items-center gap-1.5 text-[12px] text-muted-foreground font-medium hover:text-foreground transition-colors">
                      <Filter className="size-3.5" /> Filter Events
                    </button>
                  </div>
                </div>

                {/* Timeline */}
                {filteredActivity.length === 0 ? (
                  <div className="text-center py-16 text-[13px] text-muted-foreground">
                    <Activity className="size-6 mx-auto mb-3 opacity-30" />
                    No activity recorded for this member yet.
                  </div>
                ) : (
                  <div className="space-y-0">
                    {filteredActivity.map((event: any, idx: number) => (
                      <div key={event._id} className="flex items-start gap-0 group">
                        {/* Timeline rail */}
                        <div className="flex flex-col items-center shrink-0 w-8 mr-3">
                          <div className="size-8 rounded-full flex items-center justify-center border border-border/60 bg-background text-muted-foreground group-hover:border-foreground/20 transition-colors z-10">
                            <EventIcon type={event.eventType} />
                          </div>
                          {idx < filteredActivity.length - 1 && (
                            <div className="w-px flex-1 bg-border/40 min-h-[24px]" />
                          )}
                        </div>

                        {/* Event content */}
                        <div className="flex-1 min-w-0 pb-8">
                          <div className="flex items-center gap-2 text-[13px] text-muted-foreground pt-1.5">
                            <span className="font-semibold text-foreground">{event.actorDisplayName || "System"}</span>
                            <span>{eventDescription(event)}</span>
                            <span className="text-[11px] text-muted-foreground/50 ml-auto shrink-0">{timeAgo(event.createdAt)}</span>
                          </div>

                          {/* Enriched card for issues */}
                          {event.issueTitle && (
                            <div className="mt-3 border border-border/60 rounded-xl p-4 hover:border-border transition-colors">
                              <div className="flex items-start gap-3">
                                <CircleDot className={`size-4 shrink-0 mt-0.5 ${
                                  event.metadata?.newValue === "done" || event.eventType === "issue_created" ? "text-emerald-500" :
                                  event.metadata?.newValue === "in_progress" ? "text-yellow-500" :
                                  "text-muted-foreground/50"
                                }`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">{event.issueIdentifier}</span>
                                  </div>
                                  <h3 className="text-[14px] font-semibold text-foreground leading-snug">{event.issueTitle}</h3>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Enriched card for PRs */}
                          {event.prTitle && !event.issueTitle && (
                            <div className="mt-3 border border-border/60 rounded-xl p-4 hover:border-border transition-colors">
                              <div className="flex items-start gap-3">
                                <GitPullRequest className={`size-4 shrink-0 mt-0.5 ${
                                  event.eventType === "pr_merged" ? "text-purple-500" : "text-emerald-500"
                                }`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                                      #{event.prNumber}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize font-medium ${
                                      event.eventType === "pr_merged" ? "text-purple-500 border-purple-500/20 bg-purple-500/10" :
                                      "text-emerald-500 border-emerald-500/20 bg-emerald-500/10"
                                    }`}>
                                      {event.eventType === "pr_merged" ? "merged" : "open"}
                                    </span>
                                  </div>
                                  <h3 className="text-[14px] font-semibold text-foreground leading-snug">{event.prTitle}</h3>
                                  {event.prRepo && (
                                    <span className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
                                      <FileCode2 className="size-3" /> {event.prRepo}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ─── RIGHT: Properties Sidebar ──────────────────── */}
            <div className="w-[300px] xl:w-[320px] overflow-y-auto p-6 shrink-0 [&::-webkit-scrollbar]:hidden border-l border-border/60 bg-background flex flex-col gap-6">

              {/* Member Card */}
              <div className="flex items-center gap-4">
                <Avatar className="size-14 rounded-[12px] border border-border/60 bg-muted text-foreground">
                  <AvatarFallback className="text-[16px] font-bold rounded-[12px]">{initials(member.displayName)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-[16px] font-semibold text-foreground tracking-tight">{member.displayName}</span>
                  <span className="text-[12px] text-muted-foreground">{member.githubUsername ? `@${member.githubUsername}` : "No GitHub account"}</span>
                </div>
              </div>

              <Separator className="bg-border/40" />

              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/20 border border-border/40 rounded-xl p-3.5 text-center">
                  <div className="text-[20px] font-bold text-foreground tabular-nums">{openIssues.length}</div>
                  <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Open Issues</div>
                </div>
                <div className="bg-muted/20 border border-border/40 rounded-xl p-3.5 text-center">
                  <div className="text-[20px] font-bold text-foreground tabular-nums">{openPrs.length}</div>
                  <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Open PRs</div>
                </div>
                <div className="bg-muted/20 border border-border/40 rounded-xl p-3.5 text-center">
                  <div className="text-[20px] font-bold text-foreground tabular-nums">{doneIssues.length}</div>
                  <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Completed</div>
                </div>
                <div className="bg-muted/20 border border-border/40 rounded-xl p-3.5 text-center">
                  <div className="text-[20px] font-bold text-foreground tabular-nums">{mergedPrs.length}</div>
                  <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Merged PRs</div>
                </div>
              </div>

              {/* Details */}
              <div className="bg-muted/20 border border-border/40 p-4 rounded-xl flex flex-col gap-2">
                <div className="flex items-center text-[13px] font-medium text-foreground py-1">
                  <div className="w-[90px] flex items-center gap-2 text-muted-foreground/80 shrink-0">
                    <Crown className="size-3.5" /> <span>Role</span>
                  </div>
                  <span className="capitalize">{member.role}</span>
                </div>
                <div className="flex items-center text-[13px] font-medium text-foreground py-1">
                  <div className="w-[90px] flex items-center gap-2 text-muted-foreground/80 shrink-0">
                    <Calendar className="size-3.5" /> <span>Joined</span>
                  </div>
                  <span>{new Date(member.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                </div>
              </div>

              {/* Teams */}
              <div>
                <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 px-1">Teams</h4>
                {(member.teams || []).length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/60 px-1">Not assigned to any teams.</div>
                ) : (
                  <div className="space-y-1.5">
                    {(member.teams || []).map((t: any) => (
                      <div key={t._id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/40 hover:border-border/60 transition-colors">
                        <Users className="size-3.5 text-emerald-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-[12.5px] font-medium text-foreground">{t.name}</span>
                          <span className="text-[11px] text-muted-foreground ml-2 font-mono">{t.identifier}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground capitalize">{t.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Projects */}
              <div>
                <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 px-1">Project Lead</h4>
                {(member.projects || []).length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/60 px-1">Not leading any projects.</div>
                ) : (
                  <div className="space-y-1.5">
                    {(member.projects || []).map((p: any) => {
                      const st = statusMap[p.status] || statusMap.backlog
                      return (
                        <div key={p._id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/40 hover:border-border/60 transition-colors">
                          <FolderKanban className="size-3.5 text-blue-500 shrink-0" />
                          <span className="text-[12.5px] font-medium text-foreground flex-1 truncate">{p.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize font-medium ${st.bg} ${st.border} ${st.color}`}>{st.label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Recent Issues */}
              <div>
                <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 px-1">Assigned Issues</h4>
                {openIssues.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/60 px-1">No open issues assigned.</div>
                ) : (
                  <div className="space-y-1">
                    {openIssues.slice(0, 8).map((issue: any) => {
                      const st = statusMap[issue.status] || statusMap.backlog
                      return (
                        <div key={issue._id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/10 transition-colors">
                          <CircleDot className={`size-3.5 shrink-0 ${st.color}`} />
                          <span className="text-[11px] font-mono text-muted-foreground shrink-0">{issue.identifier}</span>
                          <span className="text-[12.5px] font-medium text-foreground truncate flex-1">{issue.title}</span>
                          {issue.priority !== "none" && (
                            <SignalHigh className={`size-3 shrink-0 ${
                              issue.priority === "urgent" ? "text-red-500" :
                              issue.priority === "high" ? "text-orange-500" : "text-yellow-500"
                            }`} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Recent PRs */}
              <div>
                <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 px-1">Recent Pull Requests</h4>
                {member.pullRequests.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/60 px-1">No pull requests authored.</div>
                ) : (
                  <div className="space-y-1">
                    {member.pullRequests.slice(0, 6).map((pr: any) => (
                      <div key={pr._id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/10 transition-colors">
                        <GitPullRequest className={`size-3.5 shrink-0 ${
                          pr.state === "merged" ? "text-purple-500" :
                          pr.state === "open" ? "text-emerald-500" : "text-muted-foreground"
                        }`} />
                        <span className="text-[12.5px] font-medium text-foreground truncate flex-1">{pr.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize font-medium ${
                          pr.state === "open" ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/10" :
                          pr.state === "merged" ? "text-purple-500 border-purple-500/20 bg-purple-500/10" :
                          "text-muted-foreground border-border/40 bg-muted/20"
                        }`}>{pr.state}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
