# Claude Agent SDK Integration Plan

Prepared on April 22, 2026.

## Objective

Integrate the Claude Agent SDK into the existing issue workflow so a user can open an issue, use the existing chatbot section in `/dashboard/issues/[issueId]`, have Claude work against the GitHub repository already connected through the app's GitHub App installation, and publish a pull request after making code changes.

This plan is intentionally aligned to your current product constraints:

- keep the current UI structure and entry points
- reuse the existing GitHub App integration
- reuse the existing encrypted Anthropic key flow in Settings
- avoid replacing the current GitHub webhook and PR sync architecture

## Executive Summary

The app already has most of the platform pieces required for this feature:

- a GitHub App integration with installation-scoped Octokit clients
- issue, project, PR, branch, and webhook sync data in Convex
- a settings flow that already stores a user-scoped Anthropic API key encrypted at rest
- an existing issue detail toggle and `IssueAiChatTab` placeholder

The missing pieces are not UI chrome. The missing pieces are:

- persistent issue-agent sessions
- git worktree-based repo workspaces
- a long-running Claude Agent SDK execution service
- approval handling
- a controlled publish path from workspace to GitHub branch and PR

The cleanest implementation is:

1. Keep Convex as the control plane.
2. Add a dedicated worker/runtime that runs `@anthropic-ai/claude-agent-sdk`.
3. Provision one top-level git worktree per active issue session.
4. Let Claude edit code inside that workspace.
5. Keep GitHub credentials and PR publication under app control via custom tools.
6. Let existing GitHub webhooks continue to synchronize PR state back into Convex.

## What Was Verified

### Official Anthropic SDK facts

From Anthropic's current official docs:

- the old Claude Code SDK name has been renamed to the Claude Agent SDK
- the current TypeScript package is `@anthropic-ai/claude-agent-sdk`
- the SDK includes built-in tools such as `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebSearch`, and `WebFetch`
- the SDK supports sessions, custom tools, MCP, permissions, hooks, and subagents
- Anthropic explicitly says third-party products should use API-key authentication for this SDK flow
- Anthropic documents Claude Code as running locally for local usage, not requiring a container runtime by default
- Anthropic documents git worktrees as the recommended way to run parallel Claude coding sessions against the same repo
- Anthropic states that session resume preserves conversation context, not filesystem state
- Anthropic documents that resumed sessions depend on the same `cwd`, and stores session transcripts under `~/.claude/projects/<encoded-cwd>/`
- Anthropic documents SDK-side approvals, hooks, and custom tools as the correct extension points

### Official GitHub integration facts

From GitHub's current official docs:

- GitHub App installation tokens are short-lived and expire after 1 hour
- GitHub recommends using Octokit app/installation auth so token generation and refresh are handled for you
- a pull request is created from a head branch into a base branch

## Current Codebase Findings

### Existing frontend entry points

Relevant files:

- `app/dashboard/issues/[issueId]/page.tsx`
- `components/issue-ai-chat-tab.tsx`
- `app/dashboard/settings/page.tsx`

What exists now:

- the issue detail page already has an `ai-chat` view and a `Claude Code Agent` toggle
- the settings page already has a Claude/Anthropic connection card
- `IssueAiChatTab` is currently a static shell, not a working chat system

Implication:

- this project does not need a UI redesign
- it needs backend session wiring, state, streaming, approvals, and publish behavior behind the existing UI surface

### Existing GitHub platform layer

Relevant files:

- `lib/github/app.ts`
- `lib/github/client.ts`
- `lib/github/actions.ts`
- `app/api/github/webhooks/route.ts`
- `convex/github.ts`

What exists now:

- the app already authenticates as a GitHub App
- installation-scoped Octokit clients already exist through `getInstallationClient`
- the app already creates issues, comments, and pull requests via GitHub App auth
- webhook routes already sync GitHub events back into Convex

Implication:

- the Claude runtime should not own GitHub auth
- the existing GitHub App integration should remain the only source of truth for repo access and PR publication

