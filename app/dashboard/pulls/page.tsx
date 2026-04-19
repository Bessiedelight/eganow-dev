"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { fetchRepoPullRequests, fetchInstallationRepos, fetchRepoCommits } from "@/lib/github/actions"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  MoreHorizontal, ListFilter, SlidersHorizontal, ChevronRight,
  CheckCircle2, CircleDashed, Users, GitPullRequest, GitMerge,
  Search, RefreshCw, XCircle, GitPullRequestDraft, GitPullRequestClosed,
  FileCode2, MessageSquare, GitCommit, ShieldCheck, ShieldAlert, Shield
} from "lucide-react"

function getInitials(name: string) {
  return name.split(/[\s._-]+/).map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "now"
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// Group icon & color by PR type
function getStatusIcon(state: string, isDraft: boolean) {
  if (state === "merged") return { icon: GitMerge, color: "text-purple-500" }
  if (state === "closed") return { icon: GitPullRequestClosed, color: "text-red-500" }
  if (isDraft) return { icon: GitPullRequestDraft, color: "text-muted-foreground" }
  return { icon: GitPullRequest, color: "text-green-500" }
}

type ViewFilter = "all" | "reviews" | "drafts" | "commits" | "merged"

// Derive review decision from reviewers array
function getReviewDecision(reviewers: any[]) {
  if (!reviewers || reviewers.length === 0) return null
  const hasApproved = reviewers.some(r => r.state === "approved")
  const hasChangesRequested = reviewers.some(r => r.state === "changes_requested")
  if (hasChangesRequested) return { label: "Changes", color: "text-orange-500", bg: "bg-orange-500/10", icon: ShieldAlert }
  if (hasApproved) return { label: "Approved", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: ShieldCheck }
  return { label: "Pending", color: "text-muted-foreground", bg: "bg-muted/40", icon: Shield }
}

export default function GitPullsPage() {
  const router = useRouter()
  const { organization, isLoading: orgLoading } = useOrganization()
  const [viewFilter, setViewFilter] = React.useState<ViewFilter>("all")
  const [isSyncing, setIsSyncing] = React.useState(false)
  const hasSynced = React.useRef(false)

  const prs = useQuery(
    api.pullRequests.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )
  const commits = useQuery(
    api.commits.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )

  const syncPR = useMutation(api.pullRequests.syncFromGitHub)
  const syncCommit = useMutation(api.commits.syncFromGitHub)

  // Auto-sync from GitHub ONLY when DB is empty (first use).
  React.useEffect(() => {
    if (!organization || hasSynced.current || prs === undefined) return
    hasSynced.current = true
    if (prs.length === 0) syncAllData()
  }, [organization, prs])

  const syncAllData = async () => {
    if (!organization || isSyncing) return
    setIsSyncing(true)
    try {
      const repos = await fetchInstallationRepos(organization.githubInstallationId)
      // Sync PRs
      const allGhPrs: any[] = []
      await Promise.allSettled(
        repos.map(async (repo) => {
          try {
            const ghPrs = await fetchRepoPullRequests(organization.githubInstallationId, repo.fullName)
            allGhPrs.push(...ghPrs)
          } catch { /* skip */ }
        })
      )
      await Promise.allSettled(
        allGhPrs.map((pr) =>
          syncPR({ orgId: organization._id, ...pr }).catch(() => {})
        )
      )
      // Sync Commits
      const allCommits: any[] = []
      await Promise.allSettled(
        repos.map(async (repo) => {
          try {
            const ghCommits = await fetchRepoCommits(organization.githubInstallationId, repo.fullName, 20)
            allCommits.push(...ghCommits)
          } catch { /* skip */ }
        })
      )
      await Promise.allSettled(
        allCommits.map((c) =>
          syncCommit({ orgId: organization._id, ...c }).catch(() => {})
        )
      )
    } catch (err) {
      console.error("Failed to sync:", err)
    } finally {
      setIsSyncing(false)
    }
  }

  // Group data based on active filter
  const groupedData = React.useMemo(() => {
    if (viewFilter === "commits") return [] // handled separately
    if (!prs) return []

    let filtered = prs
    if (viewFilter === "reviews") filtered = prs.filter(p => p.state === "open" && !p.isDraft)
    else if (viewFilter === "drafts") filtered = prs.filter(p => p.state === "open" && p.isDraft)
    else if (viewFilter === "merged") filtered = prs.filter(p => p.state === "merged")

    const needsReview = filtered.filter(p => p.state === "open" && !p.isDraft)
    const drafts = filtered.filter(p => p.state === "open" && p.isDraft)
    const merged = filtered.filter(p => p.state === "merged")
    const closed = filtered.filter(p => p.state === "closed")

    const groups: { group: string; groupIcon: any; groupColor: string; prList: any[] }[] = []
    if (needsReview.length > 0) groups.push({ group: "Needs Review", groupIcon: GitPullRequest, groupColor: "text-green-500", prList: needsReview })
    if (drafts.length > 0) groups.push({ group: "Draft / In Progress", groupIcon: GitPullRequestDraft, groupColor: "text-muted-foreground", prList: drafts })
    if (merged.length > 0) groups.push({ group: "Recently Merged", groupIcon: GitMerge, groupColor: "text-purple-500", prList: merged })
    if (closed.length > 0) groups.push({ group: "Closed", groupIcon: GitPullRequestClosed, groupColor: "text-red-500", prList: closed })

    return groups
  }, [prs, viewFilter])

  const isLoading = orgLoading || (organization !== null && prs === undefined)

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
                <GitPullRequest className="size-4 text-emerald-500" /> Reviews
                </div>
              </div>
              
              {/* Filters / Views pills */}
              <div className="flex items-center gap-1.5 ml-4 border-l pl-4 border-border/40 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                <Button
                  variant={viewFilter === "all" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setViewFilter("all")}
                  className={`h-7 gap-1.5 text-[12px] font-medium rounded-md shadow-none px-2.5 ${viewFilter === "all" ? "bg-muted/60 hover:bg-muted/80 text-foreground" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <GitPullRequest className="size-3" /> All
                </Button>
                <Button
                  variant={viewFilter === "reviews" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setViewFilter("reviews")}
                  className={`h-7 gap-1.5 text-[12px] font-medium rounded-md shadow-none px-2.5 ${viewFilter === "reviews" ? "bg-muted/60 hover:bg-muted/80 text-foreground" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <ShieldCheck className="size-3" /> Reviews
                </Button>
                <Button
                  variant={viewFilter === "drafts" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setViewFilter("drafts")}
                  className={`h-7 gap-1.5 text-[12px] font-medium rounded-md shadow-none px-2.5 ${viewFilter === "drafts" ? "bg-muted/60 hover:bg-muted/80 text-foreground" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <GitPullRequestDraft className="size-3" /> Drafts
                </Button>
                <Button
                  variant={viewFilter === "commits" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setViewFilter("commits")}
                  className={`h-7 gap-1.5 text-[12px] font-medium rounded-md shadow-none px-2.5 ${viewFilter === "commits" ? "bg-muted/60 hover:bg-muted/80 text-foreground" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <GitCommit className="size-3" /> Commits
                </Button>
                <Button
                  variant={viewFilter === "merged" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setViewFilter("merged")}
                  className={`h-7 gap-1.5 text-[12px] font-medium rounded-md shadow-none px-2.5 ${viewFilter === "merged" ? "bg-muted/60 hover:bg-muted/80 text-foreground" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <GitMerge className="size-3 text-purple-500" /> Merged
                </Button>
              </div>
            </div>
          </div>

          {/* Sub-header / Primary List Toolbar */}
          <div className="h-12 flex items-center justify-between px-5 border-b shrink-0 bg-background text-sm">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" className="h-7 gap-2 text-muted-foreground -ml-2 transition-colors hover:text-foreground text-[13px] font-normal">
                <ListFilter className="size-4" strokeWidth={2} /> Filter
              </Button>
              <div className="flex items-center gap-2 px-2 border-l border-border/40">
                <Search className="size-3.5 text-muted-foreground" />
                <input placeholder="Search branches or repos..." className="bg-transparent border-none outline-none text-xs w-[200px] placeholder:text-muted-foreground/60" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isSyncing && (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <RefreshCw className="size-3 animate-spin" /> Syncing...
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={syncAllData}
                disabled={isSyncing || !organization}
                className="h-7 gap-1.5 text-[12px] font-normal border-border/80 shadow-none transition-colors hover:bg-muted/50 rounded-md"
              >
                <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} /> Sync
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px] font-normal border-border/80 shadow-none transition-colors hover:bg-muted/50 rounded-md">
                <SlidersHorizontal className="size-3.5" /> Display
              </Button>
            </div>
          </div>

          {/* Scrollable PR Canvas */}
          <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full">
            
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              </div>
            ) : viewFilter === "commits" ? (
              /* ═══ COMMITS VIEW ═══ */
              !commits || commits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <GitCommit className="size-8 mb-3 opacity-30" />
                  <p className="text-[14px] font-medium">No commits synced yet</p>
                  <p className="text-[12px] mt-1 opacity-70">Click Sync to fetch recent commits from your repos</p>
                  <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={syncAllData} disabled={isSyncing}>
                    <RefreshCw className="size-3.5" /> Sync from GitHub
                  </Button>
                </div>
              ) : (
                <div className="w-full pb-12 mt-1">
                  <div className="mb-0.5">
                    <div className="flex items-center justify-between px-6 py-2 border-b border-border/40 bg-muted/5 sticky top-0 z-10 backdrop-blur-sm">
                      <div className="flex items-center gap-2.5 font-medium text-[13px] text-foreground">
                        <GitCommit className="size-[15px] text-blue-500" strokeWidth={2.3} />
                        Recent Commits <span className="text-[11px] font-medium text-muted-foreground pt-0.5">{commits.length}</span>
                      </div>
                    </div>
                    <div className="flex flex-col">
                      {commits.map((c: any, idx: number) => {
                        const commitRoute = `commit:${c.githubRepoFullName}:${c.sha}`
                        const firstLine = c.message.split("\n")[0]
                        return (
                          <div key={c._id || idx} onClick={() => router.push(`/dashboard/pulls/${encodeURIComponent(commitRoute)}`)} className="flex items-center justify-between px-6 py-2 border-b border-border/40 even:bg-muted/20 hover:bg-muted/30 transition-colors group/issue cursor-pointer h-[42px]">
                            <div className="flex items-center gap-3 overflow-hidden flex-1 max-w-[850px]">
                              <MoreHorizontal className="size-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover/issue:opacity-100 transition-opacity" />
                              <span className="text-[11.5px] font-mono text-blue-500/70 shrink-0 tracking-wide w-[70px]">{c.shortSha}</span>
                              <GitCommit className="size-4 shrink-0 text-blue-500" strokeWidth={2.5} />
                              <span className="text-[13px] font-medium text-foreground truncate pl-0.5 max-w-[400px]">{firstLine}</span>
                              <span className="hidden xl:flex items-center px-2 py-[2px] border border-border/40 bg-muted/20 rounded-md text-[10.5px] font-mono text-muted-foreground truncate">
                                {c.githubRepoFullName.split("/")[1]}
                              </span>
                            </div>
                            <div className="flex items-center shrink-0 ml-4 opacity-80 group-hover/issue:opacity-100 transition-opacity justify-end gap-0">
                              <div className="flex items-center justify-end w-[80px] text-[10.5px] font-mono tracking-tight gap-1.5 shrink-0 ml-2 hidden sm:flex">
                                <span className="text-emerald-500 font-semibold bg-emerald-500/10 px-1 rounded">+{c.additions ?? "—"}</span>
                                <span className="text-red-500 font-semibold bg-red-500/10 px-1 rounded">-{c.deletions ?? "—"}</span>
                              </div>
                              <div className="hidden xl:flex items-center justify-center w-[48px] text-[10.5px] text-muted-foreground/70 font-medium gap-1 ml-1">
                                <FileCode2 className="size-3" />
                                <span className="tabular-nums">{c.changedFiles ?? "—"}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground/70 w-[40px] text-right font-medium tabular-nums hidden xl:block pl-2">
                                {timeAgo(c.committedAt)}
                              </div>
                              <div className="w-[36px] flex justify-end">
                                <Avatar className="size-[22px] border">
                                  <AvatarFallback className="text-[8px] font-bold bg-muted/60 text-muted-foreground">{getInitials(c.authorGithubUsername)}</AvatarFallback>
                                </Avatar>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            ) : groupedData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <GitPullRequest className="size-8 mb-3 opacity-30" />
                <p className="text-[14px] font-medium">No pull requests found</p>
                <p className="text-[12px] mt-1 opacity-70">Try a different filter or sync from GitHub</p>
              </div>
            ) : (
              <div className="w-full pb-12 mt-1">
                {groupedData.map((group, gIdx) => (
                  <div key={gIdx} className="mb-0.5">
                    <div className="flex items-center justify-between px-6 py-2 border-b border-border/40 bg-muted/5 sticky top-0 z-10 backdrop-blur-sm">
                      <div className="flex items-center gap-2.5 font-medium text-[13px] text-foreground">
                        <group.groupIcon className={`size-[15px] ${group.groupColor}`} strokeWidth={2.3} />
                        {group.group} <span className="text-[11px] font-medium text-muted-foreground pt-0.5">{group.prList.length}</span>
                      </div>
                    </div>
                    <div className="flex flex-col">
                      {group.prList.map((pr: any, idx: number) => {
                        const si = getStatusIcon(pr.state, pr.isDraft)
                        const StatusIcon = si.icon
                        const prId = `${pr.githubRepoFullName}#${pr.githubPrNumber}`
                        const branchLabel = `${pr.headBranch} → ${pr.baseBranch}`
                        const linkedIssue = pr.linkedIssues?.[0]
                        const reviewDecision = getReviewDecision(pr.reviewers)

                        return (
                          <div key={pr._id || idx} onClick={() => router.push(`/dashboard/pulls/${encodeURIComponent(prId)}`)} className="flex items-center justify-between px-6 py-2 border-b border-border/40 even:bg-muted/20 hover:bg-muted/30 transition-colors group/issue cursor-pointer h-[42px]">
                            <div className="flex items-center gap-3 overflow-hidden flex-1 max-w-[850px]">
                              <MoreHorizontal className="size-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover/issue:opacity-100 transition-opacity" />
                              <span className="text-[11.5px] font-medium text-muted-foreground/50 shrink-0 tracking-wide w-[140px] truncate">{prId}</span>
                              <StatusIcon className={`size-4 shrink-0 ${si.color}`} strokeWidth={2.5} />
                              <span className="text-[13px] font-medium text-foreground truncate pl-0.5 max-w-[280px]">{pr.title}</span>
                              <span className="hidden xl:flex items-center gap-1.5 px-2 py-[2px] border border-border/40 bg-muted/20 rounded-md text-[10.5px] font-mono text-muted-foreground truncate w-fit">
                                {branchLabel}
                              </span>
                              {linkedIssue && (
                                <span className="flex items-center gap-1.5 px-2 py-[2px] border border-border/60 hover:bg-muted transition-colors rounded-md text-[10.5px] font-medium text-muted-foreground bg-background cursor-pointer whitespace-nowrap">
                                  <CircleDashed className="size-2.5" /> {linkedIssue.linkType === "closes" ? "Closes" : "Refs"} {linkedIssue.identifier}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center shrink-0 ml-4 opacity-80 group-hover/issue:opacity-100 transition-opacity justify-end gap-0">
                              {/* Review Decision Badge */}
                              {reviewDecision && pr.state === "open" && !pr.isDraft && (
                                <div className={`hidden md:flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${reviewDecision.color} ${reviewDecision.bg} w-[72px] justify-center`}>
                                  <reviewDecision.icon className="size-3" />
                                  {reviewDecision.label}
                                </div>
                              )}
                              {/* Labels */}
                              <div className="hidden lg:flex justify-end gap-1.5 w-[120px] ml-2">
                                {(pr.githubLabels || []).slice(0, 2).map((lbl: any, lIdx: number) => (
                                  <div key={lIdx} className="flex items-center gap-1 px-1.5 py-0.5 border border-border/60 rounded-md text-[10px] font-medium text-muted-foreground bg-background shadow-none">
                                    <span className="size-1.5 rounded-full" style={{ backgroundColor: lbl.color }} />
                                    <span className="truncate max-w-[60px]">{lbl.name}</span>
                                  </div>
                                ))}
                              </div>
                              {/* CI Status */}
                              <div className="flex items-center justify-start w-[60px] pl-3 text-[11px] font-semibold shrink-0 hidden md:flex">
                                {pr.checksStatus === "success" && <div className="flex items-center gap-1 text-emerald-500 tracking-tight"><CheckCircle2 className="size-3.5" /> Pass</div>}
                                {pr.checksStatus === "failure" && <div className="flex items-center gap-1 text-red-500 tracking-tight"><XCircle className="size-3.5" /> Fail</div>}
                                {pr.checksStatus === "pending" && <div className="flex items-center gap-1 text-amber-500 tracking-tight"><RefreshCw className="size-3.5 animate-spin" /> CI</div>}
                                {!pr.checksStatus && <div className="flex items-center gap-1 text-muted-foreground/40 tracking-tight"><CircleDashed className="size-3.5" /></div>}
                              </div>
                              {/* Diff Stats */}
                              <div className="flex items-center justify-end w-[80px] text-[10.5px] font-mono tracking-tight gap-1.5 shrink-0 ml-2 hidden sm:flex">
                                <span className="text-emerald-500 font-semibold bg-emerald-500/10 px-1 rounded">+{pr.additions ?? 0}</span>
                                <span className="text-red-500 font-semibold bg-red-500/10 px-1 rounded">-{pr.deletions ?? 0}</span>
                              </div>
                              {/* Changed Files */}
                              <div className="hidden xl:flex items-center justify-center w-[48px] text-[10.5px] text-muted-foreground/70 font-medium gap-1 ml-1">
                                <FileCode2 className="size-3" />
                                <span className="tabular-nums">{pr.changedFiles ?? 0}</span>
                              </div>
                              {/* Comments */}
                              <div className="hidden xl:flex items-center justify-center w-[40px] text-[10.5px] text-muted-foreground/70 font-medium gap-1">
                                <MessageSquare className="size-3" />
                                <span className="tabular-nums">{pr.commentCount ?? 0}</span>
                              </div>
                              {/* Reviewers */}
                              <div className="flex items-center justify-end w-[50px] pr-1 -space-x-1.5">
                                {(pr.reviewers || []).length > 0 ? (
                                  (pr.reviewers || []).slice(0, 3).map((rev: any, rIdx: number) => (
                                    <Avatar key={rIdx} className="size-[20px] ring-2 ring-background">
                                      <AvatarFallback className={`text-[7px] font-bold text-current ${
                                        rev.state === "approved" ? "bg-emerald-500/30" :
                                        rev.state === "changes_requested" ? "bg-red-500/30" : "bg-muted-foreground/30"
                                      }`}>{getInitials(rev.githubUsername)}</AvatarFallback>
                                    </Avatar>
                                  ))
                                ) : (
                                  <div className="size-[20px] flex items-center justify-center rounded-full border border-dashed border-border/80 text-muted-foreground/40 bg-muted/20">
                                    <Users className="size-3" />
                                  </div>
                                )}
                              </div>
                              {/* Time */}
                              <div className="text-[11px] text-muted-foreground/70 w-[40px] text-right font-medium tabular-nums hidden xl:block pl-2">
                                {timeAgo(pr.updatedAt)}
                              </div>
                              {/* Author */}
                              <div className="w-[36px] flex justify-end">
                                <Avatar className="size-[22px] border">
                                  <AvatarFallback className="text-[8px] font-bold bg-muted/60 text-muted-foreground">{getInitials(pr.authorGithubUsername)}</AvatarFallback>
                                </Avatar>
                              </div>
                            </div>
                          </div>
                        )
                      })}
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
