# PR Review Orchestration Implementation Plan

## Goal

Build a new review orchestration for the `Review` tab inside `app/dashboard/pulls/[pullId]/page.tsx` that:

- runs reliably from GitHub PR events and manual triggers,
- uses Groq by default,
- allows Anthropic/Claude when a user adds a key in Settings,
- writes review results back into the existing review experience,
- and does not disturb issues, projects, teams, pull syncing, or other non-review sections.

This plan is intentionally scoped to code review orchestration only.

---

## What Exists Today In `co-work`

### 1. The review tab UI already exists, but its data layer is mostly stubbed

The `Review` tab in `app/dashboard/pulls/[pullId]/page.tsx` already has UI blocks for:

- normalized review hub state,
- app-level PR summary generation,
- in-progress checkpoints,
- failed/completed review states,
- follow-up chat.

But the critical values are currently placeholders:

- `aiReview`,
- `reviewHub`,
- `filteredReviewThreads`,
- `selectedReviewThread`,
- `handleTriggerReview`,
- `handleRefreshReviews`,
- `handleSendChat`.

So the page is visually ready, but the new orchestration still needs to power it.

### 2. There is already a first-generation app AI review pipeline

Current app review logic lives in:

- `convex/aiReviews.ts`
- `convex/aiReviewActions.ts`
- `lib/ai/pr-review-executor.ts`
- `lib/ai/pr-context-builder.ts`
- `lib/ai/llm-provider.ts`
- `lib/ai/pr-review-prompts.ts`

That pipeline is:

- Convex-scheduled,
- manual-step based,
- Groq/Anthropic capable,
- checkpointed into Convex,
- focused on a synthesized summary more than a full multi-agent review system.

It is useful as reference, but it is not the orchestration you now want.

### 3. The normalized review data model is already a strong base

You already have these tables in `convex/schema.ts`:

- `prReviewRuns`
- `prReviewThreads`
- `prReviewComments`

And you already sync GitHub/Copilot review artifacts into them via:

- `convex/prReviews.ts`
- `lib/github/review-actions.ts`
- `lib/github/handlers/pull-request.ts`

This is important because the new orchestration should plug into this normalized review layer instead of inventing a second review hub.

### 4. GitHub webhook verification and PR syncing already work

Relevant files:

- `app/api/github/webhooks/route.ts`
- `lib/github/webhooks.ts`
- `lib/github/handlers/pull-request.ts`

Your webhook route already:

- reads raw request text,
- uses `@octokit/webhooks`,
- verifies the signature,
- dispatches events to handlers.

That means the new orchestration should extend the existing PR webhook flow, not replace it.

### 5. Anthropic key storage already exists, but the default behavior is wrong for your new requirement

Relevant files:

- `app/dashboard/settings/page.tsx`
- `convex/aiReviews.ts`
- `convex/aiReviewActions.ts`
- `lib/ai/crypto.ts`

Right now:

- users can save an Anthropic key,
- the key is encrypted,
- saving the key sets `preferredProvider: "anthropic"`.

Your new requirement is different:

- Groq must remain the default,
- Anthropic must be available as an optional provider,
- adding a Claude key should not silently switch the app to Claude.

That behavior must be corrected as part of the orchestration rollout.

---

## What I Learned From `kron-hr-main`

The second repo shows a consistent implementation style that is worth reusing:

### Proven patterns you already use well

- BullMQ queues and workers with clean queue helpers.
- Redis separated into transport/status/throttling responsibilities.
- Worker reuse and health checks for hot reload safety.
- Idempotent assembly/finalization guarded by locks or dedup.
- Explicit status tracking outside the main request path.
- LLM provider injection/abstraction instead of hard-coding one client.
- Request spreading/throttling to protect external APIs.

### The most relevant files for style and structure

- `lib/hr-audit-queue.ts`
- `lib/handbook/handbook-queue.ts`
- `lib/handbook/handbook-status.ts`
- `lib/queue.ts`
- `lib/redis-utils.ts`
- `lib/hr-manual-llm-provider.ts`
- `lib/hr-manual-request-coordinator.ts`
- `workers/hr-manual-worker.ts`

### Important interpretation

`kron-hr-main` includes LangGraph, but in practice the code there leans more heavily on:

- explicit orchestration,
- queues,
- workers,
- request coordination,
- and status persistence.

For `co-work`, that is good news. We can borrow the parts you clearly execute well already, while using LangGraph only where it provides real value: routing, checkpointing, and parallel agent fan-out.

