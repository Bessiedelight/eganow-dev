"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useAuthActions } from "@convex-dev/auth/react"
import { useConvexAuth } from "convex/react"

import { Button } from "@/components/ui/button"

function GithubIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      {...props}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  )
}

export default function ConnectGithubPage() {
  const { signIn } = useAuthActions()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()
  const [isSignApp, setIsSignApp] = React.useState(false)
  const [isConnecting, setIsConnecting] = React.useState(false)

  // Redirect authenticated users to dashboard
  React.useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard")
    }
  }, [isAuthenticated, isLoading, router])

  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      await signIn("github", { redirectTo: "/dashboard" })
    } catch (e) {
      setIsConnecting(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center relative overflow-hidden bg-background">
      
      {/* Abstract Background Vectors (Center Ambient Glow) */}
      <div className="absolute inset-0 z-0 opacity-[0.15] pointer-events-none flex items-center justify-center">
        <div className="absolute w-[600px] h-[600px] rounded-full bg-blue-500 blur-[150px] opacity-60 mix-blend-multiply" />
        <div className="absolute w-[500px] h-[500px] rounded-full bg-indigo-500 blur-[130px] opacity-60 mix-blend-multiply translate-x-[200px]" />
      </div>

      <div className="relative z-10 w-full max-w-[380px] flex flex-col items-center p-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
        
        {/* Brand Logo & Identifier */}
        <div className="flex items-center mb-10">
          <img src="/eganow.svg" alt="Eganow Logo" className="h-7 w-auto object-contain dark:invert" />
          <span className="text-xl font-bold tracking-tight text-foreground">.dev</span>
        </div>

        {/* Toggle Nav */}
        <div className="flex bg-muted/60 p-1 rounded-lg mb-8 w-full max-w-[240px]">
          <button 
            onClick={() => setIsSignApp(false)}
            className={`flex-1 text-[13px] font-medium py-1.5 rounded-md transition-all duration-300 ${!isSignApp ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Sign In
          </button>
          <button 
            onClick={() => setIsSignApp(true)}
            className={`flex-1 text-[13px] font-medium py-1.5 rounded-md transition-all duration-300 ${isSignApp ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Sign Up
          </button>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-2 text-foreground">
            {isSignApp ? "Create your account" : "Welcome back"}
          </h2>
          <p className="text-[14px] text-muted-foreground">
            {isSignApp ? "Instantly provision your workspace via GitHub OAuth." : "Authenticate with GitHub to access your repositories."}
          </p>
        </div>

        <div className="w-full space-y-4 mb-8">
          <Button 
            className="w-full h-11 text-[14px] font-medium shadow-sm transition-all hover:-translate-y-0.5" 
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <div className="flex items-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Authenticating...
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <GithubIcon className="size-4" />
                Continue with GitHub
              </div>
            )}
          </Button>
        </div>

      </div>
    </div>
  )
}
