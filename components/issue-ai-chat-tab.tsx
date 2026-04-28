"use client"

import * as React from "react"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowUp,
  Bot,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  Wrench,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { AutoGrowTextarea } from "@/components/auto-grow-textarea"
import { Button } from "@/components/ui/button"

type IssueAiChatTabProps = {
  issueId: Id<"issues">
  issueTitle: string
  issueIdentifier: string
  issueBody?: string
  issueGithubNumber?: number
  issueGithubUrl?: string
  issueGithubRepoFullName?: string
  projectName?: string
  projectGithubRepoFullNames?: string[]
  organizationHasGitHubInstallation?: boolean
  chatInput: string
  setChatInput: (value: string) => void
}

const quickActions = [
  {
    key: "fix-issue",
    label: "Fix issue",
    icon: Wrench,
    taskType: "turn" as const,
    prompt:
      "Fix this issue in the linked repository. Inspect the codebase, make the required changes, verify them where appropriate, and when the work is ready, request pull request publication through the Eganow publish tool.",
  },
  {
    key: "review-issue",
    label: "Review issue",
    icon: FileText,
    taskType: "turn" as const,
    prompt:
      "Review this issue and give me the key issue information. Summarize what the issue is asking for, point out the likely files involved, and outline a safe implementation approach before making changes.",
  },
] as const

function statusLabel(status?: string) {
  switch (status) {
    case "starting":
      return "Starting"
    case "active":
      return "Running"
    case "waiting_for_user":
      return "Ready"
    case "waiting_for_approval":
      return "Needs approval"
    case "publishing":
      return "Publishing"
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
    case "closed":
      return "Closed"
    default:
      return "Idle"
  }
}

function statusTone(status?: string) {
  switch (status) {
    case "active":
    case "publishing":
      return "bg-amber-500/10 text-amber-600 border-amber-500/20"
    case "waiting_for_user":
    case "completed":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
    case "failed":
      return "bg-red-500/10 text-red-600 border-red-500/20"
    default:
      return "bg-muted/40 text-muted-foreground border-border/50"
  }
}

