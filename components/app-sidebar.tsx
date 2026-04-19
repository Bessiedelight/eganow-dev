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
  Database, Cpu, Wifi, Smartphone, Monitor, Lock, Settings, Star, Heart
} from "lucide-react"

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

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { organization } = useOrganization()

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
  }, [myTeams])

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
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
