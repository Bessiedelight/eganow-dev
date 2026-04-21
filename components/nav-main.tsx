"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { ChevronRightIcon } from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

export function NavMain({
  label = "Platform",
  items,
}: {
  label?: string
  items: {
    title: string
    url: string
    icon: React.ReactNode
    isActive?: boolean
    items?: {
      title: string
      url: string
      icon?: React.ReactNode
    }[]
  }[]
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <NavMainItem key={item.title} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function NavMainItem({ item }: { item: any }) {
  const pathname = usePathname()

  const isUrlActive = (url: string) => {
    if (url === "#") return false
    if (url === "/dashboard") return pathname === "/dashboard"
    return pathname === url || pathname.startsWith(url + "/")
  }

  const isDirectlyActive = isUrlActive(item.url)
  const childIsActive = item.items?.some((subItem: any) => isUrlActive(subItem.url))
  const isItemActive = isDirectlyActive || childIsActive

  const [isOpen, setIsOpen] = React.useState(item.isActive || childIsActive || false)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const iconRef = React.useRef<SVGSVGElement>(null)
  
  // Keep track of the initial render so GSAP doesn't prematurely trigger animations on mount
  const isFirstRender = React.useRef(true)

  useGSAP(() => {
    if (!contentRef.current || !iconRef.current) return

    if (isFirstRender.current) {
      if (!isOpen) {
        gsap.set(contentRef.current, { height: 0, opacity: 0, display: "none" })
        gsap.set(iconRef.current, { rotation: 0 })
      } else {
        gsap.set(contentRef.current, { height: "auto", opacity: 1, display: "block" })
        gsap.set(iconRef.current, { rotation: 90 })
      }
      isFirstRender.current = false
      return
    }

    if (isOpen) {
      // Force block and auto height to allow the browser to compute the target dimensions
      gsap.set(contentRef.current, { display: "block", height: "auto" })
      const targetHeight = contentRef.current.offsetHeight
      
      // Snap to 0 and immediately animate to the computed height
      gsap.fromTo(contentRef.current,
        { height: 0, opacity: 0 },
        {
          height: targetHeight,
          opacity: 1,
          duration: 0.35,
          ease: "power2.out",
          onComplete: () => {
            gsap.set(contentRef.current, { height: "auto" })
          }
        }
      )
      gsap.to(iconRef.current, { rotation: 90, duration: 0.35, ease: "power2.out" })
    } else {
      const currentHeight = contentRef.current.offsetHeight
      gsap.fromTo(contentRef.current,
        { height: currentHeight },
        {
          height: 0,
          opacity: 0,
          duration: 0.35,
          ease: "power2.out",
          onComplete: () => {
            gsap.set(contentRef.current, { display: "none" })
          }
        }
      )
      gsap.to(iconRef.current, { rotation: 0, duration: 0.35, ease: "power2.out" })
    }
  }, [isOpen])

  return (
    <SidebarMenuItem>
      {item.items?.length ? (
        <div className="relative w-full flex items-center group/menu-item">
          <SidebarMenuButton 
            asChild
            tooltip={item.title} 
            isActive={isItemActive}
            className="cursor-pointer select-none"
          >
            <Link href={item.url} className="flex flex-1 items-center gap-2 pr-8">
              {item.icon}
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsOpen(!isOpen)
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center hover:bg-muted-foreground/20 text-muted-foreground transition-colors"
          >
            <ChevronRightIcon ref={iconRef} className="size-3.5 shrink-0 transition-none" />
          </button>
        </div>
      ) : (
        <SidebarMenuButton asChild tooltip={item.title} isActive={isItemActive}>
          <Link href={item.url} className="flex flex-1 items-center gap-2 justify-between w-full pr-1 font-medium">
            <div className="flex items-center gap-2 max-w-full truncate">
              {item.icon}
              <span className="truncate">{item.title}</span>
            </div>
            {item.badge !== undefined && (
              <span className="bg-blue-500 text-white flex items-center justify-center shrink-0 min-w-[18px] h-[18px] text-[10px] font-bold rounded-full px-1.5 tabular-nums">
                {item.badge}
              </span>
            )}
          </Link>
        </SidebarMenuButton>
      )}
      
      {item.items?.length ? (
        <div 
          ref={contentRef} 
          className="overflow-hidden"
          style={{ 
            display: item.isActive || childIsActive ? "block" : "none",
            height: item.isActive || childIsActive ? "auto" : 0,
            opacity: item.isActive || childIsActive ? 1 : 0
          }}
        >
          <SidebarMenuSub className="mt-1">
            {item.items.map((subItem: any) => {
              const isSubItemActive = isUrlActive(subItem.url);
              return (
                <SidebarMenuSubItem key={subItem.title}>
                  <SidebarMenuSubButton asChild isActive={isSubItemActive}>
                    <Link href={subItem.url} className="flex items-center gap-2">
                      {subItem.icon && subItem.icon}
                      <span>{subItem.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </div>
      ) : null}
    </SidebarMenuItem>
  )
}
