"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useOrganization } from "@/hooks/use-organization"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Inbox, AlertCircle, Users, FolderKanban, CalendarClock, Settings2, GitPullRequest,
  Code2, Layers, Headset, HardDrive, Palette, Car, Globe, Shield, Zap, Bug, Rocket,
  Database, Cpu, Wifi, Smartphone, Monitor, Lock, Settings, Star, Heart, Sun, Moon
} from "lucide-react"
import { useTheme } from "next-themes"

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



export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { organization } = useOrganization()
  const userStore = useQuery(api.users.current)
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const userData = {
    name: userStore?.name || "Loading...",
    email: userStore?.email || "",
    avatar: userStore?.image || "",
  }

  const myTeams = useQuery(
    api.teams.listMyTeams,
    organization ? { orgId: organization._id } : "skip"
  )

  const unreadCount = useQuery(
    api.notifications.getUnreadCount,
    organization ? { orgId: organization._id } : "skip"
  )

  // Build nav groups with real team data
  const navGroups = React.useMemo(() => {
    const teamSubItems = (myTeams || []).map((t: any) => {
      const iconMeta = TEAM_ICON_MAP[t.icon || "Code2"] || TEAM_ICON_MAP.Code2
      const IconComp = iconMeta.icon
      return {
        title: t.name,
        url: `/dashboard/teams/${t._id}`,
        icon: <IconComp className={`size-4 ${iconMeta.color}`} />,
      }
    })

    return [
      {
        label: "Platform",
        items: [
          { title: "Inbox", url: "/dashboard", icon: <Inbox />, isActive: false, badge: (unreadCount && unreadCount > 0) ? unreadCount : undefined },
          { title: "Issues", url: "/dashboard/issues", icon: <AlertCircle />, isActive: false },
          { title: "Reviews", url: "/dashboard/pulls", icon: <GitPullRequest />, isActive: false },
        ]
      },
      {
        label: "Organization",
        items: [
          {
            title: "Teams",
            url: "/dashboard/teams",
            icon: <Users />,
            isActive: false,
            items: teamSubItems.length > 0 ? teamSubItems : undefined,
          },
          {
            title: "Projects",
            url: "/dashboard/projects",
            icon: <FolderKanban />,
            isActive: false,
          },
        ]
      },
      {
        label: "Workspace",
        items: [
          {
            title: "Co-work",
            url: "#",
            icon: <CalendarClock />,
            isActive: false,
          },
          {
            title: "Settings",
            url: "/dashboard/settings",
            icon: <Settings2 />,
            isActive: false,
          },
        ]
      }
    ]
  }, [myTeams, unreadCount])

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex w-full items-center">
                  <img src="/eganow.svg" alt="Eganow Logo" className="h-7 w-auto object-contain" />
                  <p className="text-lg font-bold">.repo</p>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col gap-1.5 px-0.5">
          { mounted && (
            <div className="flex items-center justify-between px-2.5 pb-1 pt-1 opacity-70 hover:opacity-100 transition-opacity">
              <div className="flex items-center bg-muted/60 border border-border/50 rounded-full p-[3px]">
                <button 
                  onClick={() => setTheme("light")} 
                  className={`size-[22px] rounded-full flex items-center justify-center transition-colors ${theme === 'light' ? 'bg-background shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-foreground border border-border/40' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Sun className="size-3" strokeWidth={2.5} />
                </button>
                <button 
                  onClick={() => setTheme("dark")} 
                  className={`size-[22px] rounded-full flex items-center justify-center transition-colors ${theme === 'dark' ? 'bg-background shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-foreground border border-border/40' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Moon className="size-3" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          )}
          <NavUser user={userData} />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
