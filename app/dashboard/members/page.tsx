"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Users, Search, MoreHorizontal, Shield, Crown, ChevronDown, Settings2, ShieldCheck
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Role = "owner" | "admin" | "member" | "viewer"
type SectionKey = "issues" | "reviews" | "teams" | "projects" | "settings" | "agents"
type Perm = {
  role: Role
  isHead: boolean
  sections: Record<SectionKey, boolean>
  manageMembers: boolean
  managePermissions: boolean
  assignWork: boolean
  syncGitHub: boolean
}

// ── Constants ────────────────────────────────────────

const ROLE_GROUP_META: Record<Role, { label: string; description: string; icon: any }> = {
  owner: { label: "Organization Heads", description: "Full administrative access", icon: Crown },
  admin: { label: "Team Heads", description: "Team management and elevated access", icon: Shield },
  member: { label: "Members", description: "Standard workspace access", icon: Users },
  viewer: { label: "Viewers", description: "Read-only access", icon: Users },
}

const ROLE_BADGE_STYLE: Record<Role, string> = {
  owner: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  admin: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  member: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  viewer: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  invited: "bg-amber-500",
  deactivated: "bg-red-400",
}

const TAG_STYLE = "text-[11px] px-2 py-[2px] rounded-full border font-medium"

const sectionMeta: { key: SectionKey; label: string; description: string }[] = [
  { key: "issues", label: "Issues", description: "Create and manage issue work." },
  { key: "reviews", label: "Reviews", description: "Participate in PR review flows." },
  { key: "teams", label: "Teams", description: "Open team spaces and manage placement." },
  { key: "projects", label: "Projects", description: "Plan and track delivery work." },
  { key: "settings", label: "Settings", description: "Change workspace configuration." },
  { key: "agents", label: "AI & Agents", description: "Launch AI-assisted actions." },
]

const adminPerms: { label: string; desc: string; key: keyof Perm }[] = [
  { label: "Manage members", desc: "Invite, deactivate, and reassign workspace access.", key: "manageMembers" },
  { label: "Manage permissions", desc: "Edit roles and section-level access.", key: "managePermissions" },
  { label: "Assign work", desc: "Assign issues, leads, and reviewer ownership.", key: "assignWork" },
  { label: "Sync GitHub", desc: "Refresh roster and import org activity.", key: "syncGitHub" },
]

const ROLE_LABELS: Record<Role, string> = {
  owner: "Organization Head",
  admin: "Team Head",
  member: "Standard Member",
  viewer: "Viewer Only"
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full administrative access. Automatically assigned to the creator of the workspace.",
  admin: "Can manage members, assign work, and access all feature sections except core settings.",
  member: "Standard access to issues, reviews, and projects. Cannot manage access.",
  viewer: "Read-only access to all tracking sections. Cannot modify records or access AI agents."
}

// ── Helpers ──────────────────────────────────────────

function getBaseDefaults(role: Role): Perm {
  if (role === "owner") return { role, isHead: true, sections: { issues: true, reviews: true, teams: true, projects: true, settings: true, agents: true }, manageMembers: true, managePermissions: true, assignWork: true, syncGitHub: true }
  if (role === "admin") return { role, isHead: false, sections: { issues: true, reviews: true, teams: true, projects: true, settings: false, agents: true }, manageMembers: true, managePermissions: true, assignWork: true, syncGitHub: false }
  if (role === "viewer") return { role, isHead: false, sections: { issues: true, reviews: true, teams: true, projects: true, settings: false, agents: false }, manageMembers: false, managePermissions: false, assignWork: false, syncGitHub: false }
  return { role, isHead: false, sections: { issues: true, reviews: true, teams: true, projects: true, settings: false, agents: true }, manageMembers: false, managePermissions: false, assignWork: true, syncGitHub: false }
}