### Existing repo and issue linkage

Relevant files:

- `convex/schema.ts`
- `convex/issues.ts`
- `convex/pullRequests.ts`

What exists now:

- issues can already store `githubRepoFullName`, `githubIssueNumber`, and `githubUrl`
- projects can already store `githubRepoFullNames`
- pull requests already sync and auto-link back to issues through body parsing and junction tables

Implication:

- repo resolution should reuse existing issue and project linkage
- PR bodies created by the agent should include issue-link text that your current parser already understands

### Existing AI key and review infrastructure

Relevant files:

- `convex/aiReviews.ts`
- `convex/aiReviewActions.ts`
- `convex/reviewOrchestration.ts`
- `convex/reviewOrchestrationActions.ts`
- `lib/ai/crypto.ts`

What exists now:

- Anthropic API keys are already encrypted with AES-256-GCM before storage
- PR review orchestration already uses Convex as a background job and message/status control plane

Implication:

- reuse the encrypted key flow
- use the review orchestration architecture as a reference pattern
- do not overload the PR review tables for issue coding sessions because the lifecycle is different

## Scope

### In scope

- connect the current issue chatbot tab to a real Claude Agent SDK session
- use each user's own Anthropic API key from Settings
- use the already connected GitHub App installation for repository bootstrap and PR creation
- let Claude read, edit, search, and run repo-local commands inside a dedicated git worktree
- let Claude publish a pull request through an app-controlled tool
- store transcripts, approvals, status, and session metadata in Convex

### Out of scope for v1

- redesigning the issue page layout
- replacing the existing GitHub webhook sync pipeline
- browser-side Claude execution
- using a user's GitHub PAT instead of the app installation
- open internet access from the agent by default
- replacing the PR review orchestration system

## Key Product And Compliance Notes

### UI constraint

You asked to keep the UI unchanged. This plan assumes:

- we keep the current issue detail toggle and chatbot placement
- we keep the current settings page location for Claude key entry
- we only wire up behavior and status inside the existing layout

### Anthropic naming risk

Anthropic's current Agent SDK docs include branding guidance that says third-party products should not present themselves as "Claude Code" or "Claude Code Agent."

That creates a launch-risk tradeoff:

- internal/dev usage can keep the current label temporarily
- public/customer-facing release should likely switch to something like `Claude Agent` or `Powered by Claude`

This is not a blocker for engineering, but it should be surfaced before release.

## Recommended Architecture

## 1. Control plane: Convex

Convex should remain the source of truth for:

- issue-agent session metadata
- transcript messages
- pending approvals
- workspace state
- publish state
- final artifacts such as branch and PR metadata

Why:

- you already use Convex successfully for app state and background orchestration
- the UI is already reactive through Convex queries
- this keeps the Next.js app thin and lets the worker remain stateless apart from session/workspace persistence

## 2. Execution plane: dedicated Claude worker

Run the Claude Agent SDK in a dedicated Node worker service, not in the browser and not directly inside short-lived request handlers.

Why:

- the SDK is long-running and stateful
- issue chat needs resumable multi-turn sessions
- the worker must manage filesystem state, approvals, and streaming tool events

Recommended runtime:

- TypeScript worker using `@anthropic-ai/claude-agent-sdk`
- dedicated Node worker process on the server
- one manually managed top-level git worktree per active session
- no container, VM, or orchestration layer in v1

## 3. Workspace manager

Each active issue session needs one git worktree on the server filesystem.

Responsibilities:

- resolve the target repository
- clone the repo once per organization or repo into a base clone location
- add a worktree from that base clone for the issue session
- create or reuse a branch for the issue session inside that worktree
- ensure the Claude SDK always resumes with the same effective working directory
- persist both the worktree path and the Claude session transcript path

Recommended v1 model:

