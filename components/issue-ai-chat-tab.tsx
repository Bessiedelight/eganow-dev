"use client"

import * as React from "react"
import { ArrowUp, Bot, Mic, Plus } from "lucide-react"

import { AutoGrowTextarea } from "@/components/auto-grow-textarea"
import { Button } from "@/components/ui/button"

type IssueAiChatTabProps = {
  issueTitle: string
  issueIdentifier: string
  chatInput: string
  setChatInput: (value: string) => void
}

export function IssueAiChatTab({
  issueTitle,
  issueIdentifier,
  chatInput,
  setChatInput,
}: IssueAiChatTabProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-6 py-10 sm:px-10 sm:py-14">
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="flex size-[4.5rem] items-center justify-center rounded-full border border-border/50 bg-muted/[0.06] shadow-[0_0_0_10px_rgba(255,255,255,0.02)]">
              <Bot className="size-8 text-foreground/90" strokeWidth={1.8} />
            </div>

            <div className="mt-8 text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/[0.05] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <Bot className="size-3.5" />
                Codex Agent
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Codex Agent
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
                Powered by GPT-5.4 Codex to fix this GitHub issue and prepare a pull request.
              </p>
              <p className="mx-auto mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground/80">
                {issueIdentifier} · {issueTitle}
              </p>
            </div>
          </div>
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
                placeholder="Tell Codex Agent what you want changed..."
                className="w-full resize-none border-none bg-transparent px-1 text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </div>

            <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
              <div className="flex items-center gap-1 sm:gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-full text-muted-foreground hover:bg-muted/60"
                >
                  <Plus className="size-3.5" />
                </Button>
                <div className="rounded-full border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  Codex Agent
                </div>
                <div className="hidden rounded-full border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:block">
                  UI preview
                </div>
              </div>

              <div className="flex items-center gap-1 sm:gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-full text-muted-foreground hover:bg-muted/60"
                >
                  <Mic className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  className="size-7 rounded-full bg-foreground text-background shadow-none hover:bg-foreground/85"
                  aria-label="Send message"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