function initials(name?: string) {
  return (name || "??").split(/[\s._-]+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(ts)
}

function getAccessTags(role: Role): string[] {
  switch (role) {
    case "owner": return ["Full Access"]
    case "admin": return ["Issues", "Reviews", "Teams"]
    case "member": return ["Issues", "Reviews"]
    case "viewer": return ["Read Only"]
  }
}

// ── Page ─────────────────────────────────────────────

export default function MembersPage() {
  const router = useRouter()
  const { organization, isLoading: orgLoading } = useOrganization()
  const members = useQuery(api.members.listByOrg, organization ? { orgId: organization._id } : "skip")

  const [activeTab, setActiveTab] = React.useState<"directory" | "roles">("directory")
  const [search, setSearch] = React.useState("")
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({})
  const [selectedRoleTab, setSelectedRoleTab] = React.useState<Role>("admin")
  const [roleTemplates, setRoleTemplates] = React.useState<Record<Role, Perm>>({
    owner: getBaseDefaults("owner"),
    admin: getBaseDefaults("admin"),
    member: getBaseDefaults("member"),
    viewer: getBaseDefaults("viewer"),
  })

  const loading = orgLoading || (organization !== null && members === undefined)
  const totalCount = members?.length || 0

  const toggleGroup = (role: string) => {
    setCollapsedGroups(prev => ({ ...prev, [role]: !prev[role] }))
  }

  const updateRoleTemplate = (role: Role, updates: Partial<Perm>) => {
    setRoleTemplates(prev => ({
      ...prev,
      [role]: { ...prev[role], ...updates }
    }))
  }

  const activeTemplate = roleTemplates[selectedRoleTab]

  const grouped = React.useMemo(() => {
    const all = members || []
    const filtered = search.trim()
      ? all.filter(m =>
        `${m.displayName} ${m.githubUsername || ""}`.toLowerCase().includes(search.toLowerCase().trim())
      )
      : all
    const groups: Record<Role, typeof filtered> = { owner: [], admin: [], member: [], viewer: [] }
    filtered.forEach(m => {
      const role = m.role as Role
      if (groups[role]) groups[role].push(m)
    })
    return groups
  }, [members, search])

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col overflow-hidden text-sm bg-background">

          {/* Header */}
          <div className="h-14 flex items-center px-6 border-b shrink-0 bg-background/95 backdrop-blur z-20">
            <SidebarTrigger className="-ml-3 mr-2" />
            <Users className="size-4 text-muted-foreground mr-2" />
            <span className="font-semibold text-foreground tracking-tight">Members</span>
            <span className="text-muted-foreground ml-2 text-[12px]">{totalCount}</span>
          </div>

          <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full bg-muted/20 dark:bg-muted/10">
            <div className="max-w-[1080px] mx-auto w-full px-8 py-10 pb-24">

              {/* Title */}
              <div className="mb-8">
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground mb-1.5">People & Roles</h1>
                <p className="text-[13.5px] text-muted-foreground">Manage workspace members and define permission groups.</p>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-8 border-b border-border/60 mb-8">
                <button
                  onClick={() => setActiveTab("directory")}
                  className={`pb-3.5 text-[13.5px] font-medium transition-colors border-b-2 relative top-[1px] ${activeTab === 'directory' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  <div className="flex items-center gap-2"><Users className="size-4" /> Member Directory</div>
                </button>
                <button
                  onClick={() => setActiveTab("roles")}
                  className={`pb-3.5 text-[13.5px] font-medium transition-colors border-b-2 relative top-[1px] ${activeTab === 'roles' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  <div className="flex items-center gap-2"><Shield className="size-4" /> Role Templates</div>
                </button>
              </div>

              {loading ? (
                <div className="py-20 flex justify-center"><span className="size-6 border-2 border-muted-foreground border-t-foreground rounded-full animate-spin" /></div>
              ) : (
                <div className="relative overflow-hidden">
                  <div
                    className="flex transition-transform duration-300 ease-in-out"
                    style={{ transform: activeTab === "directory" ? "translateX(0)" : "translateX(-100%)" }}
                  >
                    {/* ═══════ PANEL 1: DIRECTORY ═══════ */}
                    <div className="w-full shrink-0">
                      {/* Search */}
                      <div className="relative w-full max-w-[380px] mb-6">
                        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="Search by name or username..."
                          className="h-9 pl-9 text-[13px] border-border/60 bg-background shadow-none"
                        />
                      </div>

                      <div className="space-y-6">
                        {(["owner", "admin", "member", "viewer"] as Role[]).map(role => {
                          const group = grouped[role]
                          if (group.length === 0) return null
                          const meta = ROLE_GROUP_META[role]
                          const Icon = meta.icon
                          const isCollapsed = collapsedGroups[role]

                          return (
                            <div key={role} className="border border-border/60 rounded-[12px] bg-background overflow-hidden">
                              {/* Section header */}
                              <button
                                onClick={() => toggleGroup(role)}
                                className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/5 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`size-8 rounded-lg flex items-center justify-center border ${ROLE_BADGE_STYLE[role]}`}>
                                    <Icon className="size-3.5" />
                                  </div>
                                  <div className="text-left">
                                    <h3 className="text-[14px] font-semibold text-foreground tracking-tight">{meta.label}</h3>
                                    <p className="text-[11.5px] text-muted-foreground">{meta.description}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-[12px] text-muted-foreground font-medium tabular-nums">{group.length} {group.length === 1 ? "member" : "members"}</span>
                                  <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`} />
                                </div>
                              </button>

                              {/* Table */}
                              {!isCollapsed && (
                                <div>
                                  <div className="grid grid-cols-[1fr_160px_140px_140px_36px] items-center px-6 py-2.5 border-t border-border/40 bg-muted/5">
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">User</span>
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Access</span>
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Last active</span>
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Date added</span>
                                    <span />
                                  </div>
                                  <div className="divide-y divide-border/30">
                                    {group.map(m => (
                                      <div
                                        key={m._id}
                                        onClick={() => router.push(`/dashboard/members/${m._id}`)}
                                        className="grid grid-cols-[1fr_160px_140px_140px_36px] items-center px-6 py-3.5 hover:bg-muted/5 transition-colors cursor-pointer group"
                                      >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                          <div className="relative">
                                            <Avatar className="size-10 rounded-full border border-border/50">
                                              {m.githubAvatarUrl && <AvatarImage src={m.githubAvatarUrl} alt={m.displayName} />}
                                              <AvatarFallback className="text-[12px] font-bold bg-muted text-foreground">{initials(m.displayName)}</AvatarFallback>
                                            </Avatar>
                                            <span className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-background ${STATUS_DOT[m.status] || STATUS_DOT.active}`} />
                                          </div>
                                          <div className="flex flex-col min-w-0">
                                            <span className="text-[13.5px] font-semibold text-foreground truncate leading-tight">{m.displayName}</span>
                                            <span className="text-[12px] text-muted-foreground truncate">{m.githubUsername ? `@${m.githubUsername}` : "No GitHub"}</span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {getAccessTags(m.role as Role).map(tag => (
                                            <span key={tag} className={`${TAG_STYLE} ${ROLE_BADGE_STYLE[m.role as Role]}`}>{tag}</span>
                                          ))}
                                        </div>
                                        <span className="text-[13px] text-muted-foreground">{timeAgo(m._creationTime)}</span>
                                        <span className="text-[13px] text-muted-foreground">{formatDate(m.joinedAt)}</span>
                                        <div onClick={e => e.stopPropagation()}>
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <button className="size-8 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted/30 transition-all">
                                                <MoreHorizontal className="size-4" />
                                              </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-[160px]">
                                              <DropdownMenuItem onClick={() => router.push(`/dashboard/members/${m._id}`)}>View Profile</DropdownMenuItem>
                                              <DropdownMenuItem>Change Role</DropdownMenuItem>
                                              <DropdownMenuItem className="text-red-500">Deactivate</DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {totalCount === 0 && (
                          <div className="text-center py-20 text-[13px] text-muted-foreground">
                            <Users className="size-8 mx-auto mb-3 opacity-20" />
                            <p className="font-medium">No members yet</p>
                            <p className="mt-1">Members are synced from your GitHub organization.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ═══════ PANEL 2: ROLES & PERMISSIONS ═══════ */}
                    <div className="w-full shrink-0">
                      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8 items-start">

                        {/* Left: Role Navigation */}
                        <div className="flex flex-col gap-1.5 sticky top-6">
                          {(["owner", "admin", "member", "viewer"] as Role[]).map(role => (
                            <button
                              key={role}
                              onClick={() => setSelectedRoleTab(role)}
                              className={`flex items-center justify-between text-left px-4 py-3 rounded-[10px] text-[13px] font-semibold transition-all duration-200 border ${
                                selectedRoleTab === role
                                  ? "bg-background border-border/80 text-foreground"
                                  : "bg-transparent border-transparent text-muted-foreground hover:bg-border/30 hover:text-foreground"
                              }`}
                            >
                              {ROLE_LABELS[role]}
                              {role === "owner" && <ShieldCheck className="size-3.5 opacity-50" />}
                            </button>
                          ))}
                        </div>

                        {/* Right: Template Configuration */}
                        <div className="border border-border/60 rounded-[12px] bg-background overflow-hidden">
                          <div className="p-6 border-b border-border/40 bg-muted/5">
                            <div className="flex items-center gap-3 mb-2">
                              <Settings2 className="size-5 text-muted-foreground" />
                              <h2 className="text-[18px] font-semibold text-foreground tracking-tight">{ROLE_LABELS[selectedRoleTab]} Template</h2>
                            </div>
                            <p className="text-[13.5px] text-muted-foreground leading-relaxed">{ROLE_DESCRIPTIONS[selectedRoleTab]}</p>
                          </div>

                          <div className="p-0">
                            <div className="px-6 py-5 border-b border-border/40 bg-background">
                              <h3 className="text-[11.5px] font-bold text-muted-foreground uppercase tracking-wider mb-4">Feature Access</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {sectionMeta.map(s => (
                                  <div key={s.key} className="flex items-start justify-between gap-4 p-3.5 rounded-xl border border-border/60 bg-muted/10">
                                    <div className="flex flex-col">
                                      <span className="text-[13.5px] font-semibold text-foreground">{s.label}</span>
                                      <span className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed pr-2">{s.description}</span>
                                    </div>
                                    <Switch
                                      checked={activeTemplate.sections[s.key]}
                                      disabled={selectedRoleTab === "owner"}
                                      onCheckedChange={(c) => updateRoleTemplate(selectedRoleTab, { sections: { ...activeTemplate.sections, [s.key]: c } })}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="px-6 py-5 bg-background">
                              <h3 className="text-[11.5px] font-bold text-muted-foreground uppercase tracking-wider mb-4">Administrative Rights</h3>
                              <div className="space-y-3">
                                {adminPerms.map(s => (
                                  <div key={s.key} className="flex items-center justify-between p-3.5 rounded-xl border border-border/60 bg-muted/10">
                                    <div className="flex flex-col">
                                      <span className="text-[13.5px] font-semibold text-foreground">{s.label}</span>
                                      <span className="text-[11.5px] text-muted-foreground mt-0.5">{s.desc}</span>
                                    </div>
                                    <Switch
                                      checked={Boolean((activeTemplate as any)[s.key])}
                                      disabled={selectedRoleTab === "owner"}
                                      onCheckedChange={(c) => updateRoleTemplate(selectedRoleTab, { [s.key]: c })}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

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

