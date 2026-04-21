"use client"

import * as React from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import Image from "next/image"

import {
  PlayCircle, ChevronRight, Star, MoreHorizontal, Link2, ArrowUpRight,
  Pencil, Info, Moon, Sun, Monitor, LogOut, CheckCircle2, ExternalLink,
  Building2, Loader2, Trash2, RefreshCw, Eye, EyeOff, KeyRound, Bot, Zap
} from "lucide-react"
import { useTheme } from "next-themes"
import { useAuthActions } from "@convex-dev/auth/react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { getCodexLaunchUrl } from "@/lib/codex/handoff"
import { useOrganization } from "@/hooks/use-organization"

function GithubIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  )
}

function AnthropicIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M12 2L4 20h3.5l2-4.5h5l2 4.5H20L12 2zm-1 5.5l1.5 3.5h-3L11 7.5z"/>
    </svg>
  )
}

// ─── GitHub Installation Card ────────────────────────────────────
function GitHubInstallationCard({
  installation,
  onDisconnect,
}: {
  installation: {
    installationId: number
    accountLogin: string
    accountType: string
    accountAvatarUrl?: string
    installedAt: number
  }
  onDisconnect: (installationId: number) => void
}) {
  const [isDisconnecting, setIsDisconnecting] = React.useState(false)

  return (
    <div className="border border-border/60 rounded-[10px] bg-background overflow-hidden group hover:border-border/80 transition-colors">
      <div className="p-4 px-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="size-10 rounded-[8px] border border-border/40">
            {installation.accountAvatarUrl ? (
              <AvatarImage src={installation.accountAvatarUrl} alt={installation.accountLogin} />
            ) : null}
            <AvatarFallback className="rounded-[8px] text-[11px] font-bold bg-muted">
              {installation.accountLogin.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-foreground tracking-tight">
                {installation.accountLogin}
              </span>
              <span className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                <CheckCircle2 className="size-3" />
                Connected
              </span>
            </div>
            <span className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Building2 className="size-3" />
              {installation.accountType} · Installed {new Date(installation.installedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[12px] font-medium gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => window.open(`https://github.com/organizations/${installation.accountLogin}/settings/installations`, '_blank')}
          >
            Manage <ExternalLink className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[12px] font-medium gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-500/10"
            disabled={isDisconnecting}
            onClick={async () => {
              setIsDisconnecting(true)
              await onDisconnect(installation.installationId)
              setIsDisconnecting(false)
            }}
          >
            {isDisconnecting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            Disconnect
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Settings Page ──────────────────────────────────────────
export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { signIn, signOut } = useAuthActions()
  const router = useRouter()
  const searchParams = useSearchParams()

  const user = useQuery(api.users.current)
  const { organization } = useOrganization()

  const installations = useQuery(api.github.getMyInstallations)
  const [isConnectingInstallation, setIsConnectingInstallation] = React.useState(false)
  const [isRefreshingGitHubAccess, setIsRefreshingGitHubAccess] = React.useState(false)
  const handledInstallationId = React.useRef<string | null>(null)

  const saveInstallation = useMutation(api.github.saveInstallation)
  const bootstrapFromInstallation = useMutation(api.organizations.bootstrapFromInstallation)

  React.useEffect(() => {
    const installationIdParam = searchParams.get("installation_id")
    if (!installationIdParam) return
    if (handledInstallationId.current === installationIdParam) return

    handledInstallationId.current = installationIdParam
    setIsConnectingInstallation(true)

    ;(async () => {
      try {
        const response = await fetch(`/api/github/installation/${installationIdParam}`)
        if (!response.ok) {
          throw new Error("Failed to fetch installation details")
        }

        const installation = await response.json()

        await saveInstallation({
          installationId: installation.installationId,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          accountAvatarUrl: installation.accountAvatarUrl,
        })

        await bootstrapFromInstallation({
          installationId: installation.installationId,
          memberUsernames: installation.memberUsernames,
        })

        router.replace("/dashboard/settings")
      } catch (error) {
        console.error("Failed to connect GitHub installation", error)
      } finally {
        setIsConnectingInstallation(false)
      }
    })()
  }, [bootstrapFromInstallation, router, saveInstallation, searchParams])

  // ── Handlers ───────────────────────────────────────────────
  const handleSignOut = async () => {
    await signOut()
    router.push("/")
  }

  const handleInstallApp = () => {
    const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG
    if (!slug) {
      console.error("NEXT_PUBLIC_GITHUB_APP_SLUG is not configured")
      return
    }
    // Redirect to GitHub App installation page
    window.open(
      `https://github.com/apps/${slug}/installations/new`,
      "_self"
    )
  }

  const handleDisconnect = async (installationId: number) => {
    // We now just redirect to GitHub so the user can uninstall it 
    window.open(`https://github.com/settings/installations/${installationId}`, '_blank')
  }

  const handleRefreshGitHubAccess = async () => {
    setIsRefreshingGitHubAccess(true)
    try {
      await signIn("github", { redirectTo: "/dashboard/settings" })
    } catch (error) {
      console.error("Failed to refresh GitHub access", error)
      setIsRefreshingGitHubAccess(false)
    } finally {
      setIsRefreshingGitHubAccess(false)
    }
  }

  const hasInstallations = (installations?.length ?? 0) > 0

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col overflow-hidden text-sm bg-background">
          {/* Main Top Header Navigation */}
          <div className="h-14 flex items-center justify-between px-6 border-b shrink-0 transition-all bg-background/95 backdrop-blur z-20 relative text-sm">
            <div className="flex items-center text-[13px] font-medium text-foreground gap-1.5">
              <SidebarTrigger className="-ml-3 mr-1" />
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-muted-foreground hover:text-foreground">
                <PlayCircle className="size-3.5 fill-blue-500 text-white dark:text-background" /> {organization?.name || "Organization"}
              </Button>
              <ChevronRight className="size-3 text-muted-foreground/40" />
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1.5 text-foreground font-semibold">
                Settings
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><Star className="size-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"><MoreHorizontal className="size-3.5" /></Button>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7 rounded-full text-muted-foreground border-border/60"><Link2 className="size-3.5" /></Button>
            </div>
          </div>

          {/* Settings Canvas Layout */}
          <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/10 [&::-webkit-scrollbar-thumb]:rounded-full bg-muted/20 dark:bg-muted/10 relative">
            <div className="max-w-[700px] mx-auto w-full px-8 py-14 pb-24">
              
              <h1 className="text-3xl font-semibold tracking-tight text-foreground mb-12">
                Settings
              </h1>

              {/* Profile Block */}
              <div className="mb-10">
                <h2 className="text-[17px] font-semibold text-foreground mb-4">Profile</h2>
                <div className="border border-border/60 rounded-[10px] bg-background overflow-hidden relative">
                  
                  {/* Profile Picture */}
                  <div className="flex items-center justify-between p-4 px-5 border-b border-border/40">
                    <span className="text-[13px] font-medium text-foreground">Profile picture</span>
                    <Avatar className="size-8 bg-muted text-foreground border border-border/60">
                      {user?.image ? (
                        <AvatarImage src={user.image} alt={user.name || "User"} />
                      ) : null}
                      <AvatarFallback className="text-[11px] font-bold">
                        {user?.name ? user.name.slice(0, 2).toUpperCase() : "USR"}
                      </AvatarFallback>
                    </Avatar>
                  </div>

                  {/* Email */}
                  <div className="flex items-center justify-between p-4 px-5 border-b border-border/40">
                    <span className="text-[13px] font-medium text-foreground">Email</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] text-foreground font-medium">{user?.email || "No email available"}</span>
                    </div>
                  </div>

                  {/* Full Name */}
                  <div className="flex items-center justify-between p-4 px-5">
                    <span className="text-[13px] font-medium text-foreground">Full name</span>
                    <div className="border border-border/60 rounded-md px-3 py-1.5 text-[13px] font-medium w-[240px] bg-muted/10 text-foreground">
                      {user?.name || "Unknown User"}
                    </div>
                  </div>

                </div>
              </div>

              {/* Workspace Access Block */}
              <div className="mb-8">
                <h2 className="text-[15px] font-semibold text-foreground mb-3">Workspace access</h2>
                <div className="border border-border/60 rounded-[10px] bg-background overflow-hidden p-4 px-5 flex items-center justify-between hover:bg-muted/10 transition-colors">
                  <span className="text-[13px] font-medium text-muted-foreground">Remove yourself from workspace</span>
                  <span className="text-[13px] font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">Leave workspace</span>
                </div>
              </div>

              {/* Session Control Block */}
              <div className="mb-16">
                <div className="border border-border/60 border-red-500/20 rounded-[10px] bg-background overflow-hidden p-4 px-5 flex items-center justify-between hover:bg-red-500/5 transition-colors group">
                  <span className="text-[13px] font-medium text-muted-foreground flex flex-col">
                    <span className="text-foreground group-hover:text-red-500 transition-colors">Active Session</span>
                    Terminate your authenticated access on this device
                  </span>
                  <button 
                    onClick={handleSignOut}
                    className="text-[13px] font-medium text-red-500 hover:text-red-600 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-red-500/10"
                  >
                    <LogOut className="size-3.5" /> Sign out
                  </button>
                </div>
              </div>

              <div className="py-2 mb-12"><Separator className="bg-border/60" /></div>

              {/* Preferences Block */}
              <div className="mb-16">
                <h2 className="text-[17px] font-semibold text-foreground mb-4">Preferences</h2>
                
                <div className="flex flex-col mb-3">
                  <span className="text-[14px] font-semibold text-foreground">Interface theme</span>
                  <span className="text-[13px] text-muted-foreground mt-0.5">Select or customize your UI theme.</span>
                </div>
                
                <div className="border border-border/60 rounded-[10px] bg-background p-3 px-4 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-foreground ml-1">Color mode</span>
                  <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border/60">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setTheme("light")}
                      className={`h-7 text-[12px] px-3 font-medium rounded-md gap-1.5 ${theme === 'light' ? 'bg-background text-foreground border border-border/40' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <Sun className="size-3" /> Light
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setTheme("dark")}
                      className={`h-7 text-[12px] px-3 font-medium rounded-md gap-1.5 ${theme === 'dark' ? 'bg-background text-foreground border border-border/40' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <Moon className="size-3" /> Dark
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setTheme("system")}
                      className={`h-7 text-[12px] px-3 font-medium rounded-md gap-1.5 ${theme === 'system' || !theme ? 'bg-background text-foreground border border-border/40' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <Monitor className="size-3" /> System
                    </Button>
                  </div>
                </div>
              </div>

              <div className="py-2 mb-12"><Separator className="bg-border/60" /></div>

              {/* ═══ Integrations Block ═══ */}
              <div className="mb-12">
                <div className="mb-8">
                  <h2 className="text-[18px] font-semibold text-foreground mb-1.5 tracking-tight">Project Updates & Integrations</h2>
                  <p className="text-[13.5px] text-muted-foreground max-w-2xl leading-relaxed">
                    Short status reports and automated telemetry streams. Connect your external tools to synchronize pull requests and harness cross-platform intelligence.
                  </p>
                </div>

                <div className="flex flex-col gap-8">
                  {/* ── GitHub Connection ── */}
                  <div>
                    <div className="flex flex-col mb-4">
                      <span className="text-[14.5px] font-semibold text-foreground">GitHub Organization</span>
                      <span className="text-[13px] text-muted-foreground mt-1 max-w-xl leading-relaxed">
                        Link an active GitHub organization to authorize cross-repository data sweeping and automatically track pull requests.
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {/* Connected installations */}
                      {hasInstallations && (
                        <div className="flex flex-col gap-3">
                          {(installations ?? []).map((inst) => (
                            <GitHubInstallationCard
                              key={inst.installationId}
                              installation={inst}
                              onDisconnect={handleDisconnect}
                            />
                          ))}
                        </div>
                      )}

                      {/* Connect button */}
                      <div className="border border-dashed border-border/80 rounded-[10px] bg-background overflow-hidden p-4 px-6 flex items-center justify-between group hover:border-border hover:bg-muted/30 transition-all cursor-pointer" onClick={() => {
                        if (!isConnectingInstallation) handleInstallApp()
                      }}>
                        <div className="flex items-center gap-5">
                          <div className="size-11 rounded-[10px] flex items-center justify-center bg-muted/40 border border-border/50">
                            <GithubIcon className="size-5 text-foreground" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[14px] font-semibold text-foreground tracking-tight">
                              {hasInstallations
                                ? "Add another organization"
                                : "Connect a GitHub Organization"}
                            </span>
                            <span className="text-[13px] text-muted-foreground mt-0.5 max-w-sm leading-relaxed">
                              {hasInstallations
                                ? "Install the app on additional GitHub organizations"
                                : "Install the Eganow Dev app to sync repos and issues"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="pointer-events-none text-muted-foreground gap-1.5"
                          >
                            {isConnectingInstallation ? "Connecting" : hasInstallations ? "Add" : "Connect"} {isConnectingInstallation ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpRight className="size-3.5" />}
                          </Button>
                        </div>
                      </div>

                      {!hasInstallations && (
                        <div className="border border-border/60 rounded-[10px] bg-background p-4 px-5">
                          <div className="flex flex-col gap-1">
                            <span className="text-[13px] font-semibold text-foreground">
                              Already in a connected organization?
                            </span>
                            <span className="text-[12px] text-muted-foreground leading-relaxed">
                              Refresh your GitHub access and we’ll automatically attach you to any organization where the app is already installed.
                            </span>
                          </div>

                          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-[12px] text-muted-foreground">
                              Use this if a teammate already installed the GitHub app for your org.
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isRefreshingGitHubAccess}
                              onClick={() => void handleRefreshGitHubAccess()}
                              className="h-9 text-[12px] gap-1.5"
                            >
                              {isRefreshingGitHubAccess ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3.5" />
                              )}
                              Refresh GitHub access
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Claude Connection ── */}
                  <Separator className="bg-border/60" />

           

                  <Separator className="bg-border/60" />

                  <div>
                    <div className="flex flex-col mb-4">
                      <span className="text-[14.5px] font-semibold text-foreground">Claude Intelligence</span>
                      <span className="text-[13px] text-muted-foreground mt-1 max-w-xl leading-relaxed">
                        Enable contextual AI summaries for pull-requests and active agentic issue resolutions powered by Anthropic.
                      </span>
                    </div>

                    <ClaudeSettingsCard />
                  </div>
                </div>
              </div>
              
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// ─── Claude Settings Card ──────────────────────────────────────
function CodexSettingsCard() {
  const handleOpenCodex = () => {
    window.open(getCodexLaunchUrl(), "_blank", "noopener,noreferrer")
  }

  const handleOpenGitHubSetup = () => {
    window.open(
      "https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt",
      "_blank",
      "noopener,noreferrer"
    )
  }

  return (
    <div className="border border-border/60 rounded-[10px] bg-background overflow-hidden">
      <div className="p-4 px-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="size-11 rounded-[10px] flex items-center justify-center bg-muted/40 border border-border/50">
              <Image
                src="/codex logo.png"
                alt="Codex logo"
                width={22}
                height={22}
                className="h-[22px] w-[22px] object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[14px] font-semibold text-foreground tracking-tight">
                Use Codex in ChatGPT
              </span>
              <span className="text-[13px] text-muted-foreground mt-0.5 max-w-xl leading-relaxed">
                Codex access is managed in ChatGPT. Users connect GitHub to
                ChatGPT there, then use this app to prepare issue context and
                follow pull requests back through GitHub sync.
              </span>
            </div>
          </div>
          <div className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            Hosted in ChatGPT
          </div>
        </div>

        <div className="rounded-[12px] border border-border/60 bg-muted/10 p-4">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Recommended setup
          </div>
          <div className="mt-3 flex flex-col gap-2 text-[13px] leading-6 text-muted-foreground">
            <p>1. Open ChatGPT and go to Settings, then Apps.</p>
            <p>2. Connect GitHub in ChatGPT and approve the repositories Codex should use.</p>
            <p>3. Open an issue in this app, use the Codex Agent tab, and launch the prepared brief into Codex.</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[12px] text-muted-foreground leading-relaxed">
            This app does not perform Codex OAuth directly and cannot verify ChatGPT GitHub access from here.
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenGitHubSetup}
              className="text-muted-foreground gap-1.5"
            >
              GitHub setup guide <ExternalLink className="size-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={handleOpenCodex}
              className="gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            >
              Open Codex <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClaudeSettingsCard() {
  const aiSettings = useQuery(api.aiReviews.getMySettings)
  const saveSettings = useMutation(api.aiReviews.saveAISettings)
  const clearKey = useMutation(api.aiReviews.clearAnthropicKey)
  const [apiKey, setApiKey] = React.useState("")
  const [showKey, setShowKey] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [selectedProvider, setSelectedProvider] = React.useState<"groq" | "anthropic">("groq")

  const isConnected = aiSettings?.hasAnthropicKey
  const preferredProvider = aiSettings?.preferredProvider || "groq"

  React.useEffect(() => {
    setSelectedProvider(preferredProvider)
  }, [preferredProvider])

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      await saveSettings({
        anthropicApiKey: apiKey,
        preferredProvider: selectedProvider,
      })
      setApiKey("")
      setShowKey(false)
    } catch {
      // error handled by Convex
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setClearing(true)
    try {
      await clearKey()
      setSelectedProvider("groq")
    } catch {
      // error handled by Convex
    } finally {
      setClearing(false)
    }
  }

  const handleProviderChange = async (provider: "groq" | "anthropic") => {
    if (provider === "anthropic" && !isConnected) {
      setSelectedProvider(provider)
      return
    }

    setSelectedProvider(provider)
    setSaving(true)
    try {
      await saveSettings({ preferredProvider: provider })
    } catch {
      setSelectedProvider(preferredProvider)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-border/60 rounded-[10px] bg-background overflow-hidden">
      <div className="p-4 px-6 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className={`size-11 rounded-[10px] flex items-center justify-center border ${
            isConnected ? "bg-emerald-500/10 border-emerald-500/20" : "bg-amber-500/10 border-amber-500/20"
          }`}>
            <AnthropicIcon className={`size-8 ${isConnected ? "text-emerald-600" : "text-amber-600"}`} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-foreground tracking-tight">Anthropic API Key</span>
              {isConnected && (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-[1px] rounded-full bg-emerald-500/10 text-emerald-600 font-semibold uppercase tracking-wider">
                  <CheckCircle2 className="size-3" /> Connected
                </span>
              )}
            </div>
            <span className="text-[13px] text-muted-foreground mt-0.5 max-w-[400px] leading-relaxed">
              {isConnected
                ? "Claude is available for reviews, but Groq stays the default until you switch providers."
                : "Attach a direct API key to make Claude available as an optional provider."}
            </span>
          </div>
        </div>
        {isConnected && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={clearing}
            className="text-red-500 hover:text-red-600 border-red-500/20 hover:border-red-500/40 gap-1.5 text-[12px]"
          >
            {clearing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            Disconnect
          </Button>
        )}
      </div>
      <div className="px-6 pb-5 pt-1 space-y-4">
        <div className="rounded-[12px] border border-border/60 bg-muted/10 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-foreground">Default review model</span>
              <span className="text-[12px] text-muted-foreground mt-0.5">
                Pick the provider new reviews should use. Groq remains the safe default.
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-background p-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleProviderChange("groq")}
                disabled={saving}
                className={`h-8 rounded-lg px-3 text-[12px] font-medium shadow-none ${
                  selectedProvider === "groq"
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="size-3.5" />
                Groq
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleProviderChange("anthropic")}
                disabled={saving}
                className={`h-8 rounded-lg px-3 text-[12px] font-medium shadow-none ${
                  selectedProvider === "anthropic"
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Bot className="size-3.5" />
                Claude
              </Button>
            </div>
          </div>
          {selectedProvider === "anthropic" && !isConnected && (
            <p className="mt-3 text-[11px] text-amber-600">
              Add an Anthropic key below before Claude can be used for new reviews.
            </p>
          )}
        </div>

      {!isConnected && (
          <div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="w-full h-9 pl-9 pr-9 rounded-lg border border-border/60 bg-muted/20 text-[13px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#5e6ad2]/50 transition-colors"
              />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <Button
              onClick={handleSave}
              disabled={saving || !apiKey.trim()}
              size="sm"
              className="h-9 bg-[#5e6ad2] hover:bg-[#5e6ad2]/90 text-white text-[12px] font-medium shadow-none gap-1.5 px-4"
            >
              {saving ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
              Save Claude Key
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-2 leading-relaxed">
            Your key is encrypted with AES-256-GCM before storage. It is never exposed to the client, and saving it does not change the default provider unless you choose Claude above.
          </p>
          </div>
      )}
      </div>
    </div>
  )
}