- base clone per repo or organization-managed repo pool
- deterministic session worktree path, for example `/workspaces/{sessionId}`
- create the worktree with Git directly, for example `git worktree add /workspaces/{sessionId} -b {branchName}`
- point the Claude worker `cwd` at `/workspaces/{sessionId}`
- resume the same Claude session only from the same worktree path

Suggested directory layout:

```text
/repos/
  {repoKey}/               base clone used to create worktrees

/workspaces/
  {sessionId}/             git worktree and Claude working directory
```

Important implementation note:

- Anthropic's current session docs do not place session transcripts inside the repository `.claude/` directory by default
- session transcripts are stored under `~/.claude/projects/<encoded-cwd>/`
- because of that, `claudeSessionPath` should be stored as the resolved transcript directory derived from the worktree path, not as `worktree/.claude/`

Important rule:

- Claude session state and filesystem state must be treated as separate persisted assets
- always use a top-level manually managed worktree for the issue session
- do not use subagent `isolation: worktree` or transient subagent worktrees for the main issue session, because those are not the right persistence model for resumable user-owned sessions

## 4. Publish boundary

Do not let Claude directly push to GitHub using raw credentials as the primary path.

Instead:

- Claude edits locally
- Claude asks to publish
- the app exposes a controlled publish tool
- the publish tool stages, commits, pushes, and creates the PR using the existing GitHub App integration

Why:

- GitHub credentials stay outside the agent trust boundary
- you reuse `lib/github/actions.ts`
- publication becomes auditable and approval-gated

## 5. Existing sync pipeline stays in place

After PR creation:

- existing GitHub webhooks continue to sync PRs, comments, and review state
- existing issue-to-PR linking logic continues to operate

This avoids rebuilding logic you already have and trust.

## Repository Resolution Strategy

Use the same resolution order every time a session starts:

1. `issue.githubRepoFullName`
2. the single repo in `project.githubRepoFullNames`
3. if multiple project repos exist, require a user choice
4. if no repo can be resolved, block session start and show a clear action message

Why this order:

- it matches the data model you already have
- it keeps issue-linked repos authoritative
- it prevents the agent from guessing the wrong repository

## Data Model Plan

## Reuse existing tables

Keep using:

- `aiSettings` for encrypted Anthropic keys
- `issues`, `projects`, `pullRequests`, `branches`, and `issuesPullRequests` for canonical product state

## Add dedicated issue-agent tables

I recommend new generic tables rather than Claude-branded tables, so you avoid a future migration if you add another agent provider later.

### `issueAgentSessions`

Purpose:

- one row per active or completed issue coding session

Suggested fields:

- `organizationId`
- `issueId`
- `memberId`
- `provider` with initial value `anthropic`
- `sdk` with initial value `claude-agent-sdk`
- `githubInstallationId`
- `repoFullName`
- `baseBranch`
- `branchName`
- `workspaceKey`
- `claudeSessionId`
- `status`
- `lastActivityAt`
- `latestUserMessageAt`
- `latestAssistantMessageAt`
- `createdAt`
- `updatedAt`
- `closedAt`
- `lastError`
- `linkedPullRequestId`
- `githubPrNumber`
- `githubPrUrl`
- `usageSummary`

Suggested statuses:

- `starting`
- `active`
- `waiting_for_user`
- `waiting_for_approval`
- `publishing`
- `completed`
- `failed`
- `closed`

### `issueAgentMessages`

Purpose:

- reactive transcript storage

Suggested fields:

- `sessionId`
- `issueId`
- `organizationId`
- `role`
- `messageType`
- `content`
- `metadata`
- `createdAt`

Suggested roles:

- `user`
- `assistant`
- `system`
- `tool`

Suggested message types:

- `chat`
- `tool_call`
- `tool_result`
- `status`
- `approval_request`
- `approval_result`
- `question`
- `publish_event`
- `error`

### `issueAgentApprovals`

Purpose:

- persist sensitive action requests and outcomes

Suggested fields:

- `sessionId`
- `toolName`
- `toolInput`
- `reason`
- `status`
- `decision`
- `createdAt`
- `resolvedAt`
- `resolvedBy`