---

## Recommended Architecture For `co-work`

## Core design

Use a dedicated review orchestration slice with five layers:

1. GitHub webhook ingest
2. Convex persistence + enqueue request
3. BullMQ worker execution
4. LangGraph orchestration
5. Result persistence + GitHub review posting

## Keep the blast radius small

Do not rebuild general GitHub syncing.

Do not move existing pull/issue/project/team logic.

Do not make the review tab depend on other product sections.

Instead:

- keep GitHub syncing where it is,
- add a dedicated orchestration boundary for review work,
- write app-generated review output into the existing normalized review tables.

---

## Canonical Data Strategy

## Source of truth for the review tab

Make these the canonical source of review-tab thread data:

- `prReviewRuns`
- `prReviewThreads`
- `prReviewComments`

Use `source: "app_ai"` for orchestrated app reviews.

This gives you one unified review hub for:

- GitHub human review,
- GitHub Copilot review,
- your new app review orchestration.

## Keep orchestration execution state separate

Add a new execution-oriented table family instead of overloading `aiReviews`:

- `reviewOrchestrationRuns`
- `reviewAgentFindings`
- optional `reviewOrchestrationEvents`

Why:

- `prReview*` is the normalized product-facing review record,
- orchestration state is operational,
- mixing them makes retries, resumption, and observability messy.

### Suggested table responsibilities

`reviewOrchestrationRuns`

- organizationId
- pullRequestId
- repoFullName
- prNumber
- headSha
- provider
- triggerSource (`webhook` | `manual`)
- queueJobId
- langGraphThreadId
- status (`queued` | `fetching` | `triaging` | `running_agents` | `synthesizing` | `posting` | `completed` | `failed` | `superseded`)
- activeAgents
- summary
- error
- metrics
- createdAt
- updatedAt

`reviewAgentFindings`

- orchestrationRunId
- agentName
- findingKey
- severity
- path
- line info
- title
- body
- confidence
- metadata

This separation lets the UI show orchestration progress without polluting the normalized review artifacts.

---

## Webhook And Queue Design

## Keep the existing webhook verification

Do not replace the current verification strategy in `app/api/github/webhooks/route.ts`.

Keep:

- raw body handling,
- `@octokit/webhooks`,
- signature verification,
- event dispatch through `lib/github/webhooks.ts`.

That already aligns with GitHub’s current webhook guidance.

## Add orchestration enqueueing inside pull request handlers

Extend the existing pull-request lifecycle handlers in `lib/github/handlers/pull-request.ts` so that after PR sync succeeds, we enqueue orchestration work for these actions:

- `opened`
- `synchronize`
- `reopened`
- `ready_for_review`

For draft PRs:

- enqueue at lower priority,
- do not skip entirely.

That matches your target behavior while keeping the rest of the webhook flow intact.

## Important correction to the draft design

Do not assume BullMQ `jobId` replaces an existing pending job.

Current BullMQ docs say:

- duplicate `jobId` jobs are ignored,
- they are not automatically replaced.

So for “latest push wins” behavior, use one of these patterns:

### Preferred

BullMQ deduplication with a stable dedup id per PR and latest-head behavior:

- `deduplication.id = pr:{repoId}:{prNumber}`
- use debounce-style replacement for delayed jobs,
- or `keepLastIfActive` if you want one active run plus one queued latest run.

### Also required

Always stale-check inside the worker before doing expensive review work:

- compare queued `headSha` with the current PR `headSha`,
- mark the run `superseded` and stop if it is no longer current.

This is safer than relying on queue semantics alone.

---

## BullMQ / Worker Topology

## Add a dedicated review queue module

Create a review queue module modeled after the stronger `kron-hr-main` queue files.

Suggested files:

- `lib/review-orchestration/review-queue.ts`
- `lib/review-orchestration/review-worker.ts`
- `lib/review-orchestration/review-status.ts`
- `workers/pr-review-worker.ts`

## Worker deployment model

Run the BullMQ worker in a persistent Node runtime, not inside the request lifecycle.

That can be:

- a dedicated worker process,
- a sidecar service,
- or another always-on runtime alongside the Next app.

The existing `kron-hr-main/workers/hr-manual-worker.ts` pattern is the closest fit.

## Queue settings

Start conservative:

- worker concurrency: `3`
- per-repo concurrency: `1`
- global limiter enabled
- retries: `3`
- exponential backoff

