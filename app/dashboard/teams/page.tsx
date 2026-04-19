"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  MoreHorizontal, Plus, ListFilter, SlidersHorizontal, Users,
  Package, Layers, Headset, HardDrive, Palette, Car, Code2,
  Globe, Shield, Zap, Bug, Rocket, Database, Cpu, Wifi,
  Smartphone, Monitor, Lock, Settings, Star, Heart,
  FileCode2, GitPullRequest, CircleDashed
} from "lucide-react"

// Icon picker options
const TEAM_ICONS: { icon: any; name: string; color: string }[] = [
  { icon: Code2, name: "Code2", color: "text-blue-500" },
  { icon: Layers, name: "Layers", color: "text-pink-500" },
  { icon: HardDrive, name: "HardDrive", color: "text-yellow-600" },
  { icon: Palette, name: "Palette", color: "text-orange-500" },
  { icon: Car, name: "Car", color: "text-indigo-500" },
  { icon: Headset, name: "Headset", color: "text-cyan-500" },
  { icon: Globe, name: "Globe", color: "text-emerald-500" },
  { icon: Shield, name: "Shield", color: "text-red-500" },
  { icon: Zap, name: "Zap", color: "text-yellow-500" },
  { icon: Bug, name: "Bug", color: "text-rose-500" },
  { icon: Rocket, name: "Rocket", color: "text-purple-500" },
  { icon: Database, name: "Database", color: "text-amber-600" },
  { icon: Cpu, name: "Cpu", color: "text-slate-500" },
  { icon: Wifi, name: "Wifi", color: "text-sky-500" },
  { icon: Smartphone, name: "Smartphone", color: "text-violet-500" },
  { icon: Monitor, name: "Monitor", color: "text-teal-500" },
  { icon: Lock, name: "Lock", color: "text-stone-500" },
  { icon: Settings, name: "Settings", color: "text-zinc-500" },
  { icon: Star, name: "Star", color: "text-yellow-500" },
  { icon: Heart, name: "Heart", color: "text-pink-500" },
]

function getIconByName(name: string | undefined) {
  const found = TEAM_ICONS.find(i => i.name === name)
  return found || TEAM_ICONS[0]
}