Suggested statuses:

- `pending`
- `approved`
- `denied`
- `expired`

### `issueAgentWorkspaces`

Purpose:

- track workspace lifecycle independently from the conversation

Suggested fields:

- `sessionId`
- `provider` with initial value `filesystem_git_worktree`
- `workspaceKey`
- `repoFullName`
- `baseBranch`
- `branchName`
- `worktreePath`
- `claudeSessionPath`
- `worktreeCreated`
- `isTopLevelSession`
- `status`
- `createdAt`
- `updatedAt`
- `expiresAt`
- `lastHealthyAt`

Suggested statuses:

- `provisioning`
- `ready`
- `busy`
- `failed`
- `expired`
- `cleaned_up`

## Backend Modules To Add

Recommended new server modules:

- `lib/issue-agent/session.ts`
- `lib/issue-agent/repo-resolution.ts`
- `lib/issue-agent/workspace.ts`
- `lib/issue-agent/runner.ts`
- `lib/issue-agent/tools.ts`
- `lib/issue-agent/publish.ts`
- `lib/issue-agent/policy.ts`
- `convex/issueAgents.ts`
- `convex/issueAgentActions.ts`

Responsibilities:

- `repo-resolution.ts`
  resolves the repo for an issue
- `workspace.ts`
  provisions and resumes workspaces
- `runner.ts`
  starts and resumes Claude SDK sessions
- `tools.ts`
  defines app-owned custom tools
- `publish.ts`
  stages, commits, pushes, and opens PRs through the GitHub App
- `policy.ts`
  centralizes allowed tools, hook rules, and approval gates
- `convex/issueAgents.ts`
  contains queries/mutations for UI state
- `convex/issueAgentActions.ts`
  contains Node actions that coordinate worker jobs if you keep execution inside Convex-triggered actions

## SDK Integration Strategy

## Package and versioning

Use:

- `@anthropic-ai/claude-agent-sdk`

Do not build against the old unofficial package name from older blog posts.

Before implementation starts:

- pin an explicit SDK version
- validate the exact TypeScript APIs for sessions, permissions, hooks, and custom tools against that pinned version

## Session model

The issue chat requires resumable sessions.

Design requirement:

- every session must persist the Anthropic session identifier returned by the SDK
- every resumed turn must restore the same worktree path and the same Claude session transcript path

Do not assume:

- resuming the SDK session restores the filesystem

The worker must restore both:

- the Claude session context
- the git worktree state

## Initial tool posture

Recommended v1 built-in tools:

- `Read`
- `Write`
- `Edit`
- `Glob`
- `Grep`
- `Bash`

Recommended v1 exclusions by default:

- `WebSearch`
- `WebFetch`

Reason:

- issue resolution against a codebase should start as a repo-local workflow
- open-web access increases security and cost surface area

## Permissions and approvals

Use the SDK's documented controls:

- `allowedTools`
- `permissionMode`
- `canUseTool`
- hooks

Recommended v1 default:

- allow repo-local reading and editing without extra prompts
- gate sensitive or irreversible actions

Require explicit approval for:

- publish actions
- commands that leave the worktree root
- networked shell commands
- destructive shell commands
- branch deletion or reset operations

## Custom Tools Plan

Use app-owned custom tools for product-specific operations.

Recommended v1 tools:

### `eganow_get_issue_context`

Returns:

- issue title and body
- issue identifier
- linked GitHub issue metadata
- project and team metadata
- resolved repo
- current branch if a session already exists

### `eganow_get_repo_context`

Returns:

- repo default branch
- related linked PRs
- recent branch or PR metadata already known to the app

### `eganow_publish_pull_request`

Input:

- commit message
- PR title
- PR body
- base branch
- optional draft flag

Behavior:

- validates workspace state
- stages and commits local changes if needed
- pushes the issue branch using GitHub App credentials
- creates the PR using existing GitHub helpers
- returns PR metadata

### Optional v1.1 tools