Then tune upward only after observing Groq, GitHub, and Redis behavior in production.

## Redis usage split

Use Upstash Redis for:

- BullMQ queue transport,
- LangGraph checkpoint persistence,
- short-lived caching,
- optional rate-limit coordination,
- optional coarse worker locks.

Do not use Convex as the step-by-step orchestration engine for this new system.
Use Convex as the product data store and UI-facing state layer.

---

## LangGraph Design

## The graph should be real, not cosmetic

Unlike the partial/manual LangGraph usage in `kron-hr-main`, use actual LangGraph compilation and persistence here.

Suggested node flow:

1. `fetch_pr_data`
2. `triage_router`
3. `run_specialists`
4. `synthesize_review`
5. `persist_and_post`

## State shape

Suggested graph state:

- PR metadata
- head/base SHA
- changed files
- diff chunks
- repo context
- active agent list
- per-agent findings
- merged findings
- final verdict
- GitHub posting payload
- metrics

## Checkpointing

Compile with Redis-backed checkpointer and a stable `thread_id`, for example:

- `pr-review:{pullRequestId}:{headSha}`

This gives you:

- crash recovery,
- replay/debuggability,
- resumable orchestration,
- cleaner operational traces than the current Convex-only step chain.

## Agent routing

Start with four specialists:

- `security`
- `code_quality`
- `test_coverage`
- `architecture`

Suggested routing heuristics:

- docs-only/config-only/test-fixture-only PRs: skip heavy agents
- auth/crypto/secrets/config access paths: include security
- API surface/schema/public contract changes: include architecture
- missing or modified tests around logic changes: include test_coverage
- default include code_quality for most code PRs

Use a small triage model or deterministic heuristics first, then optionally add model-assisted routing.

My recommendation:

- keep a cheap heuristic pre-pass,
- use model triage only when the PR is ambiguous.

That will be more reliable and cheaper than making every PR classification purely LLM-driven.

---

## Parallel Agents

## Fan out with isolation

Run specialist agents in parallel.

Use one failure-isolated branch per agent so that:

- one broken agent does not fail the whole review,
- degraded reviews still complete,
- run metrics capture which agent failed.

## Output format

Force every specialist to return structured JSON with:

- finding key
- title
- body
- severity
- confidence
- path
- line anchors
- rationale
- optional remediation

This is essential for deduplication and ranking later.

## Selective context expansion

Do not use always-on RAG in v1.

Use context expansion only when needed:

- `architecture`: yes, usually
- `security`: only when sensitive paths/patterns are touched
- `code_quality`: only when a finding depends on surrounding code
- `test_coverage`: only when test intent needs surrounding fixtures/helpers

This aligns with your goal to stay effective without overengineering.

---

## Diff And Token Strategy

## Diff preparation

Before the graph runs specialists:

- fetch changed files only,
- normalize patches,
- strip unrelated context when safe,
- compute chunk boundaries by file/hunk,
- drop binary/generated/vendor files from LLM review.

## Large PR strategy

When PRs exceed a threshold, for example:

- more than `500` changed lines, or
- more than `20` changed files,

switch to chunked review:

- chunk by file or file group,
- run specialists per chunk,
- merge chunk findings before synthesis.

## Anchor safety

Every finding must carry enough anchor metadata to survive posting:

- path
- side
- line
- optional start line
- commit SHA reviewed

If a finding cannot be safely anchored, downgrade it to:

- summary-only,
- or file-level/general review comment.

This prevents invalid GitHub review comment submissions.

---

## GitHub Posting Strategy

## Post one coherent review per head SHA

For each completed orchestration run:

- check whether the app already posted a review for the same `headSha`,
- if yes, update internal records and skip duplicate posting,
- if not, create one review with summary body plus inline comments.

## Posting rules

- `REQUEST_CHANGES` only when severity threshold is crossed
- otherwise `COMMENT`
- optionally support `APPROVE` later, but not in v1

## Line-comment safety

Use the latest PR head SHA when posting.

Validate anchors against the latest diff before submission.

If validation fails:

- keep the finding in your internal review hub,
- omit the invalid inline comment from GitHub,
- include it in the summary instead.

This avoids brittle failures when lines move between queue time and post time.

---

## Provider Strategy

## Groq remains the default

Groq should be the system default across:

- webhook-triggered reviews,
- manual “run review” actions,
- follow-up review conversations unless explicitly overridden.

## Anthropic support

Anthropic should be enabled only when:

