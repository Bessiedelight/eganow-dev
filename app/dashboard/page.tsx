"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
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
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Inbox, SlidersHorizontal, ChevronDown, CheckCircle2,
  Clock, Link2, MoreHorizontal, User, Check, CircleDot, ChevronRight, MessageSquare,
  PlayCircle, Milestone, XCircle, GitPullRequest, GitMerge,
  ShieldCheck, AlertTriangle, Paperclip
} from "lucide-react"

// ─── Icon + color map per notification type ───────────────────
const NOTIF_TYPE_MAP: Record<string, { icon: any; color: string }> = {
  review: { icon: GitPullRequest, color: "text-blue-500" },
  mention: { icon: MessageSquare, color: "text-muted-foreground" },
  assignment: { icon: User, color: "text-green-500" },
  ci: { icon: XCircle, color: "text-red-500" },
  status: { icon: CheckCircle2, color: "text-purple-500" },
  comment: { icon: MessageSquare, color: "text-blue-400" },
  merge: { icon: GitMerge, color: "text-purple-500" },
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "now"
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

// ─── Read-Only Property Row (Matching Issue Detail style) ────────
function ReadOnlyPropertyRow({ label, value, icon, iconColor = "text-muted-foreground" }: {
  label: string; value: React.ReactNode; icon: any; iconColor?: string
}) {
  const Icon = icon
  return (
    <div className="flex items-center text-[13px] font-medium text-foreground py-1.5 rounded-md px-2 -mx-2">
      <div className="w-[100px] flex items-center gap-2.5 text-muted-foreground/80 shrink-0">
        <Icon className={`size-4 shrink-0 ${iconColor}`} />
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center">{value}</div>
    </div>
  )
}


export default function Page() {
  const router = useRouter()
  const { organization, isLoading: orgLoading } = useOrganization()
  const [filter, setFilter] = React.useState<"all" | "unread" | "mentions" | "assigned" | "review">("unread")
  const [isFilterInitialized, setIsFilterInitialized] = React.useState(false)
  
  const [ordering, setOrdering] = React.useState<"newest" | "oldest">("newest")
  const [ageLimit, setAgeLimit] = React.useState<"all_time" | "last_24h" | "last_7d" | "last_30d">("all_time")
  const [showSnoozed, setShowSnoozed] = React.useState<boolean>(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  
  // Keep recently-read notifications in the list during the active session 
  // so they don't immediately vanish when clicked.
  const [retainedIds, setRetainedIds] = React.useState<string[]>([])

  const handleFilterChange = (newFilter: typeof filter) => {
    setFilter(newFilter)
    setRetainedIds([]) // Reset retained items when switching views
  }

  // ─── Queries ──────────────────────────────────────────
  const rawNotifications = useQuery(
    api.notifications.listForCurrentUser,
    organization ? { orgId: organization._id, filter: "all", retainedIds: retainedIds as any[] } : "skip"
  )

  // Auto-switch to "all" on load if zero unread exist natively
  React.useEffect(() => {
    if (rawNotifications !== undefined && !isFilterInitialized) {
      const hasUnread = rawNotifications.some(
        (n) => !n.isRead && (!n.snoozedUntil || n.snoozedUntil <= Date.now())
      )
      if (!hasUnread) setFilter("all")
      setIsFilterInitialized(true)
    }
  }, [rawNotifications, isFilterInitialized])

  const notifications = React.useMemo(() => {
    if (!rawNotifications) return undefined;
    let filtered = rawNotifications.filter(n => {
      // Age limit filter
      const ageMs = Date.now() - n.createdAt;
      if (ageLimit === "last_24h" && ageMs > 24 * 60 * 60 * 1000) return false;
      if (ageLimit === "last_7d" && ageMs > 7 * 24 * 60 * 60 * 1000) return false;
      if (ageLimit === "last_30d" && ageMs > 30 * 24 * 60 * 60 * 1000) return false;

      // Snooze filter
      if (!showSnoozed && n.snoozedUntil && n.snoozedUntil > Date.now()) return false;

      // Always retain items that were just interacted with in this session
      if (retainedIds.includes(n._id)) return true;

      // Type filter
      if (filter === "unread") return !n.isRead;
      if (filter === "mentions") return n.notifType === "mention" || n.context.toLowerCase().includes("mention");
      if (filter === "assigned") return n.notifType === "assignment" || n.context.toLowerCase().includes("assign");
      if (filter === "review") return n.notifType === "review" || n.context.toLowerCase().includes("review") || n.context.toLowerCase().includes("approved");
      return true; // "all"
    });

    // Apply ordering
    if (ordering === "oldest") {
      filtered = filtered.sort((a, b) => a.createdAt - b.createdAt);
    } else {
      // Default: newest
      filtered = filtered.sort((a, b) => b.createdAt - a.createdAt);
    }

    return filtered;
  }, [rawNotifications, filter, retainedIds, ordering, ageLimit, showSnoozed])

  // ─── Mutations ────────────────────────────────────────
  const markRead = useMutation(api.notifications.markAsRead)
  const markAllRead = useMutation(api.notifications.markAllAsRead)
  const snoozeMut = useMutation(api.notifications.snooze)
  const archiveMut = useMutation(api.notifications.archive)

  // ─── Selected notification ────────────────────────────
  const selected = notifications?.find((n) => n._id === selectedId) ?? null

  // Auto-select first item if nothing is selected
  React.useEffect(() => {
    if (notifications && notifications.length > 0 && !selectedId) {
      setSelectedId(notifications[0]._id)
    }
  }, [notifications, selectedId])

  const handleSelect = async (n: any) => {
    setSelectedId(n._id)
    if (!n.isRead) {
      if (filter === "unread") {
        setRetainedIds(prev => Array.from(new Set([...prev, n._id])))
      }
      await markRead({ notificationId: n._id })
    }
  }

  const handleMarkAllRead = async () => {
    if (organization) {
      await markAllRead({ orgId: organization._id })
    }
  }

  const handleSnooze = async (id: any) => {
    await snoozeMut({ notificationId: id, durationMs: 3 * 60 * 60 * 1000 }) // 3 hours
  }

  const handleArchive = async (id: any) => {
    await archiveMut({ notificationId: id })
    if (selectedId === id) setSelectedId(null)
  }

  const isLoading = orgLoading || (organization !== null && notifications === undefined)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex w-full flex-1 overflow-hidden text-sm">
          
          {/* ═══ Left Notification List ═══ */}
          <div className="w-[410px] flex flex-col border-r bg-background z-10 shrink-0">
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-3 border-b shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="flex items-center gap-1.5 px-2">
                <SidebarTrigger className="-ml-2" />
                <Inbox className="size-4 text-muted-foreground ml-1" />
                <span className="text-[14px] font-medium text-foreground tracking-tight ml-0.5">Inbox</span>
                {notifications && notifications.filter(n => !n.isRead).length > 0 && (
                  <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 tabular-nums">
                    {notifications.filter(n => !n.isRead).length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 text-muted-foreground hover:bg-muted/50 hover:text-foreground" 
                      onClick={handleMarkAllRead}
                    >
                      <Check className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Mark all as read</TooltipContent>
                </Tooltip>
                <Popover>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                          <SlidersHorizontal className="size-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">View options</TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" className="w-[300px] p-0 shadow-lg rounded-xl overflow-hidden border-border/60">
                    <div className="flex flex-col group/pop text-[14px]">
                      <div className="flex items-center justify-between px-4 py-3">
                        <span className="text-secondary-foreground font-medium">Ordering</span>
                        <Select value={ordering} onValueChange={(val: any) => setOrdering(val)}>
                          <SelectTrigger className="w-[130px] h-8 text-xs bg-transparent border-border/60 shadow-none">
                            <SelectValue placeholder="Ordering" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="newest" className="text-xs">Newest first</SelectItem>
                            <SelectItem value="oldest" className="text-xs">Oldest first</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 border-t border-border/60">
                        <span className="text-secondary-foreground font-medium">Age Limit</span>
                        <Select value={ageLimit} onValueChange={(val: any) => setAgeLimit(val)}>
                          <SelectTrigger className="w-[130px] h-8 text-xs bg-transparent border-border/60 shadow-none">
                            <SelectValue placeholder="Age limit" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all_time" className="text-xs">All time</SelectItem>
                            <SelectItem value="last_24h" className="text-xs">Last 24 hours</SelectItem>
                            <SelectItem value="last_7d" className="text-xs">Last 7 days</SelectItem>
                            <SelectItem value="last_30d" className="text-xs">Last 30 days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Separator className="bg-border/60" />
                      <div className="flex flex-col py-1">
                        <div 
                          className="flex items-center justify-between px-4 py-2 hover:bg-muted/40 cursor-pointer transition-colors"
                          onClick={() => setShowSnoozed(!showSnoozed)}
                        >
                          <span className="text-secondary-foreground font-medium">Show snoozed</span>
                          <Switch checked={showSnoozed} onCheckedChange={setShowSnoozed} />
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Sub-header / Filters */}
            <div className="h-12 flex items-center justify-between px-4 border-b shrink-0 bg-background text-sm pb-1 pt-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
              <div className="h-[28px] flex items-center bg-muted/40 p-0.5 rounded-[6px] border border-border/40 min-w-max">
                {(["unread", "all", "mentions", "assigned", "review"] as const).map((f) => (
                  <button 
                    key={f}
                    onClick={() => handleFilterChange(f)}
                    className={`px-3.5 h-full flex items-center justify-center text-[11.5px] font-medium rounded-[4px] transition-all flex-1 capitalize ${filter === f ? 'bg-background text-foreground border border-border/20 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                </div>
              ) : !notifications || notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Inbox className="size-8 mb-3 opacity-30" />
                  <p className="text-[14px] font-medium">You're all caught up!</p>
                  <p className="text-[12px] mt-1 opacity-70">No {filter === "unread" ? "unread " : ""}notifications</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {notifications.map((n) => {
                    const typeMeta = NOTIF_TYPE_MAP[n.notifType] || NOTIF_TYPE_MAP.status
                    const NotifIcon = typeMeta.icon
                    const isActive = selectedId === n._id

                    return (
                      <div 
                        key={n._id} 
                        onClick={() => handleSelect(n)}
                        className={`group/row flex items-start gap-3 px-5 py-3.5 border-b border-border/40 last:border-b-0 border-l-2 cursor-pointer transition-colors relative ${isActive ? 'bg-blue-50/20 dark:bg-blue-900/10 border-l-blue-500' : 'bg-muted/10 border-l-transparent hover:bg-muted/30'}`}
                      >
                        {/* Unread indicator */}
                        <div className="absolute left-[3px] top-4">
                          {!n.isRead && <div className="size-1.5 rounded-full bg-blue-500" />}
                        </div>
                        
                        <div className="mt-0.5 flex-shrink-0">
                          <NotifIcon className={`size-4 ${typeMeta.color}`} />
                        </div>

                        <div className="flex-1 space-y-1 overflow-hidden pr-12">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground truncate font-medium flex items-center gap-1.5">
                              {n.context}
                            </span>
                          </div>
                          <h4 className={`text-[13px] truncate ${!n.isRead ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                            {n.title}
                          </h4>
                        </div>

                        {/* Hover actions */}
                        <div className="absolute right-4 top-4 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity bg-background shadow-sm rounded-md border border-border/60 p-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={(e) => { e.stopPropagation(); handleArchive(n._id) }}
                              >
                                <Check className="size-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Archive</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={(e) => { e.stopPropagation(); handleSnooze(n._id) }}
                              >
                                <Clock className="size-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Snooze (3h)</TooltipContent>
                          </Tooltip>
                        </div>

                        {/* Time (hidden on hover) */}
                        <span className="text-[10.5px] font-medium text-muted-foreground/70 shrink-0 uppercase absolute right-4 top-4 group-hover/row:opacity-0 transition-opacity tabular-nums">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ═══ Main Canvas (Right Pane) ═══ */}
          <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
            
            {selected ? (
              <>
                {/* Detail Header */}
                <div className="h-14 flex items-center justify-between px-6 border-b shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10 relative">
                  <div className="flex items-center text-[13px] font-medium text-foreground gap-1.5 overflow-hidden">
                    <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-muted-foreground hover:text-foreground shrink-0">
                      <PlayCircle className="size-3.5 fill-blue-500 text-white dark:text-background" /> 
                      {organization?.name || "Workspace"}
                    </Button>
                    <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
                    <span className="text-foreground font-semibold truncate">{selected.title}</span>
                  </div>
                    <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 mr-4 border-r border-border/40 pr-4">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 gap-1.5 text-[12px] shadow-none border-border/60 hover:bg-muted/50 rounded-md"
                        onClick={() => handleArchive(selected._id)}
                      >
                        <CheckCircle2 className="size-3.5" /> Done
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="h-7 w-7 text-muted-foreground border-border/60 shadow-none hover:bg-muted/50"
                            onClick={() => handleSnooze(selected._id)}
                          >
                            <Clock className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Snooze (3h)</TooltipContent>
                      </Tooltip>
                    </div>
                    {selected.linkedEntity?.route && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                        onClick={() => router.push(selected.linkedEntity!.route!)}
                      >
                        <Link2 className="size-3.5" /> Open {selected.linkedEntity.type === "issue" ? "Issue" : "PR"}
                      </Button>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground">
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">More actions</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Canvas Body */}
                <div className="flex-1 flex overflow-hidden">
                  {/* Content Area */}
                  <div className="flex-1 overflow-y-auto px-16 py-12 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full">
                    <div className="max-w-2xl mx-auto w-full">
                      
                      {/* Context Banner */}
                      <div className="flex items-center gap-2.5 px-3 py-2 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-500/20 rounded-md mb-8">
                        {React.createElement(
                          (NOTIF_TYPE_MAP[selected.notifType] || NOTIF_TYPE_MAP.status).icon,
                          { className: `size-4 ${(NOTIF_TYPE_MAP[selected.notifType] || NOTIF_TYPE_MAP.status).color}` }
                        )}
                        <span className="text-[13px] text-foreground font-medium">
                          {selected.context} · {timeAgo(selected.createdAt)} ago
                        </span>
                      </div>

                      <h1 className="text-3xl font-semibold tracking-tight mb-2 text-foreground">{selected.title}</h1>
                      
                      {selected.linkedEntity?.identifier && (
                        <p className="text-muted-foreground text-[14px] mb-8 font-mono">
                          {selected.linkedEntity.identifier}
                        </p>
                      )}

                      {selected.linkedEntity?.body && (
                        <div className="text-[14.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                          {selected.linkedEntity.body}
                        </div>
                      )}

                      <div className="py-8">
                        <Separator className="bg-border/60" />
                      </div>

                      {/* Quick action area */}
                      <div className="mt-4">
                        <h3 className="font-semibold text-[14px] text-foreground mb-6">Quick Actions</h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          {selected.linkedEntity?.route && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-[13px] font-medium shadow-none border-border/60"
                              onClick={() => router.push(selected.linkedEntity!.route!)}
                            >
                              <Link2 className="size-3.5" />
                              View full {selected.linkedEntity.type === "issue" ? "issue" : "pull request"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-[13px] font-medium shadow-none border-border/60"
                            onClick={() => handleArchive(selected._id)}
                          >
                            <CheckCircle2 className="size-3.5" />
                            Mark as done
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-[13px] font-medium shadow-none border-border/60"
                            onClick={() => handleSnooze(selected._id)}
                          >
                            <Clock className="size-3.5" />
                            Snooze
                          </Button>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Right Column: Properties */}
                  <div className="w-[300px] xl:w-[320px] overflow-y-auto p-6 shrink-0 [&::-webkit-scrollbar]:hidden border-l border-border/60 bg-background flex flex-col gap-6">

                    {/* Metadata Section 1 */}
                    <div className="bg-muted/30 rounded-xl p-4 flex flex-col gap-1">
                      
                      {/* Sender */}
                      <ReadOnlyPropertyRow label="Sender" value={
                        <span className="flex items-center gap-1.5">
                          <Avatar className="size-[18px] border bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600">
                            <AvatarFallback className="text-[8px] font-bold">{selected.actorAvatarInitials || "??"}</AvatarFallback>
                          </Avatar>
                          {selected.actorDisplayName}
                        </span>
                      } icon={User} />

                      {/* Notif Type */}
                      <ReadOnlyPropertyRow label="Event" value={
                        <span className="capitalize">{selected.notifType || "Status"}</span>
                      } icon={(NOTIF_TYPE_MAP[selected.notifType] || NOTIF_TYPE_MAP.status).icon} iconColor={(NOTIF_TYPE_MAP[selected.notifType] || NOTIF_TYPE_MAP.status).color} />

                      {/* Context Info */}
                      <ReadOnlyPropertyRow label="Context" value={
                        <span className="truncate">{selected.context}</span>
                      } icon={MessageSquare} />

                      {/* Created At */}
                      <ReadOnlyPropertyRow label="Received" value={
                        <Tooltip>
                          <TooltipTrigger className="cursor-default truncate text-left hover:text-foreground transition-colors">{timeAgo(selected.createdAt)} ago</TooltipTrigger>
                          <TooltipContent className="text-xs">
                            {new Date(selected.createdAt).toLocaleString()}
                          </TooltipContent>
                        </Tooltip>
                      } icon={Clock} />

                      {/* Linked Source */}
                      {selected.linkedEntity?.type && (
                        <ReadOnlyPropertyRow label="Source" value={
                          <span className="truncate font-mono font-semibold tracking-tight">{selected.linkedEntity.identifier}</span>
                        } icon={selected.linkedEntity.type === "issue" ? CircleDot : GitPullRequest} iconColor={selected.linkedEntity.type === "issue" ? "text-green-500" : "text-blue-500"} />
                      )}

                    </div>

                    {/* Metadata Section 2 (Status) */}
                    <div className="bg-muted/30 rounded-xl p-4 flex flex-col gap-1">
                      {/* Status */}
                      <ReadOnlyPropertyRow label="Status" value={
                        selected.isRead ? (
                          <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                            Read
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-blue-500 font-semibold">
                            <div className="size-1.5 rounded-full bg-blue-500" /> Unread
                          </span>
                        )
                      } icon={selected.isRead ? CheckCircle2 : CircleDot} iconColor={selected.isRead ? "text-muted-foreground" : "text-blue-500"} />

                      {/* Snooze (If applicable) */}
                      {selected.snoozedUntil && selected.snoozedUntil > Date.now() && (
                        <ReadOnlyPropertyRow label="Snoozed" value={
                          <span className="text-orange-500 font-medium tracking-tight">Until {new Date(selected.snoozedUntil).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        } icon={Clock} iconColor="text-orange-500" />
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Empty state when no notification is selected */
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Inbox className="size-12 mb-4 opacity-20" />
                <p className="text-[15px] font-medium">Select a notification</p>
                <p className="text-[13px] mt-1 opacity-70">Pick an item from the left to view details</p>
              </div>
            )}
          </div>

        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