- `eganow_list_accessible_repos`
- `eganow_get_existing_pull_request_for_issue`
- `eganow_request_repo_choice`

## Prompt And Workflow Design

The system prompt for the issue agent should instruct Claude to:

- work only inside the resolved repository and workspace
- use the issue as the primary task definition
- inspect the current codebase before proposing changes
- keep a running plan internally
- run verification commands when safe
- ask for approval before publication
- create a PR body that links back to the issue using syntax your existing parser already supports

PR body requirements:

- include the app-native issue identifier, for example `Closes BAC-102`
- include `Closes #123` when the issue is linked to a same-repo GitHub issue number

Why:

- your existing `parseAndLinkIssues()` logic already supports both patterns

## End-To-End Runtime Flow

## 1. User setup

1. User opens Settings.
2. User enters an Anthropic API key.
3. The app encrypts and stores it in `aiSettings`.
4. The app validates the key on save.
5. The existing settings card shows connected status.

## 2. Session start

1. User opens an issue.
2. User enters a request in the existing chatbot tab.
3. The app resolves the target repo.
4. If repo resolution is ambiguous, the session pauses for user selection.
5. The app creates an `issueAgentSession`.
6. The workspace manager provisions or resumes the git worktree at the persisted session path.
7. The worker starts or resumes the Claude session.

## 3. Agent execution

1. Claude reads files and inspects the codebase.
2. Claude edits files and runs repo-local commands.
3. The worker streams messages and tool activity into Convex.
4. The issue page reacts to new transcript items through queries.

## 4. Approval and clarification

1. Claude requests a sensitive action or asks a clarifying question.
2. The worker records a pending approval or question in Convex.
3. The issue chat shows the existing conversation plus the pending decision card.
4. The user responds.
5. The worker resumes the SDK turn with that decision.

## 5. Publish

1. Claude decides the change is ready.
2. Claude calls `eganow_publish_pull_request`.
3. The app-controlled publish layer commits, pushes, and opens the PR.
4. The session stores PR metadata immediately.
5. Existing GitHub webhooks sync the PR back into the rest of the app.

## 6. Post-publish

1. The issue page shows the linked PR through existing issue-to-PR data.
2. The session stays open for follow-up prompts if desired.
3. The workspace remains resumable until expiry or explicit close.

## Security And Operations Plan

## Required guardrails

- run the worker as a dedicated Node process with access to `/workspaces/` only
- never expose the GitHub App private key or installation token directly to the agent
- keep Anthropic API keys encrypted at rest
- decrypt Anthropic keys only inside server-side Node execution
- restrict Bash execution to the worktree root through the policy layer and deny commands that traverse above the worktree path
- block arbitrary network egress from shell commands in v1

## GitHub auth handling

Use existing `getInstallationClient()` and Octokit app auth.

Why:

- Octokit already handles installation-scoped auth correctly
- GitHub installation tokens expire quickly
- this avoids custom token lifecycle logic inside the agent runtime

## Auditability

Persist and log:

- session start and stop
- tool calls
- approval requests and decisions
- publish operations
- failures
- usage and cost metadata

## Cost Tracking

Because users bring their own Anthropic keys, cost visibility is product-critical.

Track per session:

- total input tokens
- total output tokens
- total cost if exposed by the SDK response
- model name
- turn count
- publish count

Store those metrics on:

- `issueAgentSessions.usageSummary`

Optionally add later:

- `issueAgentUsageEvents` for per-turn billing and debugging

## Frontend Implementation Plan

## Settings page

Keep the current settings location and visual shape.

Implementation work:

- reuse the existing Claude/Anthropic card
- validate the key on save
- surface last validation time
- surface active model or default model
- keep disconnect behavior

## Issue chat tab

Keep the existing tab location and general structure.

Implementation work:

- replace the static placeholder with real transcript rendering
- wire the composer to a session create/send mutation
- render tool activity inline
- render approval cards inline
- render branch and PR status in the existing shell
- add stop, retry, and close-session controls without redesigning layout

