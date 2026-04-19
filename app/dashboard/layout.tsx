"use client"

import { useConvexAuth } from "convex/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

// Module-level flag persists across component remounts
let authEverResolved = false

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading) {
      authEverResolved = true
      if (!isAuthenticated) {
        router.replace("/")
      }
    }
  }, [isAuthenticated, isLoading, router])

  // First ever visit: show minimal loading while auth resolves
  if (isLoading && !authEverResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
      </div>
    )
  }

  // Always render children immediately — no spinner on subsequent navigations
  return <>{children}</>
}
