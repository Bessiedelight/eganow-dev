# Claude Agent Integration Implementation Plan

## Status

Prepared on April 21, 2026 after:

- reviewing the current codebase, especially GitHub installation/bootstrap, issue-to-repo linkage, pull request sync, and the existing Codex handoff UI
- verifying Anthropic's official Claude Agent SDK documentation and deployment guidance

## Goal

Replace the current ChatGPT/Codex handoff flow with a first-class in-app `Claude Agent` experience:

- users connect Claude in Settings by providing an Anthropic API key
- an issue gets a `Claude Agent` tab with a chatbot-style interface
- the agent works against the GitHub repository linked to that issue
- the agent can read code, edit files, create new files, run repo-local commands, and create pull requests
- the app continues to use the existing GitHub App integration as the system of record for repository access and PR synchronization

## Official Anthropic Documentation

These are the primary official sources that should drive the implementation:

- [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [Configure permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Handle approvals and user input](https://platform.claude.com/docs/en/agent-sdk/user-input)
- [Work with sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Get structured output from agents](https://platform.claude.com/docs/en/agent-sdk/structured-outputs)
- [Give Claude custom tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [Connect to external tools with MCP](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Intercept and control agent behavior with hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Hosting the Agent SDK](https://platform.claude.com/docs/en/agent-sdk/hosting)
- [Securely deploying AI agents](https://platform.claude.com/docs/en/agent-sdk/secure-deployment)
- [TypeScript Agent SDK reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [TypeScript SDK V2 interface preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [Track cost and usage](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)

Important takeaways from those docs:

- Anthropic has renamed the old Claude Code SDK to the `Claude Agent SDK`.
- The correct TypeScript package is `@anthropic-ai/claude-agent-sdk`.
- Anthropic explicitly says third-party apps should use API-key authentication here, not `claude.ai` login.
- The SDK already includes the built-in tools we need for coding work: read, write, edit, glob, grep, bash, sessions, hooks, approvals, and custom tools.
- Anthropic recommends running the SDK in a sandboxed container environment for production.
- Anthropic's session docs are explicit that sessions persist conversation history, not filesystem state.
- Anthropic's TypeScript docs currently document both:
  - V1 `query()` plus `continue` / `resume`
  - V2 preview `unstable_v2_createSession()` / `unstable_v2_resumeSession()`
- Anthropic's cost-tracking docs expose per-call totals and per-model usage, which should be wired into the app because each user funds runs with their own API key.

## What The Current Codebase Already Does Well

### GitHub app and organization bootstrap

Existing paths:

- `lib/github/app.ts`
- `lib/github/client.ts`
- `app/api/github/callback/route.ts`
- `app/api/github/installation/[id]/route.ts`
- `app/api/github/webhooks/route.ts`
- `convex/github.ts`
- `convex/organizations.ts`
- `hooks/use-organization.ts`

Current behavior:

- the app already authenticates to GitHub as a GitHub App
- GitHub installations are stored in Convex
- installations bootstrap organizations and memberships
- the current organization is resolved from the authenticated user

Why this matters:

- we do not need Claude to manage repo auth itself
- the agent runtime should consume the existing installation context, not invent a second GitHub auth model

### Repo ownership and issue-to-repo linkage

Existing paths:

- `convex/schema.ts`
- `convex/issues.ts`
- `convex/projects.ts`
- `app/dashboard/issues/[issueId]/page.tsx`
- `components/issue-ai-chat-tab.tsx`
- `lib/codex/handoff.ts`

Current behavior:

- an issue may already have `issue.githubRepoFullName`
- a project may define `project.githubRepoFullNames`
- the current Codex handoff logic already resolves repo choice using:
  - issue repo first
  - single project repo second
  - manual repo selection if the project spans multiple repos

Why this matters:

- this repo resolution logic is already correct in spirit and should be reused for Claude
- the app already knows when repo linkage is ambiguous and when it is missing

### Pull request lifecycle and issue linkage

Existing paths:

- `lib/github/actions.ts`
- `lib/github/handlers/pull-request.ts`
- `lib/github/handlers/issues.ts`
- `convex/pullRequests.ts`
- `convex/comments.ts`

Current behavior:

- the app can already create GitHub issues, comments, and pull requests via the GitHub App installation
- pull request webhooks already sync PR state back into Convex
- PR bodies are already parsed for issue links
- the app already auto-links PRs to issues using either:
  - GitHub issue numbers in the same repo, such as `Closes #123`
  - app-native identifiers, such as `Closes BAC-102`

Why this matters:

- Claude does not need to implement PR syncing logic itself
- the agent only needs to create a valid branch/commit/PR and let the existing webhook machinery do the rest
- the PR body should intentionally include issue linkage text so existing sync logic keeps working

### Existing AI settings and encryption

Existing paths:

- `convex/aiReviews.ts`
- `convex/aiReviewActions.ts`
- `lib/ai/crypto.ts`
- `app/dashboard/settings/page.tsx`

Current behavior:

- Anthropic API keys are already encrypted before storage using AES-256-GCM
- the settings page already has an Anthropic connection card

Why this matters:

- we can reuse the existing encryption/storage path instead of creating a second key vault flow
- the settings UI should be repurposed from "optional review provider" to "Connect to Claude"

## What Should Be Removed Or Replaced

Remove or replace the current Codex handoff flow:

- remove `lib/codex/handoff.ts`
- replace the current Codex-oriented `IssueAiChatTab` implementation
- replace the `CodexSettingsCard` UI in `app/dashboard/settings/page.tsx`
- replace the issue-detail header button label from `Codex Agent` to `Claude Agent`

Do not remove the existing GitHub App integration.

Do not replace the existing PR webhook sync pipeline.

Do not make Claude responsible for storing canonical GitHub state in Convex.

## Recommended Architecture

## Core principle

Keep one source of truth per concern:

- GitHub App remains the source of truth for repository access and PR creation
- Convex remains the source of truth for app state, issue linkage, sessions, chat history, approvals, and UI reactivity
- a dedicated Claude Agent runtime service becomes the execution layer for coding tasks

This is the smallest architecture that is still reliable end-to-end.

## Recommended runtime model

Use the TypeScript Claude Agent SDK in a dedicated Node worker service, not inside the browser and not inside the current Codex handoff.

Reasoning:

- the app is already TypeScript/Next.js-based
- Anthropic's SDK is a long-running process with persistent working-directory context and session state
- Anthropic's hosting guidance explicitly recommends a sandboxed container environment for production
- this does not fit well as a thin client-side feature or as a one-shot prompt relay

## Session API choice

The first draft of this plan leaned too hard toward "stable `query()` and not V2." That was too absolute.

What the Anthropic docs support today:

- for one-shot tasks, a single `query()` call is enough
- for multi-turn TypeScript chat, the docs support:
  - V1 `query()` plus `resume` or `continue: true`
  - V2 preview session APIs with `unstable_v2_createSession()` and `unstable_v2_resumeSession()`

Recommended decision:

- for v1 production, design the persistence model around explicit session IDs, not around one-shot calls
- the worker may implement that with either:
  - V1 `query()` plus captured `session_id` and later `resume`
  - V2 preview sessions if the team prefers the `send()` / `stream()` ergonomics after a short spike

The key requirement is not "V1 vs V2." The key requirement is that the implementation must support explicit session resume for a chat-style issue tab.

## Session lifecycle vs workspace lifecycle

These must be treated as separate resources:

- Claude session lifecycle:
  - conversation transcript
  - tool history
  - model context
  - Anthropic session ID
- workspace lifecycle:
  - cloned repository
  - checked out branch
  - edited files
  - local git state
  - sandbox/container

Important consequence:

- resuming a Claude session does not restore the filesystem
- restoring a workspace does not restore the Claude transcript unless the session files are also present

The implementation must persist and recover both independently.

## High-level component layout

### 1. Settings and connection layer

Responsibility:

- store the user's Anthropic API key securely
- validate that the key works
- expose connection status in Settings

Implementation note:

- reuse the existing encrypted Anthropic key path
- simplify the UI and semantics so this becomes a `Connect to Claude` feature, not just a review-provider toggle

### 2. Repo resolution layer

Responsibility:

- determine which GitHub repository the issue should run against

Resolution order:

1. `issue.githubRepoFullName`
2. the single repo in `project.githubRepoFullNames`
3. if multiple project repos exist, prompt the user to choose
4. if no repo is linked, block session launch and instruct the user to connect a repo first

Implementation note:

- keep the current resolution semantics from `lib/codex/handoff.ts`
- move them into a Claude-oriented shared helper instead of keeping them Codex-specific

### 3. Workspace manager

Responsibility:

- create and maintain an isolated working copy of the target repository for a Claude session
- hydrate it using the existing GitHub App installation
- create or reuse a session branch
- manage deterministic on-disk paths so Claude session resume works correctly

Recommended approach:

- create one sandboxed Docker container per issue session in v1
- clone or fetch the repo using a short-lived GitHub App installation token
- checkout a branch like `eganow/<issue-identifier>-<session-id>`
- set the Claude SDK `cwd` to that repo directory
- use a deterministic in-container repo path, for example `/workspace/repo`
- mount two persistent volumes per session:
  - repo workspace volume
  - Claude home/session volume

Session persistence detail:

- Anthropic's session docs say resume depends on the same `cwd`
- Anthropic's session files are stored under `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
- therefore, every container that resumes a session must restore:
  - the same effective `cwd`
  - the corresponding persisted `~/.claude` session files

Why ephemeral over persistent local worktrees:

- easier security boundary
- easier cleanup
- aligns with Anthropic's hosting guidance
- avoids leaking one user's workspace state into another user's run

Why Docker for v1:

- lowest implementation friction with the current stack
- good enough isolation for an initial internal or low-scale rollout
- can later be hardened with gVisor or moved to Firecracker if the threat model demands it

### 4. Claude Agent runtime

Responsibility:

- run the Claude Agent SDK
- stream messages back to the app
- execute coding work in the session workspace
- request user approvals when needed

Recommended SDK posture for v1:

- support explicit session resumption keyed by `claudeSessionId`
- start with `permissionMode: "acceptEdits"` for fast code iteration inside the isolated repo workspace
- pre-approve the minimum useful built-ins for coding work
- use `canUseTool` and hooks for higher-risk actions
- pin the SDK version during implementation and confirm the exact tool-config surface exposed by that version

Tool configuration note:

- Anthropic's current TypeScript reference clearly documents top-level `allowedTools` and `disallowedTools`
- there are also `tools` fields in other SDK contexts, such as `AgentDefinition` for subagents
- before implementation, the team should pin the SDK version and confirm whether a top-level exact-tool-set option is available in that version
- until then, this plan should not assume an undocumented replacement for `allowedTools`

Why `acceptEdits` is the right default here:

- file edits inside an isolated repo sandbox should be frictionless
- higher-risk actions should still require approval
- this keeps the coding experience interactive without making PR publication automatic

### 5. Approval and governance layer

Responsibility:

- surface approvals in the chat UI when Claude wants to do something sensitive
- return the user's decision back to the SDK

Use Anthropic SDK features directly, but keep the flows separate:

- tool permission flow:
  - `canUseTool`
  - permission modes
  - hooks
- clarifying-question flow:
  - `AskUserQuestion`

These are related but not the same mechanism.

Implementation note:

- `canUseTool` decides whether a tool invocation can proceed
- `AskUserQuestion` is its own tool that Claude can invoke when it needs human clarification
- the UI should show these as different event types so users understand whether they are:
  - approving an action
  - answering a question

Actions that should require explicit user approval in v1:

- publishing a branch to GitHub
- opening a pull request
- destructive bash commands
- commands that leave the repo workspace
- any unsandboxed command request

### 6. GitHub publish layer

Responsibility:

- take the local workspace changes and publish them through the existing GitHub App path

Important design choice:

- do not give the Claude runtime long-lived GitHub secrets
- do not rely on raw `git push` from inside the agent sandbox as the primary publish path

Recommended v1 design:

- let Claude edit files and make local commits in the sandbox
- expose one app-owned custom tool like `publish_pull_request`
- that tool runs outside the direct Claude trust boundary, using the existing GitHub App installation context to:
  - push the branch
  - create the pull request using `lib/github/actions.ts`
  - return PR metadata to the agent and UI

This keeps GitHub credentials under app control and reuses the existing GitHub integration cleanly.

### 7. Sync-back layer

Responsibility:

- let the existing GitHub webhook system sync the newly created PR back into Convex
- let the issue automatically reflect the PR link

Implementation note:

- generate PR bodies that include existing issue-link syntax
- if there is a same-repo GitHub issue, include `Closes #<number>`
- always include the app-native issue identifier too, for example `Closes BAC-102`

This fits the existing `parseAndLinkIssues()` behavior in `convex/pullRequests.ts`.

## Recommended Data Model Changes

Keep Convex as the control plane for Claude sessions.

### Reuse

Reuse `aiSettings.encryptedAnthropicKey` rather than inventing new encrypted-key plumbing.

Suggested changes:

- remove or de-emphasize provider-selection UX that exists for Groq vs Anthropic
- add Claude-specific connection metadata:
  - `claudeConnectionStatus`
  - `claudeValidatedAt`
  - `defaultClaudeModel`

### Add new tables

Suggested new tables:

#### `claudeAgentSessions`

Fields:

- `organizationId`
- `issueId`
- `memberId`
- `githubInstallationId`
- `repoFullName`
- `branchName`
- `workspaceId`
- `claudeSessionId`
- `status` (`starting`, `active`, `waiting_for_approval`, `publishing`, `completed`, `failed`, `closed`)
- `lastActivityAt`
- `createdAt`
- `updatedAt`

Purpose:

- tie the issue, user, repo, sandbox, and Claude conversation together
- store the authoritative session identifier used for `resume`

#### `claudeAgentMessages`

Fields:

- `sessionId`
- `role` (`user`, `assistant`, `system`, `tool`, `approval`)
- `content`
- `metadata`
- `createdAt`

Purpose:

- power the chat transcript UI reactively from Convex

#### `claudeAgentApprovals`

Fields:

- `sessionId`
- `toolName`
- `requestPayload`
- `state` (`pending`, `approved`, `denied`, `expired`)
- `decision`
- `createdAt`
- `resolvedAt`

Purpose:

- store pending tool approvals so the UI can show them and the worker can resume correctly

#### `claudeAgentWorkspaces`

Fields:

- `sessionId`
- `provider` (`docker`, `sandbox-runtime`, etc.)
- `workspacePath`
- `sandboxId`
- `repoFullName`
- `branchName`
- `status`
- `claudeHomePath`
- `sessionStorageKey`
- `createdAt`
- `expiresAt`

Purpose:

- track sandbox lifecycle and cleanup
- track where repo state and Claude session files are persisted separately

## Frontend Changes

## Settings page

Update `app/dashboard/settings/page.tsx`:

- remove the Codex setup card entirely
- rename the Anthropic card into `Connect to Claude`
- show:
  - connected/disconnected state
  - last validation time
  - model default
  - reconnect/disconnect actions

Suggested UX:

- primary CTA: `Connect to Claude`
- helper text: "Use your Anthropic API key to power Claude Agent inside your connected repositories."
- validation should happen on save, not only on first agent run

## Issue detail page

Update `app/dashboard/issues/[issueId]/page.tsx`:

- rename the toggle/button from `Codex Agent` to `Claude Agent`
- keep the same split-layout entry point if desired
- replace the current handoff view with a real chat workspace

## Claude Agent tab UI

Replace `components/issue-ai-chat-tab.tsx` with a real session UI:

- top panel:
  - issue title and identifier
  - resolved repo
  - branch name
  - agent status
- transcript:
  - user and assistant messages
  - tool activity
  - approval prompts
  - publish events
- composer:
  - text input
  - send
  - stop
  - clear session
- side rail:
  - repo details
  - linked GitHub issue
  - open branch
  - open PR if one exists

Suggested reuse:

- some interaction patterns in `components/pull-review-chat.tsx` can be reused for transcript rendering and composer behavior

## Backend/API Changes

## New server-side Claude module

Add a new server module area, for example:

- `lib/claude-agent/runner.ts`
- `lib/claude-agent/workspace.ts`
- `lib/claude-agent/tools.ts`
- `lib/claude-agent/publish.ts`
- `lib/claude-agent/policies.ts`

Responsibilities:

- bootstrap the SDK
- map issue/repo context into prompts
- enforce tool policy
- persist transcript events to Convex
- publish branches and PRs using app-owned GitHub logic

## New app APIs or worker boundary

Recommended:

- expose authenticated app endpoints for:
  - create session
  - send message
  - respond to approval
  - close session
- run actual Claude execution in a dedicated worker process/service

Required persistence behavior:

- when a turn completes, persist:
  - `claudeSessionId`
  - transcript messages
  - repo branch/workspace metadata
  - location of the persisted Claude home/session files
- when a worker restarts, rebuild the container with:
  - the same repo volume
  - the same Claude home volume
  - the same `cwd`
  - then resume the session by ID

Avoid:

- running long-lived SDK sessions directly in client code
- depending on short-lived serverless request lifetimes for the full agent loop

## Custom tools to add in v1

Prefer custom tools over MCP for app-specific actions.

Suggested v1 tools:

- `eganow_get_issue_context`
  - returns issue metadata, linked issue URL, project name, existing repo mapping
- `eganow_get_delivery_context`
  - returns linked PRs, recent comments, or other app-native context if useful
- `eganow_publish_pull_request`
  - pushes the branch and opens a PR using the GitHub App
- `eganow_list_accessible_repos`
  - optional, only if repo choice must be resolved interactively

Why custom tools instead of MCP first:

- the app already has direct server-side GitHub utilities
- v1 does not need the extra moving parts of a separate MCP deployment
- Anthropic's MCP support is useful, but not required for this repo's current needs

MCP can be added later if we want Claude to talk to broader internal systems.

## End-To-End Flow

### 1. User connects Claude

1. User opens Settings.
2. User pastes an Anthropic API key.
3. Server encrypts and stores it.
4. Server validates it with a lightweight SDK or API check.
5. UI shows `Connected`.

### 2. User opens an issue and starts Claude Agent

1. User opens an issue.
2. App resolves the target repo from the issue/project mapping.
3. If ambiguous, app asks the user to pick a repo before session creation.
4. App creates a `claudeAgentSession`.
5. Worker provisions an isolated workspace for that repo and branch.
6. Worker starts Claude Agent SDK with:
   - issue prompt
   - repo `cwd`
   - safe tool policy
   - session bookkeeping hooks
   - persisted Claude home/session storage

### 3. Claude works inside the repo

1. Claude reads files and analyzes the repo.
2. Claude edits files and creates new ones.
3. Claude runs repo-local commands as allowed.
4. Transcript and status stream back into Convex and the issue UI.

### 4. Sensitive action approval

1. Claude requests a sensitive action.
2. The SDK triggers `canUseTool`.
3. Worker records a pending approval.
4. UI shows the approval request.
5. User approves or denies.
6. Worker returns that decision to the SDK and execution continues.

### 4b. Clarifying questions

1. Claude invokes `AskUserQuestion`.
2. Worker records the question payload.
3. UI renders a question card distinct from approval cards.
4. User answers.
5. Worker returns the answer payload to the SDK and execution continues.

### 5. PR publication

1. Claude decides the work is ready.
2. Claude calls `eganow_publish_pull_request`.
3. App-owned publish logic pushes the branch and opens the PR via GitHub App credentials.
4. PR body includes issue-link text.
5. Existing GitHub webhooks sync the PR back into Convex.
6. The issue page now shows the linked PR through the existing pipeline.

## Security Model

Follow Anthropic's deployment guidance closely.

### Required security boundaries

- run the Claude Agent SDK in a sandboxed container
- keep GitHub App private credentials outside the agent sandbox
- pass only short-lived installation-scoped access into workspace bootstrap/publish operations
- store Anthropic API keys encrypted at rest
- restrict filesystem access to the session workspace
- restrict network egress aggressively

### Network posture

Allow by default:

- Anthropic API traffic
- app-owned publish/bootstrap traffic

Deny by default:

- arbitrary internet access from agent bash commands

Optional allowlist, if needed later:

- package registries required for test/install workflows

Initial runtime choice:

- v1 runtime: Docker
- hardening target if needed: Docker plus gVisor
- future higher-isolation option: Firecracker-style microVMs

### Bash/tool policy

Recommended v1 policy:

- allow repo-local read/edit/write and safe bash work
- deny or require approval for:
  - destructive commands
  - commands outside the workspace
  - unsandboxed execution
  - direct network access
  - direct PR publication

### Auditability

Use SDK hooks to log:

- tool calls
- edits
- approval requests
- publish actions
- final session outcome

Persist those records in Convex or structured logs.

## Cost tracking

Because each user brings their own Anthropic API key, usage accounting is product-critical.

Implementation requirements:

- record `total_cost_usd` from every completed `query()` result
- record per-model usage when available
- accumulate spend per:
  - Claude session
  - issue
  - user
- surface at least lightweight cost metadata in internal logs or admin tooling

Suggested storage:

- add usage fields on `claudeAgentSessions`
- optionally add a `claudeAgentUsageEvents` table for per-turn accounting

## Detailed Step-By-Step Implementation Plan

## Phase 1: Remove legacy Codex handoff surfaces

1. Delete `lib/codex/handoff.ts`.
2. Remove the Codex card from `app/dashboard/settings/page.tsx`.
3. Rename the issue tab/button from `Codex Agent` to `Claude Agent`.
4. Replace the current `IssueAiChatTab` content with a real chat shell, even if initially backed by mock data.

## Phase 2: Rework Claude connection in Settings

1. Reuse the existing Anthropic key encryption/storage path.
2. Add validation-on-save.
3. Remove or de-emphasize provider toggles that are unrelated to the new Claude Agent workflow.
4. Store connection metadata and surface it in the UI.

## Phase 3: Add Convex session state

1. Add `claudeAgentSessions`.
2. Add `claudeAgentMessages`.
3. Add `claudeAgentApprovals`.
4. Add `claudeAgentWorkspaces`.
5. Add queries/mutations to:
   - create a session
   - append a user message
   - stream/list session messages
   - set status
   - create/resolve approvals
   - close sessions

## Phase 4: Build repo resolution and workspace bootstrap

1. Extract the current issue/project repo resolution logic into a reusable Claude module.
2. Resolve `organization.githubInstallationId` from the current issue context.
3. Use the GitHub App installation to create a Docker-backed sandbox workspace.
4. Clone/fetch the repo and create a session branch.
5. Persist both:
   - repo workspace state
   - Claude home/session files
6. Record deterministic `cwd` and workspace metadata in Convex.

## Phase 5: Build the Claude worker service

1. Add the TypeScript Agent SDK package.
2. Pin the SDK version and confirm the exact tool configuration API exposed by that version.
3. Create the worker entrypoint that starts an agent against a session workspace.
4. Implement explicit session resume keyed by `claudeSessionId`.
5. Persist transcript messages to Convex as they stream.
6. Decide after a short spike whether to use:
   - V1 `query()` with `resume`
   - V2 preview sessions for cleaner `send()` / `stream()` ergonomics

## Phase 6: Add approvals and guardrails

1. Implement `canUseTool`.
2. Implement hooks for audit logging and safety checks.
3. Record pending approvals in Convex.
4. Build approval UI inside the issue chat tab.
5. Build separate `AskUserQuestion` UI handling.
6. Resume execution after approve/deny or question answer.

## Phase 7: Add custom publish tools

1. Add `eganow_get_issue_context`.
2. Add `eganow_publish_pull_request`.
3. Make publish logic generate a PR body that references the issue in the syntax the current parser already understands.
4. Reuse `lib/github/actions.ts` for PR creation.
5. Let existing GitHub webhooks sync the PR back into Convex.

## Phase 8: Polish the issue chat UI

1. Show repo, branch, session state, and PR state in the tab.
2. Show tool activity inline.
3. Show pending approvals as action cards.
4. Add stop/retry/close-session controls.
5. Add open-branch and open-PR shortcuts once available.

## Phase 9: Reliability and cleanup

1. Add idle-session expiration.
2. Add workspace cleanup jobs.
3. Add retry handling for worker crashes.
4. Add session-file recovery for worker/container restarts.
5. Add transcript recovery from Convex on refresh.
6. Add observability around session duration, publish rate, failure modes, and per-session spend.

## Phase 10: Tests and rollout

1. Unit test repo resolution rules.
2. Unit test issue-to-PR body generation.
3. Integration test session creation and message persistence.
4. Integration test approval flows.
5. Integration test publish flow against a test repo.
6. Verify webhook-driven PR sync still links back to issues correctly.
7. Roll out behind a feature flag.

## Recommended File-Level Implementation Map

### Replace

- `app/dashboard/settings/page.tsx`
- `app/dashboard/issues/[issueId]/page.tsx`
- `components/issue-ai-chat-tab.tsx`

### Reuse

- `lib/github/app.ts`
- `lib/github/client.ts`
- `lib/github/actions.ts`
- `lib/github/handlers/issues.ts`
- `lib/github/handlers/pull-request.ts`
- `convex/github.ts`
- `convex/organizations.ts`
- `convex/issues.ts`
- `convex/pullRequests.ts`
- `lib/ai/crypto.ts`

### Add

- `lib/claude-agent/runner.ts`
- `lib/claude-agent/workspace.ts`
- `lib/claude-agent/tools.ts`
- `lib/claude-agent/publish.ts`
- `lib/claude-agent/policies.ts`
- `convex/claudeAgents.ts`
- worker/service entrypoint for sandboxed Claude execution

## Final Recommendation

Implement this as:

- a real in-app Claude Agent
- backed by the TypeScript Claude Agent SDK
- running in isolated sandbox workspaces
- using the existing GitHub App integration for repo access and PR publication
- using Convex as the chat/session/control plane

Do not implement this as:

- another handoff prompt generator
- a browser-only Claude client
- a second GitHub auth path
- a direct replacement for the current webhook sync model

That gives the app a cohesive end-to-end flow:

- Settings connects Claude
- Issue opens Claude Agent
- Claude works inside the correct repo
- user approves higher-risk actions
- PR creation flows through the GitHub App already present in the codebase
- the existing webhook sync brings the result back into the issue automatically
