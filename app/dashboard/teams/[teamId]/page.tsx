"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { Id } from "@/convex/_generated/dataModel"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  MoreHorizontal, ChevronRight, CircleDashed, Plus,
  Users, CheckCircle2, GitPullRequest, GitMerge,
  XCircle, Code2, Layers, Headset, HardDrive, Palette, Car,
  Globe, Shield, Zap, Bug, Rocket, Database, Cpu, Wifi,
  Smartphone, Monitor, Lock, Settings, Star, Heart,
  UserPlus, Trash2, Crown, FileCode2, GitPullRequestDraft,
  MessageSquare, SignalHigh, SignalMedium, SignalLow, AlertCircle,
  RefreshCw, Milestone
} from "lucide-react"

// Icon registry
const TEAM_ICONS: Record<string, { icon: any; color: string }> = {
  Code2: { icon: Code2, color: "text-blue-500" },
  Layers: { icon: Layers, color: "text-pink-500" },
  HardDrive: { icon: HardDrive, color: "text-yellow-600" },
  Palette: { icon: Palette, color: "text-orange-500" },
  Car: { icon: Car, color: "text-indigo-500" },
  Headset: { icon: Headset, color: "text-cyan-500" },
  Globe: { icon: Globe, color: "text-emerald-500" },
  Shield: { icon: Shield, color: "text-red-500" },
  Zap: { icon: Zap, color: "text-yellow-500" },
  Bug: { icon: Bug, color: "text-rose-500" },
  Rocket: { icon: Rocket, color: "text-purple-500" },
  Database: { icon: Database, color: "text-amber-600" },
  Cpu: { icon: Cpu, color: "text-slate-500" },
  Wifi: { icon: Wifi, color: "text-sky-500" },
  Smartphone: { icon: Smartphone, color: "text-violet-500" },
  Monitor: { icon: Monitor, color: "text-teal-500" },
  Lock: { icon: Lock, color: "text-stone-500" },
  Settings: { icon: Settings, color: "text-zinc-500" },
  Star: { icon: Star, color: "text-yellow-500" },
  Heart: { icon: Heart, color: "text-pink-500" },
}

function getTeamIcon(name?: string) {
  return TEAM_ICONS[name || "Code2"] || TEAM_ICONS.Code2
}

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

function getStatusMeta(status: string) {
  const map: Record<string, { icon: any; color: string; label: string }> = {
    backlog: { icon: CircleDashed, color: "text-muted-foreground", label: "Backlog" },
    todo: { icon: CircleDashed, color: "text-muted-foreground", label: "Todo" },
    in_progress: { icon: CircleDashed, color: "text-yellow-500", label: "In Progress" },
    in_review: { icon: CheckCircle2, color: "text-blue-500", label: "In Review" },
    done: { icon: CheckCircle2, color: "text-purple-500", label: "Done" },
    cancelled: { icon: XCircle, color: "text-muted-foreground", label: "Cancelled" },
  }
  return map[status] || map.backlog
}

function getPRStateMeta(state: string, isDraft?: boolean) {
  if (state === "merged") return { icon: GitMerge, color: "text-purple-500", label: "Merged" }
  if (state === "closed") return { icon: XCircle, color: "text-red-500", label: "Closed" }
  if (isDraft) return { icon: GitPullRequestDraft, color: "text-muted-foreground", label: "Draft" }
  return { icon: GitPullRequest, color: "text-green-500", label: "Open" }
}

const priorityIconMap: Record<string, any> = {
  urgent: AlertCircle, high: SignalHigh, medium: SignalMedium, low: SignalLow, none: CircleDashed,
}

const labelColorMap: Record<string, string> = {
  "#ef4444": "text-red-500", "#3b82f6": "text-blue-500", "#f97316": "text-orange-500",
  "#a855f7": "text-purple-500", "#eab308": "text-yellow-500", "#06b6d4": "text-cyan-500",
  "#22c55e": "text-green-500", "#ec4899": "text-pink-500",
}

type TabView = "issues" | "pulls" | "members"

