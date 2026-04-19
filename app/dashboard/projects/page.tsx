"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { fetchInstallationRepos } from "@/lib/github/actions"
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
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"
import { 
  FolderKanban, Plus, MoreHorizontal, ListFilter, SlidersHorizontal, 
  CircleDashed, Clock, GitFork, Check, Calendar as CalendarIcon
} from "lucide-react"

const statusStyles: Record<string, { label: string, color: string, bg: string, border: string }> = {
  "planned": { label: "Planned", color: "text-muted-foreground", bg: "bg-muted/40", border: "border-border/40" },
  "in_progress": { label: "In progress", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  "paused": { label: "Paused", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  "completed": { label: "Completed", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  "cancelled": { label: "Cancelled", color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
}

export default function ProjectsPage() {
  const router = useRouter()
  const { organization } = useOrganization()
  const projects = useQuery(api.projects.listByOrg, organization ? { orgId: organization._id } : "skip")

  const createProject = useMutation(api.projects.create)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [newDescription, setNewDescription] = React.useState("")
  const [newTargetDate, setNewTargetDate] = React.useState<Date | undefined>()
  const [isCreating, setIsCreating] = React.useState(false)

  // Repo picker state
  const [availableRepos, setAvailableRepos] = React.useState<{ fullName: string; name: string; owner: string }[]>([])
  const [selectedRepos, setSelectedRepos] = React.useState<string[]>([])
  const [loadingRepos, setLoadingRepos] = React.useState(false)

  // Fetch repos when dialog opens
  React.useEffect(() => {
    if (createOpen && organization && availableRepos.length === 0) {
      setLoadingRepos(true)
      fetchInstallationRepos(organization.githubInstallationId)
        .then(setAvailableRepos)
        .catch(console.error)
        .finally(() => setLoadingRepos(false))
    }
  }, [createOpen, organization])

  const handleCreate = async () => {
    if (!newName.trim() || !organization) return
    setIsCreating(true)
    try {
      const projectId = await createProject({
        orgId: organization._id,
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        startDate: Date.now(), // Auto-set to the day of creation
        targetDate: newTargetDate ? newTargetDate.getTime() : undefined,
        githubRepoFullNames: selectedRepos.length > 0 ? selectedRepos : undefined,
      })
      toast.success("Project created")
      setCreateOpen(false)
      setNewName("")
      setNewDescription("")
      setNewTargetDate(undefined)
      setSelectedRepos([])
      router.push(`/dashboard/projects/${projectId}`)
    } catch (err) {
      toast.error("Failed to create project")
      console.error(err)
    } finally {
      setIsCreating(false)
    }
  }

  const toggleRepo = (fullName: string) => {
    setSelectedRepos((prev) =>
      prev.includes(fullName)
        ? prev.filter((r) => r !== fullName)
        : [...prev, fullName]
    )
  }

  const isLoading = projects === undefined

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
                Projects {projects && <span className="bg-muted/70 px-1.5 py-0.5 rounded-md text-[11px] font-medium text-muted-foreground tabular-nums tracking-wide">{projects.length}</span>}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px] font-normal shadow-none border-border/60 hover:bg-muted/40 transition-colors">
                  <Plus className="size-3.5" /> Add project
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-4">
                  <DialogTitle className="text-[16px] font-semibold tracking-tight">Create Project</DialogTitle>
                </DialogHeader>
                <div className="px-6 pb-6 flex flex-col gap-4">
                  {/* Name */}
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Project Name</label>
                    <Input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Platform Redesign, API V2"
                      className="h-9 text-[13px]"
                    />
                  </div>
                  {/* Description */}
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Description <span className="text-muted-foreground/50">(optional)</span></label>
                    <Input
                      value={newDescription}
                      onChange={e => setNewDescription(e.target.value)}
                      placeholder="Brief project description..."
                      className="h-9 text-[13px]"
                    />
                  </div>
                  {/* Target Date */}
                  <div className="flex flex-col">
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Target Date <span className="text-muted-foreground/50">(optional)</span></label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={"outline"}
                          className={`w-full justify-start text-left font-normal h-9 text-[13px] shadow-none ${!newTargetDate ? "text-muted-foreground" : "text-foreground"}`}
                        >
                          <CalendarIcon className="mr-2 size-3.5 opacity-70" />
                          {newTargetDate ? format(newTargetDate, "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-[100]" align="start">
                        <Calendar
                          mode="single"
                          selected={newTargetDate}
                          onSelect={setNewTargetDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  {/* Repo Picker */}
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                      <GitFork className="size-3.5" /> Link GitHub Repositories <span className="text-muted-foreground/50">(optional)</span>
                    </label>
                    <div className="border border-border/60 rounded-lg max-h-[160px] overflow-y-auto [&::-webkit-scrollbar]:hidden">
                      {loadingRepos ? (
                        <div className="flex items-center justify-center py-6">
                          <span className="size-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                        </div>
                      ) : availableRepos.length === 0 ? (
                        <div className="text-center text-[12px] text-muted-foreground py-4">No repos found for this installation.</div>
                      ) : (
                        availableRepos.map((repo) => {
                          const isSelected = selectedRepos.includes(repo.fullName)
                          return (
                            <button
                              key={repo.fullName}
                              onClick={() => toggleRepo(repo.fullName)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors border-b border-border/20 last:border-b-0 ${isSelected ? "bg-[#5e6ad2]/5" : ""}`}
                            >
                              <div className={`size-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-[#5e6ad2] border-[#5e6ad2] text-white" : "border-border/80"}`}>
                                {isSelected && <Check className="size-3" strokeWidth={3} />}
                              </div>
                              <GitFork className="size-3.5 text-muted-foreground shrink-0" />
                              <span className="text-[13px] font-medium text-foreground truncate">{repo.fullName}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                    {selectedRepos.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-2 font-medium">
                        {selectedRepos.length} repo{selectedRepos.length !== 1 ? "s" : ""} selected — existing issues & PRs in these repos will be auto-linked.
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={!newName.trim() || isCreating}
                    className="w-full h-9 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white font-medium rounded-lg shadow-none mt-2"
                  >
                    {isCreating ? "Creating..." : "Create Project"}
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
            ) : !projects || projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <FolderKanban className="size-8 mb-3 opacity-30" />
                <p className="text-[14px] font-medium">No projects yet</p>
                <p className="text-[12px] mt-1 opacity-70">Create a project to organize complex workflows</p>
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-3.5" /> Create your first project
                </Button>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/40 text-[13px] text-muted-foreground bg-background sticky top-0 z-10">
                    <th className="font-medium px-5 py-3 pb-3">Project</th>
                    <th className="font-medium px-4 py-3 pb-3 w-[160px]">Status</th>
                    <th className="font-medium px-4 py-3 pb-3 w-[160px]">Repos</th>
                    <th className="font-medium px-4 py-3 pb-3 w-[160px]">Due Date</th>
                  </tr>
                </thead>
                <tbody className="bg-background relative">
                  {projects.map((proj) => {
                    const st = statusStyles[proj.status] || statusStyles["planned"]
                    return (
                      <tr
                        key={proj._id}
                        onClick={() => router.push(`/dashboard/projects/${proj._id}`)}
                        className="border-b border-border/40 even:bg-muted/20 hover:bg-muted/30 transition-colors group cursor-pointer"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-lg border border-border/60 bg-muted/30 flex items-center justify-center shrink-0">
                              <FolderKanban className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[13px] font-medium text-foreground">{proj.name}</span>
                              {proj.description && (
                                <span className="text-[12px] text-muted-foreground truncate max-w-[300px] mt-0.5">{proj.description}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${st.bg} ${st.color} ${st.border}`}>
                            <span className="size-1.5 rounded-full bg-current opacity-80" /> {st.label}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                            <GitFork className="size-3.5 opacity-70" />
                            {proj.githubRepoFullNames?.length || 0} repo{(proj.githubRepoFullNames?.length || 0) !== 1 ? "s" : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                            <Clock className="size-3.5 opacity-70" />
                            {proj.targetDate
                              ? new Date(proj.targetDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : "No date set"}
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
