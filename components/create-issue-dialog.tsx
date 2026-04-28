"use client"

import * as React from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"
import { createGitHubIssue, fetchInstallationRepos } from "@/lib/github/actions"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Maximize2, X, Zap, CircleDashed, User, Tag, MoreHorizontal, Paperclip, Check, Circle, CheckCircle2, XCircle, LayoutGrid, ChevronRight, SignalMedium, SignalHigh, SignalLow, CircleDot, Milestone, AlertCircle, GitBranch, Users,
  Code2, Layers, Headset, HardDrive, Palette, Car, Globe, Shield, Bug, Rocket, Database, Cpu, Wifi, Smartphone, Monitor, Lock, Settings, Star, Heart, KanbanSquare, Mic, RefreshCw, Link2
} from "lucide-react"

// Team icon registry — must match the icons in teams/page.tsx
const TEAM_ICON_MAP: Record<string, { icon: any; color: string }> = {
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
  return TEAM_ICON_MAP[name || "Code2"] || TEAM_ICON_MAP.Code2
}

type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled"
type IssuePriority = "urgent" | "high" | "medium" | "low" | "none"

type PendingAttachment = {
  storageId: string
  fileName: string
  contentType?: string
  size?: number
  previewUrl?: string
}

type PendingIssueLink = {
  id: string
  label?: string
  url: string
}

const statusOptions: { value: IssueStatus; label: string; icon: any; color: string }[] = [
  { value: "todo", label: "Open issue", icon: CircleDot, color: "text-green-500" },
  { value: "in_progress", label: "In Progress", icon: CircleDot, color: "text-yellow-500" },
  { value: "done", label: "Closed as completed", icon: CheckCircle2, color: "text-purple-500" },
  { value: "cancelled", label: "Closed as not planned", icon: XCircle, color: "text-muted-foreground" },
]

const priorityOptions: { value: IssuePriority; label: string; icon: any; color: string }[] = [
  { value: "none", label: "No priority", icon: CircleDashed, color: "text-muted-foreground" },
  { value: "low", label: "Low", icon: SignalLow, color: "text-muted-foreground" },
  { value: "medium", label: "Medium", icon: SignalMedium, color: "text-orange-500" },
  { value: "high", label: "High", icon: SignalHigh, color: "text-orange-500" },
  { value: "urgent", label: "Urgent", icon: AlertCircle, color: "text-red-500" },
]

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
}