export default function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const resolvedParams = React.use(params)
  const router = useRouter()
  const { organization } = useOrganization()
  const [tab, setTab] = React.useState<TabView>("issues")

  const teamId = resolvedParams.teamId as Id<"teams">

  const team = useQuery(api.teams.getById, { teamId })
  const issues = useQuery(api.teams.listIssuesByTeam, { teamId })
  const prs = useQuery(api.teams.listPRsByTeam, { teamId })
  const orgMembers = useQuery(
    api.members.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )

  const addMember = useMutation(api.teams.addMember)
  const removeMember = useMutation(api.teams.removeMember)
  const updateTeam = useMutation(api.teams.update)

  // Edit team state
  const [editOpen, setEditOpen] = React.useState(false)
  const [editName, setEditName] = React.useState("")
  const [editDescription, setEditDescription] = React.useState("")
  const [editIcon, setEditIcon] = React.useState("")
  const [isSaving, setIsSaving] = React.useState(false)

  const openEditDialog = () => {
    if (!team) return
    setEditName(team.name)
    setEditDescription(team.description || "")
    setEditIcon(team.icon || "Code2")
    setEditOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!team || !editName.trim()) return
    setIsSaving(true)
    try {
      const iconMeta = TEAM_ICONS[editIcon] || TEAM_ICONS.Code2
      await updateTeam({
        teamId: team._id,
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        icon: editIcon,
        color: iconMeta.color,
      })
      toast.success("Team updated")
      setEditOpen(false)
    } catch {
      toast.error("Failed to update team")
    } finally {
      setIsSaving(false)
    }
  }

  // Group issues by status
  const issueGroups = React.useMemo(() => {
    if (!issues) return []
    const statusOrder = ["in_progress", "in_review", "todo", "backlog", "done", "cancelled"]
    const groups: { status: string; meta: ReturnType<typeof getStatusMeta>; items: typeof issues }[] = []
    for (const status of statusOrder) {
      const items = issues.filter(i => i.status === status)
      if (items.length > 0) {
        groups.push({ status, meta: getStatusMeta(status), items })
      }
    }
    return groups
  }, [issues])

  // Group PRs by state
  const prGroups = React.useMemo(() => {
    if (!prs) return []
    const stateOrder = [
      { state: "open", isDraft: false, label: "Open" },
      { state: "open", isDraft: true, label: "Draft" },
      { state: "merged", isDraft: false, label: "Merged" },
      { state: "closed", isDraft: false, label: "Closed" },
    ]
    const groups: { label: string; meta: ReturnType<typeof getPRStateMeta>; items: typeof prs }[] = []
    for (const s of stateOrder) {
      const items = prs.filter(p =>
        p.state === s.state && (s.isDraft ? p.isDraft : !p.isDraft || s.state !== "open")
      )
      if (items.length > 0) {
        groups.push({ label: s.label, meta: getPRStateMeta(s.state, s.isDraft), items })
      }
    }
    return groups
  }, [prs])

  // Members not yet in the team (for add dropdown)
  const availableMembers = React.useMemo(() => {
    if (!orgMembers || !team) return []
    const teamMemberIds = new Set((team.members || []).map((m: any) => m._id))
    return orgMembers.filter(m => !teamMemberIds.has(m._id))
  }, [orgMembers, team])

  if (team === undefined) {
    return (
      <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
        <div className="flex h-screen items-center justify-center">
          <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </SidebarInset></SidebarProvider>
    )
  }
  if (team === null) {
    return (
      <SidebarProvider><AppSidebar /><SidebarInset className="overflow-hidden bg-background">
        <div className="flex h-screen flex-col items-center justify-center text-muted-foreground">
          <Users className="size-8 mb-3 opacity-30" />
          <p className="text-[14px] font-medium">Team not found</p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/dashboard/teams")}>← Back to Teams</Button>
        </div>
      </SidebarInset></SidebarProvider>
    )
  }

  const iconMeta = getTeamIcon(team.icon)
  const TeamIcon = iconMeta.icon

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="flex h-screen w-full flex-col overflow-hidden text-sm bg-background">
          
          {/* Header */}
          <div className="h-14 flex items-center justify-between px-5 border-b shrink-0 bg-background z-10 transition-all">
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
              <SidebarTrigger className="-ml-2" />
              <div className="flex items-center gap-1.5 font-medium text-[13px] text-muted-foreground ml-1">
                <span className="hover:text-foreground cursor-pointer transition-colors" onClick={() => router.push("/dashboard/teams")}>Teams</span>
                <ChevronRight className="size-3.5 opacity-50" />
                <div className="flex items-center gap-1.5 text-foreground px-1.5 py-1 rounded-md cursor-pointer hover:bg-muted/40 transition-colors">
                  <TeamIcon className={`size-4 ${iconMeta.color}`} />
                  {team.name}
                </div>
              </div>
              
              {/* Tab pills */}
              <div className="flex items-center gap-1.5 ml-4 border-l pl-4 border-border/40">
                <Button
                  variant={tab === "issues" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setTab("issues")}
                  className={`h-7 gap-1.5 text-[12px] rounded-md shadow-none px-2.5 ${tab === "issues" ? "bg-muted/60 hover:bg-muted/80 text-foreground font-medium" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <CircleDashed className="size-3" /> Issues {issues && <span className="text-[10px] opacity-60">{issues.length}</span>}
                </Button>
                <Button
                  variant={tab === "pulls" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setTab("pulls")}
                  className={`h-7 gap-1.5 text-[12px] rounded-md shadow-none px-2.5 ${tab === "pulls" ? "bg-muted/60 hover:bg-muted/80 text-foreground font-medium" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <GitPullRequest className="size-3" /> Pull Requests {prs && <span className="text-[10px] opacity-60">{prs.length}</span>}
                </Button>
                <Button
                  variant={tab === "members" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setTab("members")}
                  className={`h-7 gap-1.5 text-[12px] rounded-md shadow-none px-2.5 ${tab === "members" ? "bg-muted/60 hover:bg-muted/80 text-foreground font-medium" : "font-normal border-border/60 bg-transparent hover:bg-muted/40 text-muted-foreground"}`}
                >
                  <Users className="size-3" /> Members {team.members && <span className="text-[10px] opacity-60">{team.memberCount}</span>}
                </Button>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[160px] p-1">
                <DropdownMenuItem onClick={openEditDialog} className="py-1.5 px-2 text-[12px]">
                  <Settings className="size-3.5 mr-2" /> Edit team
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Edit Team Dialog */}
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden">
              <DialogHeader className="p-6 pb-4">
                <DialogTitle className="text-[16px] font-semibold tracking-tight">Edit Team</DialogTitle>
              </DialogHeader>
              <div className="px-6 pb-6 flex flex-col gap-4">
                {/* Icon Picker */}
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-2 block">Icon</label>
                  <div className="grid grid-cols-10 gap-1.5">
                    {Object.entries(TEAM_ICONS).map(([name, meta]) => {
                      const IconComp = meta.icon
                      return (
                        <button
                          key={name}
                          onClick={() => setEditIcon(name)}
                          className={`size-8 flex items-center justify-center rounded-lg border transition-all ${
                            editIcon === name
                              ? "border-[#5e6ad2] bg-[#5e6ad2]/10 ring-1 ring-[#5e6ad2]/30"
                              : "border-border/40 hover:bg-muted/40 hover:border-border/60"
                          }`}
                        >
                          <IconComp className={`size-4 ${meta.color}`} />
                        </button>
                      )
                    })}
                  </div>
                </div>
                {/* Name */}
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Team Name</label>
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="Team name"
                    className="h-9 text-[13px]"
                  />
                </div>
                {/* Description */}
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Description <span className="text-muted-foreground/50">(optional)</span></label>
                  <Input
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    placeholder="Brief team description..."
                    className="h-9 text-[13px]"
                  />
                </div>
                <Button
                  onClick={handleSaveEdit}
                  disabled={!editName.trim() || isSaving}
                  className="w-full h-9 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium rounded-lg shadow-none mt-2"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Content */}
          <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full">
            
            {/* ═══ ISSUES TAB ═══ */}
            {tab === "issues" && (
              <div className="w-full pb-12 mt-1">
                {!issues ? (
                  <div className="flex items-center justify-center py-20"><span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" /></div>
                ) : issues.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <CircleDashed className="size-8 mb-3 opacity-30" />
                    <p className="text-[14px] font-medium">No issues assigned to this team</p>
                    <p className="text-[12px] mt-1 opacity-70">Assign issues to "{team.name}" from the issue detail page</p>
                  </div>
                ) : (
                  issueGroups.map((group, gIdx) => (
                    <div key={gIdx} className="mb-0.5">
                      <div className="flex items-center justify-between px-6 py-2 border-b border-border/40 bg-muted/5 sticky top-0 z-10 backdrop-blur-sm">
                        <div className="flex items-center gap-2.5 font-medium text-[13px] text-foreground">
                          <group.meta.icon className={`size-[15px] ${group.meta.color}`} strokeWidth={2.3} />
                          {group.meta.label} <span className="text-[11px] font-medium text-muted-foreground pt-0.5">{group.items.length}</span>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        {group.items.map((issue: any, idx: number) => {
                          const sm = getStatusMeta(issue.status)
                          const StatusIcon = sm.icon
                          const PriorityIcon = priorityIconMap[issue.priority] || CircleDashed
                          return (
                            <div
                              key={issue._id}
                              onClick={() => router.push(`/dashboard/issues/${issue.identifier}`)}
                              className="flex items-center justify-between px-6 py-1.5 border-b border-border/10 hover:bg-muted/10 transition-colors group/issue cursor-pointer h-10"
                            >
                              <div className="flex items-center gap-3 overflow-hidden flex-1 max-w-[800px]">
                                <MoreHorizontal className="size-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover/issue:opacity-100 transition-opacity" />
                                <span className="text-[12px] font-medium text-muted-foreground/60 shrink-0 tabular-nums w-[65px] tracking-wide">{issue.identifier}</span>
                                <StatusIcon className={`size-4 shrink-0 ${sm.color}`} strokeWidth={2.5} />
                                <span className="text-[13px] font-medium text-foreground truncate pr-4">{issue.title}</span>
                              </div>
                              <div className="flex items-center shrink-0 ml-4 opacity-70 group-hover/issue:opacity-100 transition-opacity justify-end gap-0">
                                {/* Label Pills */}
                                <div className="hidden lg:flex justify-end gap-1.5 w-[180px]">
                                  {(issue.labels || []).slice(0, 2).map((lbl: any, lIdx: number) => (
                                    <div key={lIdx} className="flex items-center gap-1.5 px-2 py-[2px] border border-border/60 rounded-full text-[10.5px] font-medium text-muted-foreground bg-background shadow-none max-w-[150px]">
                                      <div className={`size-2 rounded-full bg-current ${labelColorMap[lbl.color] || 'text-muted-foreground'}`} />
                                      <span className="truncate leading-tight">{lbl.name}</span>
                                    </div>
                                  ))}
                                </div>
                                {/* Comments */}
                                <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground w-[50px] justify-start pl-4">
                                  <MessageSquare className="size-3.5" /> <span className="tabular-nums">{issue.commentCount}</span>
                                </div>
                                {/* Updated */}
                                <div className="text-[12px] text-muted-foreground/80 w-[50px] text-left font-medium tabular-nums hidden xl:block pl-2">
                                  {timeAgo(issue.updatedAt)}
                                </div>
                                {/* Priority */}
                                <div className="w-[30px] flex justify-end px-2">
                                  <PriorityIcon className="size-3.5 text-muted-foreground/60" />
                                </div>
                                {/* Assignee */}
                                <div className="w-[30px] flex justify-end">
                                  {issue.assignee ? (
                                    <Avatar className="size-[20px] border"><AvatarFallback className="text-[8px] font-bold bg-muted/60 text-muted-foreground">{getInitials(issue.assignee.displayName)}</AvatarFallback></Avatar>
                                  ) : (
                                    <div className="size-[20px] flex items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/40"><Users className="size-3" /></div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ═══ PULL REQUESTS TAB ═══ */}
            {tab === "pulls" && (
              <div className="w-full pb-12 mt-1">
                {!prs ? (
                  <div className="flex items-center justify-center py-20"><span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" /></div>
                ) : prs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <GitPullRequest className="size-8 mb-3 opacity-30" />
                    <p className="text-[14px] font-medium">No pull requests assigned to this team</p>
                    <p className="text-[12px] mt-1 opacity-70">Assign PRs to "{team.name}" from the PR detail page</p>
                  </div>
                ) : (
                  prGroups.map((group, gIdx) => (
                    <div key={gIdx} className="mb-0.5">
                      <div className="flex items-center justify-between px-6 py-2 border-b border-border/40 bg-muted/5 sticky top-0 z-10 backdrop-blur-sm">
                        <div className="flex items-center gap-2.5 font-medium text-[13px] text-foreground">
                          <group.meta.icon className={`size-[15px] ${group.meta.color}`} strokeWidth={2.3} />
                          {group.label} <span className="text-[11px] font-medium text-muted-foreground pt-0.5">{group.items.length}</span>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        {group.items.map((pr: any, idx: number) => {
                          const pm = getPRStateMeta(pr.state, pr.isDraft)
                          const PrIcon = pm.icon
                          const prId = `${pr.githubRepoFullName}#${pr.githubPrNumber}`
                          return (
                            <div
                              key={pr._id}
                              onClick={() => router.push(`/dashboard/pulls/${encodeURIComponent(prId)}`)}
                              className="flex items-center justify-between px-6 py-1.5 border-b border-border/10 hover:bg-muted/10 transition-colors group/issue cursor-pointer h-10"
                            >
                              <div className="flex items-center gap-3 overflow-hidden flex-1 max-w-[800px]">
                                <MoreHorizontal className="size-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover/issue:opacity-100 transition-opacity" />
                                <span className="text-[11.5px] font-medium text-muted-foreground/50 shrink-0 tracking-wide w-[140px] truncate">{prId}</span>
                                <PrIcon className={`size-4 shrink-0 ${pm.color}`} strokeWidth={2.5} />
                                <span className="text-[13px] font-medium text-foreground truncate pr-4">{pr.title}</span>
                              </div>
                              <div className="flex items-center shrink-0 ml-4 opacity-80 group-hover/issue:opacity-100 transition-opacity justify-end gap-0">
                                {/* Labels */}
                                <div className="hidden lg:flex justify-end gap-1.5 w-[120px]">
                                  {(pr.githubLabels || []).slice(0, 2).map((lbl: any, lIdx: number) => (
                                    <div key={lIdx} className="flex items-center gap-1 px-1.5 py-0.5 border border-border/60 rounded-md text-[10px] font-medium text-muted-foreground bg-background shadow-none">
                                      <span className="size-1.5 rounded-full" style={{ backgroundColor: lbl.color }} />
                                      <span className="truncate max-w-[70px]">{lbl.name}</span>
                                    </div>
                                  ))}
                                </div>
                                {/* CI Status */}
                                <div className="flex items-center justify-start w-[60px] pl-3 text-[11px] font-semibold shrink-0 hidden md:flex">
                                  {pr.checksStatus === "success" && <div className="flex items-center gap-1 text-emerald-500"><CheckCircle2 className="size-3.5" /> Pass</div>}
                                  {pr.checksStatus === "failure" && <div className="flex items-center gap-1 text-red-500"><XCircle className="size-3.5" /> Fail</div>}
                                  {pr.checksStatus === "pending" && <div className="flex items-center gap-1 text-amber-500"><RefreshCw className="size-3.5 animate-spin" /> CI</div>}
                                  {!pr.checksStatus && <div className="text-muted-foreground/40"><CircleDashed className="size-3.5" /></div>}
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
                                {/* Updated */}
                                <div className="text-[11px] text-muted-foreground/70 w-[40px] text-right font-medium tabular-nums hidden xl:block pl-2">
                                  {timeAgo(pr.updatedAt)}
                                </div>
                                {/* Author */}
                                <div className="w-[36px] flex justify-end">
                                  <Avatar className="size-[22px] border"><AvatarFallback className="text-[8px] font-bold bg-muted/60 text-muted-foreground">{getInitials(pr.authorGithubUsername)}</AvatarFallback></Avatar>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ═══ MEMBERS TAB ═══ */}
            {tab === "members" && (
              <div className="w-full pb-12">
                {/* Add member button */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-border/40">
                  <span className="text-[13px] font-medium text-foreground">{team.memberCount} member{team.memberCount !== 1 ? "s" : ""}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px] font-normal shadow-none border-border/60">
                        <UserPlus className="size-3.5" /> Add member
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[220px] p-1 max-h-[300px] overflow-y-auto">
                      {availableMembers.length === 0 ? (
                        <div className="px-3 py-2 text-[12px] text-muted-foreground">All org members are in this team</div>
                      ) : (
                        availableMembers.map((m) => (
                          <DropdownMenuItem
                            key={m._id}
                            onClick={async () => {
                              try {
                                await addMember({ teamId: team._id, memberId: m._id, role: "member" })
                                toast.success(`${m.displayName} added to ${team.name}`)
                              } catch { toast.error("Failed to add member") }
                            }}
                            className="py-2 px-2 flex items-center gap-2.5 text-[12px]"
                          >
                            <Avatar className="size-[22px] border"><AvatarFallback className="text-[8px] font-bold bg-muted/60 text-muted-foreground">{getInitials(m.displayName)}</AvatarFallback></Avatar>
                            <div>
                              <div className="font-medium text-foreground">{m.displayName}</div>
                              <div className="text-[10px] text-muted-foreground">{m.githubUsername || "No username"}</div>
                            </div>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Member list */}
                {(team.members || []).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Users className="size-8 mb-3 opacity-30" />
                    <p className="text-[14px] font-medium">No members yet</p>
                    <p className="text-[12px] mt-1 opacity-70">Add organization members to this team</p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {(team.members || []).map((member: any) => (
                      <div key={member._id} className="flex items-center justify-between px-6 py-3 border-b border-border/40 hover:bg-muted/10 transition-colors">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-[32px] border">
                            <AvatarFallback className="text-[11px] font-bold bg-muted/60 text-muted-foreground">{getInitials(member.displayName)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="text-[14px] font-medium text-foreground tracking-tight">{member.displayName}</div>
                            <div className="text-[12px] text-muted-foreground/70">{member.email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {member.role === "lead" && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                              <Crown className="size-3" /> Lead
                            </span>
                          )}
                          {member.role === "member" && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/40 text-muted-foreground border border-border/40">Member</span>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"><MoreHorizontal className="size-3.5" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[160px] p-1">
                              <DropdownMenuItem
                                onClick={async () => {
                                  const newRole = member.role === "lead" ? "member" : "lead"
                                  try {
                                    await addMember({ teamId: team._id, memberId: member._id, role: newRole as "lead" | "member" })
                                    toast.success(`${member.displayName} is now ${newRole}`)
                                  } catch { toast.error("Failed to update role") }
                                }}
                                className="py-1.5 px-2 text-[12px]"
                              >
                                <Crown className="size-3.5 mr-2" /> {member.role === "lead" ? "Make Member" : "Make Lead"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={async () => {
                                  try {
                                    await removeMember({ teamId: team._id, memberId: member._id })
                                    toast.success(`${member.displayName} removed from ${team.name}`)
                                  } catch { toast.error("Failed to remove member") }
                                }}
                                className="py-1.5 px-2 text-[12px] text-red-500 focus:text-red-500"
                              >
                                <Trash2 className="size-3.5 mr-2" /> Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