- the user has stored a valid key,
- and the user or org explicitly selects Anthropic.

## Required settings changes

### Settings UI

Update `app/dashboard/settings/page.tsx` so that:

- saving an Anthropic key does not auto-switch provider,
- provider selection is explicit,
- Groq is shown as the default provider,
- Claude is shown as optional/available when a key exists.

### Convex mutations

Update `convex/aiReviews.ts` so that:

- `saveAISettings` stores the key without automatically forcing Anthropic,
- `preferredProvider` remains `groq` unless deliberately changed,
- any legacy UI copy that says “Claude by default” is corrected.

## Provider abstraction

Keep the adapter pattern from `lib/ai/llm-provider.ts`, but move orchestration-specific selection into a new review-orchestration provider module so this rollout does not break the legacy app-summary path.

---

## Recommended File Layout

## New files

- `lib/review-orchestration/types.ts`
- `lib/review-orchestration/review-queue.ts`
- `lib/review-orchestration/review-worker.ts`
- `lib/review-orchestration/review-graph.ts`
- `lib/review-orchestration/review-state.ts`
- `lib/review-orchestration/review-triage.ts`
- `lib/review-orchestration/review-context.ts`
- `lib/review-orchestration/review-synthesizer.ts`
- `lib/review-orchestration/agents/security.ts`
- `lib/review-orchestration/agents/code-quality.ts`
- `lib/review-orchestration/agents/test-coverage.ts`
- `lib/review-orchestration/agents/architecture.ts`
- `lib/review-orchestration/github-review-poster.ts`
- `lib/review-orchestration/diff-anchor.ts`
- `lib/review-orchestration/cache.ts`
- `workers/pr-review-worker.ts`

## Convex additions

- `convex/reviewOrchestration.ts`
- `convex/reviewOrchestrationActions.ts`

Optional:

- schema additions inside `convex/schema.ts`

## Existing files to modify

- `app/dashboard/pulls/[pullId]/page.tsx`
- `app/dashboard/settings/page.tsx`
- `app/api/github/webhooks/route.ts`
- `lib/github/handlers/pull-request.ts`
- `lib/github/review-actions.ts`
- `lib/github/actions.ts`
- `convex/prReviews.ts`
- `convex/aiReviews.ts`
- `package.json`

---

## UI Integration Plan

## Review tab behavior

The review tab should read from two sources:

### 1. Normalized review hub

Backed by:

- `prReviewRuns`
- `prReviewThreads`
- `prReviewComments`

Used for:

- GitHub human reviews,
- Copilot reviews,
- app AI inline findings and threads.

### 2. Orchestration run state

Backed by:

- `reviewOrchestrationRuns`

Used for:

- queued/running/failed/completed status,
- current step label,
- active agents,
- processing metrics,
- retry actions.

## Manual actions

Support these actions in the review tab:

- `Run review now`
- `Refresh review artifacts`
- `Retry failed run`
- `Ask follow-up`

All should target the new orchestration layer, not the legacy `aiReviews` pipeline.

## Backward compatibility

Do not delete the legacy app-summary UI on day one.

Instead:

- wire the new orchestration into the review tab first,
- keep old summary code behind a soft fallback until the new path is stable,
- then remove or migrate legacy `aiReviews` usage in a second pass.

---

## Observability And Reliability

## Minimum observability for v1

Track:

- queue wait time
- execution duration
- active agent count
- per-agent failures
- GitHub post success/failure
- stale/superseded runs
- provider used
- model used
- tokens or estimated prompt size

## Failure handling

A run should end in one of:

- `completed`
- `failed`
- `superseded`

Never leave ambiguous “half alive” states in the UI.

## Retry rules

Allow retries for:

- transient provider failures
- GitHub secondary rate limiting
- network failures
- Redis/queue hiccups

Do not retry indefinitely on:

- invalid diff anchors
- missing installation access
- missing provider key
- invalid schema/validation bugs

---

## Package Additions

Add these dependencies:

- `bullmq`
- `ioredis`
- `@upstash/redis`
- `@langchain/langgraph`
- `@langchain/langgraph-checkpoint-redis`

Potentially also:

- `zod` if you want stricter orchestration payload validation

Do not remove existing Convex or Octokit dependencies.

---

## Phased Implementation Sequence

## Phase 1: Schema and settings correction

- Add orchestration run tables.
- Fix provider default behavior so Groq stays default.
- Update Settings copy and provider selection UX.

## Phase 2: Queue and worker foundation