## Backend Implementation Phases

## Phase 1. Foundation and schema

Tasks:

- finalize table names and statuses
- add Convex schema entries and indexes
- add `convex/issueAgents.ts` queries and mutations
- add basic session creation and message storage

Exit criteria:

- the UI can create a session row and show stored transcript items

## Phase 2. Repo resolution and workspace bootstrap

Tasks:

- extract repo resolution into a shared helper
- provision a git worktree from the GitHub App-backed base clone
- create or restore an issue branch
- persist workspace metadata

Exit criteria:

- the backend can run `git worktree add` for a resolved issue repo, create the issue branch inside that worktree, persist the worktree path and branch name to `issueAgentWorkspaces`, and restore the same worktree path deterministically on worker restart

## Phase 3. Claude worker integration

Tasks:

- install and pin `@anthropic-ai/claude-agent-sdk`
- implement worker session start and resume
- stream SDK events into Convex
- persist the returned Claude session identifier

Exit criteria:

- a user prompt in the issue tab produces real Claude responses and tool activity

## Phase 4. Approvals and policy

Tasks:

- implement `canUseTool`
- add hook-based audit logging
- store approval requests in Convex
- add UI actions for approve and deny

Exit criteria:

- gated actions pause cleanly and resume after user input

## Phase 5. Publish flow

Tasks:

- implement `eganow_publish_pull_request`
- stage, commit, push, and create PR through the GitHub App path
- generate a PR body with issue-link syntax
- store returned PR metadata on the session

Exit criteria:

- Claude can publish a PR from an issue session without direct GitHub credentials

## Phase 6. Reliability and cleanup

Tasks:

- add idle session expiry
- add workspace cleanup jobs
- add crash recovery for worker restarts
- make session resume deterministic

Exit criteria:

- a worker restart does not permanently orphan a viable session

## Phase 7. Testing and rollout

Tasks:

- unit test repo resolution
- unit test PR body generation
- integration test session start, resume, approval, and publish flows
- integration test GitHub webhook sync after PR creation
- release behind a feature flag

Exit criteria:

- end-to-end issue-to-PR flow works reliably in a test repository

## Recommended File-Level Ownership

### Files to update

- `app/dashboard/issues/[issueId]/page.tsx`
- `components/issue-ai-chat-tab.tsx`
- `app/dashboard/settings/page.tsx`
- `convex/schema.ts`

### Files to reuse heavily

- `lib/github/app.ts`
- `lib/github/client.ts`
- `lib/github/actions.ts`
- `convex/issues.ts`
- `convex/pullRequests.ts`
- `convex/aiReviews.ts`
- `lib/ai/crypto.ts`

### New files to add

- `convex/issueAgents.ts`
- `convex/issueAgentActions.ts`
- `lib/issue-agent/repo-resolution.ts`
- `lib/issue-agent/workspace.ts`
- `lib/issue-agent/runner.ts`
- `lib/issue-agent/tools.ts`
- `lib/issue-agent/publish.ts`
- `lib/issue-agent/policy.ts`

## Final Recommendation

Build this feature as an in-app issue agent, not as a handoff.

The best-fit architecture for this codebase is:

- existing UI shell stays in place
- existing Settings key flow stays in place
- existing GitHub App integration remains authoritative
- Convex becomes the session and transcript control plane
- a dedicated Claude Agent SDK Node worker becomes the execution engine
- one top-level git worktree per issue session becomes the filesystem isolation boundary
- PR publication remains app-controlled and approval-gated

That gives you a coherent flow:

- user connects their own Anthropic key
- user opens an issue and chats in the existing tab
- Claude works against the correct repo through the connected GitHub App
- the app safely publishes a PR
- existing webhook sync brings the result back into the rest of the product

## Sources

- [Anthropic Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Code common workflows — worktrees](https://code.claude.com/docs/en/common-workflows)
- [GitHub App installation access token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub pull request creation documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request)