function getInitials(name: string) {
  return name.split(/[\s._-]+/).map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

export default function TeamsPage() {
  const router = useRouter()
  const { organization, isLoading: orgLoading } = useOrganization()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [newIdentifier, setNewIdentifier] = React.useState("")
  const [newDescription, setNewDescription] = React.useState("")
  const [newIcon, setNewIcon] = React.useState("Code2")
  const [isCreating, setIsCreating] = React.useState(false)

  const teams = useQuery(
    api.teams.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )

  const createTeam = useMutation(api.teams.create)

  const handleCreate = async () => {
    if (!organization || !newName.trim() || !newIdentifier.trim()) return
    setIsCreating(true)
    try {
      const iconMeta = getIconByName(newIcon)
      await createTeam({
        orgId: organization._id,
        name: newName.trim(),
        identifier: newIdentifier.trim(),
        description: newDescription.trim() || undefined,
        icon: newIcon,
        color: iconMeta.color,
      })
      toast.success(`Team "${newName.trim()}" created`)
      setCreateOpen(false)
      setNewName("")
      setNewIdentifier("")
      setNewDescription("")
      setNewIcon("Code2")
    } catch {
      toast.error("Failed to create team")
    } finally {
      setIsCreating(false)
    }
  }

  // Auto-generate identifier from name
  React.useEffect(() => {
    if (newName) {
      const id = newName
        .replace(/[^a-zA-Z\s]/g, "")
        .split(/\s+/)
        .map(w => w.substring(0, 3))
        .join("")
        .toUpperCase()
        .slice(0, 5)
      setNewIdentifier(id)
    }
  }, [newName])

  const isLoading = orgLoading || (organization !== null && teams === undefined)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex w-full flex-col overflow-hidden text-sm bg-background">
          
          {/* Header */}
          <div className="h-14 flex items-center justify-between px-5 border-b shrink-0 bg-background z-10 transition-all">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="-ml-2" />
              <div className="flex items-center gap-2 font-[600] text-[14px] text-foreground tracking-tight">
                Teams {teams && <span className="bg-muted/70 px-1.5 py-0.5 rounded-md text-[11px] font-medium text-muted-foreground tabular-nums tracking-wide">{teams.length}</span>}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px] font-normal shadow-none border-border/60 hover:bg-muted/40 transition-colors">
                  <Plus className="size-3.5" /> Add team
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-4">
                  <DialogTitle className="text-[16px] font-semibold tracking-tight">Create Team</DialogTitle>
                </DialogHeader>
                <div className="px-6 pb-6 flex flex-col gap-4">
                  {/* Icon Picker */}
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-2 block">Icon</label>
                    <div className="grid grid-cols-10 gap-1.5">
                      {TEAM_ICONS.map((item) => {
                        const IconComp = item.icon
                        return (
                          <button
                            key={item.name}
                            onClick={() => setNewIcon(item.name)}
                            className={`size-8 flex items-center justify-center rounded-lg border transition-all ${
                              newIcon === item.name
                                ? "border-[#5e6ad2] bg-[#5e6ad2]/10 ring-1 ring-[#5e6ad2]/30"
                                : "border-border/40 hover:bg-muted/40 hover:border-border/60"
                            }`}
                          >
                            <IconComp className={`size-4 ${item.color}`} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {/* Name */}
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Team Name</label>
                    <Input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Frontend, Backend, Design"
                      className="h-9 text-[13px]"
                    />
                  </div>
                  {/* Identifier */}
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Identifier</label>
                    <Input
                      value={newIdentifier}
                      onChange={e => setNewIdentifier(e.target.value.toUpperCase())}
                      placeholder="e.g. FRN"
                      className="h-9 text-[13px] font-mono uppercase tracking-widest"
                      maxLength={5}
                    />
                  </div>
                  {/* Description */}
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Description <span className="text-muted-foreground/50">(optional)</span></label>
                    <Input
                      value={newDescription}
                      onChange={e => setNewDescription(e.target.value)}
                      placeholder="Brief team description..."
                      className="h-9 text-[13px]"
                    />
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={!newName.trim() || !newIdentifier.trim() || isCreating}
                    className="w-full h-9 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium rounded-lg shadow-none mt-2"
                  >
                    {isCreating ? "Creating..." : "Create Team"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Sub-header / Filters */}
          <div className="h-12 flex items-center justify-between px-5 border-b shrink-0 bg-background text-sm">
            <Button variant="ghost" size="sm" className="h-7 gap-2 text-muted-foreground -ml-2 transition-colors hover:text-foreground text-[13px] font-normal">
              <ListFilter className="size-4" strokeWidth={2} /> Filter
            </Button>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px] font-normal border-border/80 shadow-none transition-colors hover:bg-muted/50 rounded-md">
              <SlidersHorizontal className="size-3.5" /> Display
            </Button>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-y-auto w-full">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              </div>
            ) : !teams || teams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Users className="size-8 mb-3 opacity-30" />
                <p className="text-[14px] font-medium">No teams yet</p>
                <p className="text-[12px] mt-1 opacity-70">Create a team to organize work and responsibility</p>
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-3.5" /> Create your first team
                </Button>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/40 text-[13px] text-muted-foreground bg-background sticky top-0 z-10">
                    <th className="font-medium px-5 py-3 pb-3">Name</th>
                    <th className="font-medium px-4 py-3 pb-3 w-[140px]">Members</th>
                    <th className="font-medium px-4 py-3 pb-3 w-[120px]">Issues</th>
                    <th className="font-medium px-4 py-3 pb-3 w-[120px]">Pull Requests</th>
                  </tr>
                </thead>
                <tbody className="bg-background">
                  {teams.map((team) => {
                    const iconMeta = getIconByName(team.icon)
                    const TeamIcon = iconMeta.icon
                    return (
                      <tr
                        key={team._id}
                        onClick={() => router.push(`/dashboard/teams/${team._id}`)}
                        className="border-b border-border/40 even:bg-muted/20 hover:bg-muted/30 transition-colors group cursor-pointer"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <TeamIcon className={`size-[18px] shrink-0 ${iconMeta.color}`} strokeWidth={2} />
                            <span className="font-medium text-[14.5px] text-foreground tracking-tight">{team.name}</span>
                            <span className="text-[13px] font-medium text-muted-foreground/60 uppercase tracking-widest pl-1">{team.identifier}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          {team.members.length > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="flex -space-x-2">
                                {team.members.slice(0, 3).map((m: any, i: number) => (
                                  <Avatar key={i} className="size-[22px] ring-2 ring-background border">
                                    <AvatarFallback className="text-[8px] font-bold bg-muted/60 text-muted-foreground">{getInitials(m.displayName)}</AvatarFallback>
                                  </Avatar>
                                ))}
                              </div>
                              <span className="text-[12px] text-muted-foreground/60 tabular-nums">{team.memberCount}</span>
                            </div>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/30 hover:text-muted-foreground -ml-1">
                              <Users className="size-[15px]" />
                            </Button>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                            <CircleDashed className="size-4 text-muted-foreground/50" strokeWidth={2} />
                            <span className="tabular-nums opacity-80">{team.openIssueCount}</span>
                            <span className="text-muted-foreground/40 text-[11px] font-normal">/ {team.issueCount}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                            <GitPullRequest className="size-4 text-muted-foreground/50" strokeWidth={2} />
                            <span className="tabular-nums opacity-80">{team.prCount}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