- Add BullMQ queue module.
- Add Redis connection helpers for review orchestration.
- Add persistent worker bootstrap.

## Phase 3: Orchestration graph foundation

- Implement LangGraph state and checkpointing.
- Implement fetch, triage, specialist fan-out, synthesis nodes.
- Persist run-step updates to Convex.

## Phase 4: GitHub integration

- Extend PR webhook handler to enqueue review work.
- Add GitHub review poster with anchor validation.
- Add per-head idempotency checks.

## Phase 5: Review tab integration

- Replace current stubbed values in `app/dashboard/pulls/[pullId]/page.tsx`.
- Show live run state, unified threads, and app AI findings.
- Add manual trigger/retry/refresh actions.

## Phase 6: Chat and follow-up

- Reconnect follow-up chat on top of completed orchestration results.
- Keep provider selection consistent with the new provider rules.

## Phase 7: Cleanup

- Remove or retire legacy `aiReviews` pathways once the new flow is stable.
- Keep only the pieces still needed for encrypted key storage if reused.

---

## Explicit Decisions To Keep This Safe

### Decision 1

Keep existing webhook verification and dispatch.

Reason:

- it already works,
- it matches GitHub guidance,
- replacing it adds risk without value.

### Decision 2

Use `prReview*` tables as the review-tab canonical output.

Reason:

- you already built a normalized review hub,
- the new orchestration should feed it, not bypass it.

### Decision 3

Add new orchestration-run tables instead of forcing everything into `aiReviews`.

Reason:

- execution state and product review state are different concerns.

### Decision 4

Do not rely on BullMQ `jobId` replacement semantics.

Reason:

- BullMQ ignores duplicates by `jobId`,
- replacement needs dedicated deduplication strategy.

### Decision 5

Keep Groq as the hard default even if an Anthropic key exists.

Reason:

- this matches your product requirement,
- avoids surprising provider drift,
- keeps webhook-triggered reviews deterministic.

---

## Risks To Watch Early

### Risk 1: Invalid inline anchors

Mitigation:

- anchor validation before posting,
- summary fallback for invalid findings.

### Risk 2: Duplicate or stale reviews after rapid pushes

Mitigation:

- BullMQ deduplication,
- stale head SHA checks inside the worker,
- per-head GitHub review idempotency checks.

### Risk 3: Provider rate limits

Mitigation:

- BullMQ limiter,
- request coordinator pattern borrowed from `kron-hr-main`,
- lower initial concurrency.

### Risk 4: Over-scoped context and slow runs

Mitigation:

- selective context expansion,
- chunking for large PRs,
- deterministic heuristics before expensive model routing.

### Risk 5: Review tab becoming coupled to old and new systems at once

Mitigation:

- make the new orchestration the primary path,
- keep old summary code only as a temporary fallback,
- remove legacy state once stabilized.

---

## Final Recommendation

The best implementation path is:

- keep your current GitHub sync infrastructure,
- keep the normalized `prReview*` review hub,
- add a new dedicated BullMQ + LangGraph review orchestration slice,
- store execution state separately from review artifacts,
- default to Groq,
- let Anthropic be opt-in through Settings,
- and wire the `Review` tab to the new orchestration instead of the current stubbed/manual summary path.

That gives you the architecture you want without breaking the rest of the codebase.

---

## External References Checked

These influenced the plan and were checked during planning:

- GitHub webhook signature validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- GitHub webhook event payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub pull request review API: https://docs.github.com/en/rest/pulls/reviews?apiVersion=2026-03-10
- BullMQ job id behavior: https://docs.bullmq.io/guide/jobs/job-ids
- BullMQ deduplication: https://docs.bullmq.io/guide/jobs/deduplication
- BullMQ global rate limiting: https://docs.bullmq.io/guide/rate-limiting
- Upstash BullMQ integration: https://upstash.com/docs/redis/integrations/bullmq
- LangGraph persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
- LangGraph Redis checkpointer package: https://www.npmjs.com/package/@langchain/langgraph-checkpoint-redis
- Groq supported models: https://console.groq.com/docs/models
- Groq `llama-3.1-8b-instant`: https://console.groq.com/docs/model/llama-3.1-8b-instant
- Groq `llama-3.3-70b-versatile`: https://console.groq.com/docs/model/llama-3.3-70b-versatile
- Anthropic models overview: https://docs.anthropic.com/en/docs/models-overview
- Anthropic models API: https://docs.claude.com/en/api/models