export function CreateIssueDialog({
  children,
  defaultProjectId,
}: {
  children: React.ReactNode
  defaultProjectId?: string
}) {
  const [open, setOpen] = React.useState(false)
  const { organization } = useOrganization()

  // Form state
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [status, setStatus] = React.useState<IssueStatus>("todo")
  const [priority, setPriority] = React.useState<IssuePriority>("none")
  const [selectedAssigneeIds, setSelectedAssigneeIds] = React.useState<string[]>([])
  const [selectedLabelIds, setSelectedLabelIds] = React.useState<string[]>([])
  const [selectedRepoFullName, setSelectedRepoFullName] = React.useState<string | undefined>()
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | undefined>()
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | undefined>(defaultProjectId)
  const [createMore, setCreateMore] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [pendingAttachments, setPendingAttachments] = React.useState<PendingAttachment[]>([])
  const [pendingLinks, setPendingLinks] = React.useState<PendingIssueLink[]>([])
  const [linkLabel, setLinkLabel] = React.useState("")
  const [linkUrl, setLinkUrl] = React.useState("")
  const [isUploadingAttachment, setIsUploadingAttachment] = React.useState(false)
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null)
  const pendingAttachmentsRef = React.useRef<PendingAttachment[]>([])

  // Voice Recording state
  const [isRecording, setIsRecording] = React.useState(false)
  const [isTranscribing, setIsTranscribing] = React.useState(false)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const audioChunksRef = React.useRef<Blob[]>([])

  // Queries
  const members = useQuery(
    api.members.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )
  const projects = useQuery(
    api.projects.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )
  const labels = useQuery(
    api.labels.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )
  const teams = useQuery(
    api.teams.listByOrg,
    organization ? { orgId: organization._id } : "skip"
  )
  const installations = useQuery(api.github.getMyInstallations)

  // Repos state (fetched via server action)
  const [repos, setRepos] = React.useState<{ fullName: string; name: string; owner: string }[]>([])
  const [reposLoading, setReposLoading] = React.useState(false)

  // Get the installation ID — prefer from org, fallback to githubInstallations table
  const installationId = organization?.githubInstallationId
    ?? (installations && installations.length > 0 ? installations[0].installationId : null)

  React.useEffect(() => {
    if (open && installationId && repos.length === 0) {
      setReposLoading(true)
      fetchInstallationRepos(installationId)
        .then((r) => setRepos(r))
        .catch((err) => console.error("Failed to fetch repos:", err))
        .finally(() => setReposLoading(false))
    }
  }, [open, installationId])

  const createIssue = useMutation(api.issues.create)
  const linkToGitHub = useMutation(api.issues.linkToGitHub)
  const generateFileUploadUrl = useMutation(api.issues.generateFileUploadUrl)

  const revokeAttachmentPreviews = React.useCallback((attachments: PendingAttachment[]) => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
  }, [])

  const resetForm = () => {
    revokeAttachmentPreviews(pendingAttachments)
    setTitle("")
    setBody("")
    setStatus("todo")
    setPriority("none")
    setSelectedAssigneeIds([])
    setSelectedLabelIds([])
    setSelectedRepoFullName(undefined)
    setSelectedTeamId(undefined)
    setSelectedProjectId(defaultProjectId)
    setPendingAttachments([])
    setPendingLinks([])
    setLinkLabel("")
    setLinkUrl("")
  }

  React.useEffect(() => {
    if (!open) return
    setSelectedProjectId((current) => current ?? defaultProjectId)
  }, [open, defaultProjectId])

  React.useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments
  }, [pendingAttachments])

  React.useEffect(() => {
    return () => {
      revokeAttachmentPreviews(pendingAttachmentsRef.current)
    }
  }, [revokeAttachmentPreviews])

  const toggleAssignee = React.useCallback((memberId: string) => {
    setSelectedAssigneeIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    )
  }, [])

  const handleAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    setIsUploadingAttachment(true)
    try {
      const uploaded: PendingAttachment[] = []
      for (const file of files) {
        const uploadUrl = await generateFileUploadUrl({})
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        })

        if (!response.ok) throw new Error("Upload failed")
        const { storageId } = await response.json()

        uploaded.push({
          storageId,
          fileName: file.name,
          contentType: file.type || undefined,
          size: file.size,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        })
      }

      setPendingAttachments((current) => [...current, ...uploaded])
    } catch {
      toast.error("Failed to upload file")
    } finally {
      setIsUploadingAttachment(false)
      if (event.target) event.target.value = ""
    }
  }

  const removePendingAttachment = (storageId: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => {
        if (attachment.storageId === storageId && attachment.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(attachment.previewUrl)
        }
        return attachment.storageId !== storageId
      })
    )
  }

  const handleAddLink = () => {
    const rawUrl = linkUrl.trim()
    if (!rawUrl) return

    let normalizedUrl = rawUrl
    try {
      normalizedUrl = new URL(rawUrl).toString()
    } catch {
      try {
        normalizedUrl = new URL(`https://${rawUrl}`).toString()
      } catch {
        toast.error("Enter a valid URL")
        return
      }
    }

    setPendingLinks((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        label: linkLabel.trim() || undefined,
        url: normalizedUrl,
      },
    ])
    setLinkLabel("")
    setLinkUrl("")
  }

  const removePendingLink = (linkId: string) => {
    setPendingLinks((current) => current.filter((link) => link.id !== linkId))
  }

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop()
        setIsRecording(false)
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        mediaRecorderRef.current = mediaRecorder
        audioChunksRef.current = []

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data)
        }

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          stream.getTracks().forEach(t => t.stop())
          
          setIsTranscribing(true)
          try {
            const formData = new FormData()
            formData.append("audio", audioBlob, "recording.webm")
            
            const res = await fetch("/api/transcribe", {
              method: "POST",
              body: formData
            })

            if (!res.ok) {
              const errText = await res.text()
              throw new Error(errText)
            }

            const data = await res.json()
            if (data.title) setTitle(data.title)
            if (data.description) setBody(data.description)
            toast.success("Voice transcribed successfully!")
          } catch (err: any) {
            console.error("Transcription failed:", err)
            toast.error("Failed to transcribe audio.")
          } finally {
            setIsTranscribing(false)
          }
        }

        mediaRecorder.start()
        setIsRecording(true)
      } catch (err) {
        console.error("Microphone error:", err)
        toast.error("Could not access microphone.")
      }
    }
  }

  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      const target = e.currentTarget;
      const start = target.selectionStart;
      const val = target.value;
      const beforeCursor = val.substring(0, start);
      const currentLine = beforeCursor.split('\n').pop() || "";
      
      const bulletMatch = currentLine.match(/^(\s*)([-*+])\s/);
      const numberMatch = currentLine.match(/^(\s*)(\d+)\.\s/);
      
      if (bulletMatch) {
        // If empty bullet, delete it and break line
        if (currentLine === `${bulletMatch[1]}${bulletMatch[2]} `) {
          e.preventDefault();
          setBody(val.substring(0, start - currentLine.length) + '\n' + val.substring(start));
          setTimeout(() => { target.selectionStart = target.selectionEnd = start - currentLine.length + 1; }, 0);
        } else {
          e.preventDefault();
          const prefix = `\n${bulletMatch[1]}${bulletMatch[2]} `;
          setBody(val.substring(0, start) + prefix + val.substring(start));
          setTimeout(() => { target.selectionStart = target.selectionEnd = start + prefix.length; }, 0);
        }
      } else if (numberMatch) {
        // If empty number, delete it and break line
        if (currentLine === `${numberMatch[1]}${numberMatch[2]}. `) {
          e.preventDefault();
          setBody(val.substring(0, start - currentLine.length) + '\n' + val.substring(start));
          setTimeout(() => { target.selectionStart = target.selectionEnd = start - currentLine.length + 1; }, 0);
        } else {
          e.preventDefault();
          const nextNum = parseInt(numberMatch[2], 10) + 1;
          const prefix = `\n${numberMatch[1]}${nextNum}. `;
          setBody(val.substring(0, start) + prefix + val.substring(start));
          setTimeout(() => { target.selectionStart = target.selectionEnd = start + prefix.length; }, 0);
        }
      }
    }
  }

  const handleSubmit = async () => {
    if (!title.trim() || !organization) return
    setIsSubmitting(true)

    try {
      const result = await createIssue({
        orgId: organization._id,
        title: title.trim(),
        body: body.trim() || undefined,
        status,
        priority,
        assigneeIds:
          selectedAssigneeIds.length > 0 ? (selectedAssigneeIds as any) : undefined,
        labelIds: selectedLabelIds.length > 0 ? selectedLabelIds as any : undefined,
        teamId: selectedTeamId as any,
        projectId: selectedProjectId as any,
        githubRepoFullName: selectedRepoFullName,
        links: pendingLinks.map((link) => ({
          label: link.label,
          url: link.url,
        })),
        files: pendingAttachments.map((attachment) => ({
          storageId: attachment.storageId as any,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          size: attachment.size,
        })),
      })

      // If repo selected, also create on GitHub
      if (selectedRepoFullName && installationId) {
        try {
          const labelNames = labels
            ?.filter((l) => selectedLabelIds.includes(l._id))
            .map((l) => l.name)
          const assigneeUsernames = selectedAssignees
            .map((assignee) => assignee.githubUsername)
            .filter((username): username is string => !!username)

          const ghResult = await createGitHubIssue(
            installationId,
            selectedRepoFullName,
            title.trim(),
            body.trim() || undefined,
            labelNames,
            assigneeUsernames
          )

          await linkToGitHub({
            issueId: result.issueId,
            githubIssueNumber: ghResult.number,
            githubIssueId: ghResult.id,
            githubUrl: ghResult.url,
            githubRepoFullName: selectedRepoFullName,
          })
        } catch (ghError) {
          console.error("Failed to create GitHub issue:", ghError)
          // Issue is still created in Convex, just not synced
        }
      }

      toast.success(`Issue ${result.identifier} created`)

      if (createMore) {
        resetForm()
      } else {
        resetForm()
        setOpen(false)
      }
    } catch (error) {
      console.error("Failed to create issue:", error)
      toast.error("Failed to create issue")
    } finally {
      setIsSubmitting(false)
    }
  }

  const currentStatus = statusOptions.find((s) => s.value === status) || statusOptions[0]
  const currentPriority = priorityOptions.find((p) => p.value === priority) || priorityOptions[0]
  const selectedAssignees =
    members?.filter((m) => selectedAssigneeIds.includes(m._id)) || []
  const selectedTeam = teams?.find((t) => t._id === selectedTeamId)

  const labelColorMap: Record<string, string> = {
    "#ef4444": "bg-red-500",
    "#3b82f6": "bg-blue-500",
    "#f97316": "bg-orange-500",
    "#a855f7": "bg-purple-500",
    "#eab308": "bg-yellow-500",
    "#06b6d4": "bg-cyan-500",
    "#22c55e": "bg-green-500",
    "#ec4899": "bg-pink-500",
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[780px] p-0 overflow-hidden border-border/40 shadow-xl bg-background rounded-xl [&>button]:hidden">
        
        {/* Dynamic header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/10">
          <div className="flex items-center gap-2">
            <div className="flex items-center px-1.5 py-0.5 rounded-md border border-border/50 text-[11px] font-medium text-muted-foreground bg-muted/20">
              <LayoutGrid className="size-3 mr-1 text-blue-500/80" /> {organization?.slug?.toUpperCase().slice(0, 3) || "ORG"}
            </div>
            <ChevronRight className="size-3 text-muted-foreground/50" />
            <span className="text-[12px] font-medium text-foreground/80">New issue</span>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Maximize2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Input Bodies */}
        <div className="px-6 pt-5 pb-2 relative">
          
          {/* Magic Mic */}
          <div className="absolute right-6 top-5 z-20">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={toggleRecording}
                    disabled={isTranscribing}
                    className={`h-7 w-7 rounded-full transition-all ${isRecording ? "bg-red-500/10 text-red-500 border-red-500/30 animate-pulse border-2 shadow-none" : "bg-transparent text-muted-foreground hover:bg-muted/50 border-transparent hover:border-border/60 shadow-none hover:text-foreground"}`}
                  >
                    {isTranscribing ? <RefreshCw className="size-3.5 animate-spin text-[#5e6ad2]" /> : <Mic className="size-[13px]" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {isTranscribing ? "Processing transcription via Groq..." : isRecording ? "Stop recording & AI rewrite" : "Dictate using AI"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <input 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isTranscribing}
            placeholder="Issue title" 
            className="w-full bg-transparent border-none outline-none focus:ring-0 text-xl font-semibold mb-3 placeholder:text-muted-foreground/50 text-foreground pr-10"
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault() }}
          />
          <textarea 
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleBodyKeyDown}
            disabled={isTranscribing}
            placeholder="Add description..." 
            className="w-full bg-transparent border-none outline-none focus:ring-0 text-[13px] resize-none min-h-[220px] placeholder:text-muted-foreground/60 text-foreground leading-relaxed [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 disabled:opacity-50"
          />
        </div>

        {/* Metric Attribute Pills Row */}
        <div className="px-6 flex items-center flex-wrap gap-2 pb-6">
          
          {/* Status Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 text-[11.5px] font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background">
                <currentStatus.icon className={`size-3.5 ${currentStatus.color}`} /> {currentStatus.label}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px] p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground mb-1">
                <span>Change status...</span>
                <span className="text-[10px] bg-muted/60 px-1 py-0.5 rounded text-foreground">S</span>
              </div>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              {statusOptions.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={() => setStatus(opt.value)} className="py-1.5 px-2 flex items-center justify-between cursor-pointer focus:bg-muted/60 text-[12px]">
                  <div className="flex items-center gap-2"><opt.icon className={`size-3.5 ${opt.color}`} /> {opt.label}</div>
                  {status === opt.value && <Check className="size-3 text-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Priority Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 text-[11.5px] font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background">
                <currentPriority.icon className={`size-3.5 ${currentPriority.color}`} /> {currentPriority.label}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[150px] p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground mb-1">
                <span>Set priority...</span>
                <span className="text-[10px] bg-muted/60 px-1 py-0.5 rounded text-foreground">P</span>
              </div>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              {priorityOptions.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={() => setPriority(opt.value)} className="py-1.5 px-2 flex items-center justify-between cursor-pointer focus:bg-muted/60 text-[12px]">
                  <div className="flex items-center gap-2"><opt.icon className={`size-3.5 ${opt.color}`} /> {opt.label}</div>
                  {priority === opt.value && <Check className="size-3 text-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assignee Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 text-[11.5px] font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background">
                {selectedAssignees.length > 0 ? (
                  <>
                    <div className="flex items-center">
                      {selectedAssignees.slice(0, 2).map((assignee, index) => (
                        <Avatar
                          key={assignee._id}
                          className={`size-[16px] border border-background ${index > 0 ? "-ml-1.5" : ""}`}
                        >
                          <AvatarFallback className="text-[7px] font-bold bg-orange-500/10 text-orange-600">
                            {getInitials(assignee.displayName)}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                    {selectedAssignees.length === 1
                      ? selectedAssignees[0].displayName
                      : `${selectedAssignees.length} assignees`}
                  </>
                ) : (
                  <><User className="size-3.5 text-muted-foreground" /> Assignees</>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px] p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground mb-1">
                <span>Assign to...</span>
                <span className="text-[10px] bg-muted/60 px-1 py-0.5 rounded text-foreground">A</span>
              </div>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setSelectedAssigneeIds([])
                }}
                className="py-1.5 px-2 flex items-center gap-2 cursor-pointer focus:bg-muted/60 text-[12px] text-muted-foreground"
              >
                <User className="size-3.5" /> Unassigned
              </DropdownMenuItem>
              {(members || []).map((m) => (
                <DropdownMenuItem
                  key={m._id}
                  onSelect={(e) => {
                    e.preventDefault()
                    toggleAssignee(m._id)
                  }}
                  className="py-1.5 px-2 flex items-center justify-between cursor-pointer focus:bg-muted/60 text-[12px]"
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="size-5"><AvatarFallback className="text-[8px] bg-blue-500/10 text-blue-600">{getInitials(m.displayName)}</AvatarFallback></Avatar>
                    {m.displayName}
                  </div>
                  {selectedAssigneeIds.includes(m._id) && <Check className="size-3 text-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Labels Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 text-[11.5px] font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background">
                <Tag className="size-3.5 text-muted-foreground" /> Labels {selectedLabelIds.length > 0 && `(${selectedLabelIds.length})`}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[180px] p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground mb-1">
                <span>Add labels...</span>
                <span className="text-[10px] bg-muted/60 px-1 py-0.5 rounded text-foreground">L</span>
              </div>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              {(labels || []).map((lbl) => (
                <DropdownMenuItem
                  key={lbl._id}
                  onClick={(e) => {
                    e.preventDefault()
                    setSelectedLabelIds((prev) =>
                      prev.includes(lbl._id)
                        ? prev.filter((id) => id !== lbl._id)
                        : [...prev, lbl._id]
                    )
                  }}
                  className="py-1.5 px-2 flex items-center justify-between cursor-pointer focus:bg-muted/60 text-[12px]"
                >
                  <div className="flex items-center gap-2">
                    <div className={`size-2.5 rounded-full ${labelColorMap[lbl.color] || "bg-muted-foreground"}`} /> {lbl.name}
                  </div>
                  {selectedLabelIds.includes(lbl._id) && <Check className="size-3 text-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Repository Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 text-[11.5px] font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background">
                <GitBranch className="size-3.5 text-muted-foreground" />
                {selectedRepoFullName ? selectedRepoFullName.split("/")[1] : "Repository"}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[220px] p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40 max-h-[200px] overflow-y-auto">
              <div className="px-2 py-1.5 text-xs text-muted-foreground mb-1">
                <span>Link to repository...</span>
              </div>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              <DropdownMenuItem onClick={() => setSelectedRepoFullName(undefined)} className="py-1.5 px-2 flex items-center gap-2 cursor-pointer focus:bg-muted/60 text-[12px] text-muted-foreground">
                None (app only)
              </DropdownMenuItem>
              {reposLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">Loading repos...</div>
              ) : (
                repos.map((repo) => (
                  <DropdownMenuItem key={repo.fullName} onClick={() => setSelectedRepoFullName(repo.fullName)} className="py-1.5 px-2 flex items-center justify-between cursor-pointer focus:bg-muted/60 text-[12px]">
                    <span className="truncate">{repo.fullName}</span>
                    {selectedRepoFullName === repo.fullName && <Check className="size-3 text-foreground shrink-0" />}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Team Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 text-[11.5px] font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background">
                {selectedTeam ? (
                  (() => { const ti = getTeamIcon(selectedTeam.icon); const TI = ti.icon; return <><TI className={`size-3.5 ${ti.color}`} /> {selectedTeam.name}</> })()
                ) : (
                  <><Users className="size-3.5 text-muted-foreground" /> Team</>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px] p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40 max-h-[200px] overflow-y-auto">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground mb-1">
                <span>Assign to team...</span>
                <span className="text-[10px] bg-muted/60 px-1 py-0.5 rounded text-foreground">T</span>
              </div>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              <DropdownMenuItem onClick={() => setSelectedTeamId(undefined)} className="py-1.5 px-2 flex items-center gap-2 cursor-pointer focus:bg-muted/60 text-[12px] text-muted-foreground">
                <Users className="size-3.5" /> No team
              </DropdownMenuItem>
              {(teams || []).map((t) => {
                const ti = getTeamIcon(t.icon)
                const TeamIcon = ti.icon
                return (
                  <DropdownMenuItem key={t._id} onClick={() => setSelectedTeamId(t._id)} className="py-1.5 px-2 flex items-center justify-between cursor-pointer focus:bg-muted/60 text-[12px]">
                    <div className="flex items-center gap-2">
                      <TeamIcon className={`size-3.5 ${ti.color}`} />
                      {t.name}
                      <span className="text-[10px] text-muted-foreground/50 font-mono">{t.identifier}</span>
                    </div>
                    {selectedTeamId === t._id && <Check className="size-3 text-foreground" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Project Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 text-[11.5px] font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background">
                {selectedProjectId ? (
                  <><KanbanSquare className="size-3.5 text-blue-500" /> {projects?.find(p => p._id === selectedProjectId)?.name}</>
                ) : (
                  <><KanbanSquare className="size-3.5 text-muted-foreground" /> Project</>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px] p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40 max-h-[200px] overflow-y-auto">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground mb-1">
                <span>Add to project...</span>
                <span className="text-[10px] bg-muted/60 px-1 py-0.5 rounded text-foreground">J</span>
              </div>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              <DropdownMenuItem onClick={() => setSelectedProjectId(undefined)} className="py-1.5 px-2 flex items-center gap-2 cursor-pointer focus:bg-muted/60 text-[12px] text-muted-foreground">
                <KanbanSquare className="size-3.5" /> No project
              </DropdownMenuItem>
              {(projects || []).map((p) => {
                return (
                  <DropdownMenuItem key={p._id} onClick={() => setSelectedProjectId(p._id)} className="py-1.5 px-2 flex items-center justify-between cursor-pointer focus:bg-muted/60 text-[12px]">
                    <div className="flex items-center gap-2">
                       <KanbanSquare className="size-3.5 text-blue-500" />
                      <span className="truncate">{p.name}</span>
                    </div>
                    {selectedProjectId === p._id && <Check className="size-3 text-foreground shrink-0" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Extra / More Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center justify-center size-[26px] rounded-full border border-border/60 text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors bg-background text-[11.5px]">
                <MoreHorizontal className="size-3.5" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-fit p-1 shadow-md bg-background text-foreground rounded-lg border border-border/40">
              <DropdownMenuItem className="py-1.5 px-2 flex items-center gap-2 cursor-pointer focus:bg-muted/60 text-[12px]">More options...</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

        </div>

        <div className="px-6 pb-5">
          <div className="rounded-xl border border-border/50 bg-muted/10 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold text-foreground">Attachments & links</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Add reference URLs and files before creating the issue.
                </div>
              </div>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleAttachmentUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={isUploadingAttachment}
                className="h-8 gap-1.5 text-[12px] font-medium shadow-none"
              >
                {isUploadingAttachment ? <RefreshCw className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                {isUploadingAttachment ? "Uploading..." : "Add files"}
              </Button>
            </div>

            <div className="mt-3 flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
              <input
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="Link label (optional)"
                className="h-9 rounded-lg border border-border/60 bg-background px-3 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleAddLink()
                  }
                }}
                placeholder="https://example.com"
                className="h-9 rounded-lg border border-border/60 bg-background px-3 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddLink}
                disabled={!linkUrl.trim()}
                className="h-9 gap-1.5 text-[12px] font-medium shadow-none"
              >
                <Link2 className="size-3.5" /> Add link
              </Button>
            </div>

            {(pendingLinks.length > 0 || pendingAttachments.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex max-w-full items-center gap-2 rounded-full border border-border/50 bg-background px-3 py-1.5 text-[11px] text-foreground"
                  >
                    <Link2 className="size-3 text-blue-500 shrink-0" />
                    <span className="truncate max-w-[220px]">
                      {link.label ? `${link.label} - ${link.url}` : link.url}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePendingLink(link.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}

                {pendingAttachments.map((attachment) => (
                  <div
                    key={attachment.storageId}
                    className="flex max-w-full items-center gap-2 rounded-full border border-border/50 bg-background px-3 py-1.5 text-[11px] text-foreground"
                  >
                    <Paperclip className="size-3 text-muted-foreground shrink-0" />
                    <span className="truncate max-w-[220px]">{attachment.fileName}</span>
                    <button
                      type="button"
                      onClick={() => removePendingAttachment(attachment.storageId)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Area */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border/10 bg-muted/10">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{pendingLinks.length} link{pendingLinks.length !== 1 ? "s" : ""}</span>
            <span>•</span>
            <span>{pendingAttachments.length} file{pendingAttachments.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="create-more"
                checked={createMore}
                onCheckedChange={setCreateMore}
                className="scale-75 data-[state=checked]:bg-blue-600"
              />
              <label htmlFor="create-more" className="text-[12px] font-medium text-muted-foreground cursor-pointer shrink-0">Create more</label>
            </div>
            
            <Button
              size="sm"
              disabled={!title.trim() || isSubmitting}
              onClick={handleSubmit}
              className="bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white rounded-[6px] px-4 font-medium text-[12.5px] tracking-wide disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create issue"}
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  )
}