export function IssueAiChatTab({
  issueId,
  issueTitle,
  issueIdentifier,
  issueBody,
  issueGithubNumber,
  issueGithubUrl,
  issueGithubRepoFullName,
  projectName,
  projectGithubRepoFullNames,
  organizationHasGitHubInstallation,
  chatInput,
  setChatInput,
}: IssueAiChatTabProps) {
  const [isSending, setIsSending] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  const [isStopping, setIsStopping] = React.useState(false)
  const [resolvingApprovalId, setResolvingApprovalId] = React.useState<string | null>(
    null
  )
  const createOrReuseSession = useMutation(api.issueAgents.createOrReuseSession)
  const resetSessionForIssue = useMutation(api.issueAgents.resetSessionForIssue)
  const stopActiveRun = useMutation(api.issueAgents.stopActiveRun)
  const sendAndEnqueue = useMutation(api.issueAgents.sendAndEnqueue)
  const resolveApproval = useMutation(api.issueAgents.resolveApproval)

  const session = useQuery(api.issueAgents.getLatestSessionByIssue, { issueId })
  const messages = useQuery(
    api.issueAgents.listMessagesBySession,
    session ? { sessionId: session._id } : "skip"
  )
  const workspace = useQuery(
    api.issueAgents.getWorkspaceBySession,
    session ? { sessionId: session._id } : "skip"
  )
  const approvals = useQuery(
    api.issueAgents.listApprovalsBySession,
    session ? { sessionId: session._id } : "skip"
  )

  const resolvedRepo =
    issueGithubRepoFullName ||
    (projectGithubRepoFullNames?.length === 1
      ? projectGithubRepoFullNames[0]
      : undefined)

  const canUseAgent = Boolean(organizationHasGitHubInstallation && resolvedRepo)
  const canStopRun =
    session?.status === "active" || session?.status === "starting"
  const pendingApproval =
    approvals?.find((approval) => approval.status === "pending") ?? null

  const handleSend = async (
    messageOverride?: string,
    taskTypeOverride?: "turn" | "publish"
  ) => {
    const trimmedMessage = (messageOverride ?? chatInput).trim()
    if (!trimmedMessage) return

    setIsSending(true)
    try {
      const sessionId =
        !session || ["completed", "failed", "closed"].includes(session.status)
          ? await createOrReuseSession({ issueId })
          : session._id

      await sendAndEnqueue({
        sessionId,
        content: trimmedMessage,
        taskType: taskTypeOverride ?? "turn",
        prompt: trimmedMessage,
      })

      if (messageOverride === undefined) {
        setChatInput("")
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send issue agent message"
      )
    } finally {
      setIsSending(false)
    }
  }

  const handleClearChat = async () => {
    setIsClearing(true)
    try {
      await resetSessionForIssue({ issueId })
      setChatInput("")
      toast.success("Started a fresh issue agent chat")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to clear issue agent chat"
      )
    } finally {
      setIsClearing(false)
    }
  }

  const handleStopRun = async () => {
    if (!session) return

    setIsStopping(true)
    try {
      const result = await stopActiveRun({ sessionId: session._id })
      if (result.stopped) {
        toast.success("Stopped the current Claude run")
      } else {
        toast.error("There is no active Claude run to stop")
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to stop the current Claude run"
      )
    } finally {
      setIsStopping(false)
    }
  }

  const handleApprovalDecision = async (
    approvalId: string,
    decision: "approved" | "denied"
  ) => {
    setResolvingApprovalId(approvalId)
    try {
      await resolveApproval({
        approvalId: approvalId as Id<"issueAgentApprovals">,
        decision,
      })
      toast.success(
        decision === "approved"
          ? "Publishing approved"
          : "Publishing request denied"
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to resolve approval"
      )
    } finally {
      setResolvingApprovalId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-6 py-10 sm:px-10 sm:py-14">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/[0.05] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Bot className="size-3.5" />
              Claude Agent
            </div>
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${statusTone(session?.status)}`}
            >
              {isSending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Bot className="size-3" />
              )}
              {statusLabel(isSending ? "active" : session?.status)}
            </div>
            {resolvedRepo && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/80 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                <GitBranch className="size-3" />
                {resolvedRepo}
              </div>
            )}
            {workspace?.branchName && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/80 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                {workspace.branchName}
              </div>
            )}
            {session?.githubPrUrl && (
              <a
                href={session.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/15"
              >
                PR #{session.githubPrNumber}
                <ExternalLink className="size-3" />
              </a>
            )}
            <Button
              type="button"
              variant="ghost"
              className="h-8 rounded-full border border-white/15 bg-white/[0.04] px-3 text-[11px] font-medium text-white/90 hover:bg-white/[0.08]"
              onClick={() => void handleClearChat()}
              disabled={!session || isSending || isClearing || isStopping}
            >
              {isClearing ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 size-3" />
              )}
              Clear chat
            </Button>
          </div>

          {messages && messages.length > 0 ? (
            <div className="flex flex-1 flex-col gap-4 pb-10">
              {messages.map((message) => {
                const isUser = message.role === "user"
                const isTool = message.role === "tool"
                const isSystem = message.role === "system"

                return (
                  <div
                    key={message._id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[760px] rounded-[22px] border px-4 py-3 ${
                        isUser
                          ? "border-foreground/10 bg-foreground text-background"
                          : isTool
                            ? "border-border/50 bg-muted/[0.06] text-muted-foreground"
                            : isSystem
                              ? "border-amber-500/15 bg-amber-500/5 text-muted-foreground"
                              : "border-border/60 bg-background text-foreground"
                      }`}
                    >
                      {!isUser && (
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
                          {isTool ? "Tool" : isSystem ? "System" : "Claude"}
                        </div>
                      )}
                      {isUser || isTool || isSystem ? (
                        <div className="whitespace-pre-wrap text-[13px] leading-6">
                          {message.content}
                        </div>
                      ) : (
                        <div className="prose prose-sm max-w-none text-[13px] leading-6 dark:prose-invert">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {pendingApproval && (
                <div className="flex justify-start">
                  <div className="max-w-[760px] rounded-[22px] border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-foreground">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700/80 dark:text-amber-300/80">
                      Approval Required
                    </div>
                    <p className="text-[13px] leading-6 text-muted-foreground">
                      {pendingApproval.reason ||
                        "Claude is ready to publish a pull request for this issue."}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-full bg-foreground px-4 text-[11px] text-background hover:bg-foreground/85"
                        disabled={Boolean(resolvingApprovalId)}
                        onClick={() =>
                          void handleApprovalDecision(
                            pendingApproval._id,
                            "approved"
                          )
                        }
                      >
                        {resolvingApprovalId === pendingApproval._id ? (
                          <Loader2 className="mr-1.5 size-3 animate-spin" />
                        ) : null}
                        Approve publish
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 rounded-full border border-border/60 px-4 text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
                        disabled={Boolean(resolvingApprovalId)}
                        onClick={() =>
                          void handleApprovalDecision(
                            pendingApproval._id,
                            "denied"
                          )
                        }
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="flex size-[4.5rem] items-center justify-center rounded-full border border-border/50 bg-muted/[0.06] shadow-[0_0_0_10px_rgba(255,255,255,0.02)]">
                <Bot className="size-8 text-foreground/90" strokeWidth={1.8} />
              </div>

              <div className="mt-8 text-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/[0.05] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Bot className="size-3.5" />
                  Claude Agent
                </div>
                <h2 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Claude Agent
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
                  Use this tab to ask Claude to work on the issue, make code changes in a dedicated branch, and get everything ready for a pull request.
                </p>
                <p className="mx-auto mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground/80">
                  {issueIdentifier} · {issueTitle}
                </p>
                {projectName && (
                  <p className="mx-auto mt-2 max-w-2xl text-[12px] leading-6 text-muted-foreground/70">
                    Project: {projectName}
                  </p>
                )}
                {!organizationHasGitHubInstallation && (
                  <p className="mx-auto mt-4 max-w-xl text-[12px] leading-6 text-amber-600">
                    Connect a GitHub organization in Settings before starting an issue agent session.
                  </p>
                )}
                {organizationHasGitHubInstallation &&
                  !resolvedRepo &&
                  projectGithubRepoFullNames &&
                  projectGithubRepoFullNames.length > 1 && (
                    <p className="mx-auto mt-4 max-w-xl text-[12px] leading-6 text-amber-600">
                      This issue&apos;s project maps to multiple repositories. Repo selection has not been implemented yet.
                    </p>
                  )}
                {organizationHasGitHubInstallation &&
                  !resolvedRepo &&
                  (!projectGithubRepoFullNames ||
                    projectGithubRepoFullNames.length === 0) && (
                    <p className="mx-auto mt-4 max-w-xl text-[12px] leading-6 text-amber-600">
                      Link a GitHub repository to this issue or project before starting the issue agent.
                    </p>
                  )}
                {issueBody && (
                  <div className="mx-auto mt-6 max-w-[760px] rounded-[20px] border border-border/60 bg-background/80 p-4 text-left text-[12.5px] leading-6 text-muted-foreground">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                      Issue Context
                    </div>
                    <div className="whitespace-pre-wrap">{issueBody}</div>
                  </div>
                )}
                {issueGithubUrl && (
                  <a
                    href={issueGithubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    GitHub issue
                    {typeof issueGithubNumber === "number"
                      ? ` #${issueGithubNumber}`
                      : ""}
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto w-full max-w-[920px]">
          <div className="overflow-hidden rounded-[26px] border border-border/70 bg-muted/[0.05] shadow-sm transition-colors focus-within:border-border dark:border-white/20 dark:bg-white/[0.03] dark:focus-within:border-white/30">
            <div className="px-4 pt-3">
              <AutoGrowTextarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                minHeight={68}
                placeholder={
                  canUseAgent
                    ? "Tell Claude what you want changed..."
                    : "Connect GitHub and link a repository before using the issue agent..."
                }
                className="w-full resize-none border-none bg-transparent px-1 text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    if (!isSending && !isStopping && !canStopRun && canUseAgent) {
                      void handleSend()
                    }
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {quickActions.map((action) => {
                  const Icon = action.icon

                  return (
                    <Button
                      key={action.key}
                      type="button"
                      variant="ghost"
                      className="h-7 rounded-full border border-border/50 bg-background/80 px-3 text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
                      onClick={() => void handleSend(action.prompt, action.taskType)}
                      disabled={!canUseAgent || isSending || isClearing || isStopping}
                    >
                      <Icon className="mr-1.5 size-3.5" />
                      {action.label}
                    </Button>
                  )
                })}
                <div className="hidden rounded-full border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:block">
                  Enter to send • Shift + Enter for newline
                </div>
              </div>

              <div className="flex items-center gap-1 sm:gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-full text-muted-foreground hover:bg-muted/60"
                  disabled
                >
                  <Mic className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  className="size-7 rounded-full bg-foreground text-background shadow-none hover:bg-foreground/85"
                  aria-label={canStopRun ? "Stop Claude" : "Send message"}
                  onClick={() =>
                    canStopRun ? void handleStopRun() : void handleSend()
                  }
                  disabled={
                    canStopRun
                      ? isStopping
                      : isSending ||
                        isClearing ||
                        isStopping ||
                        !chatInput.trim() ||
                        !canUseAgent
                  }
                >
                  {canStopRun ? (
                    isStopping ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Square className="size-3.5" />
                    )
                  ) : isSending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
