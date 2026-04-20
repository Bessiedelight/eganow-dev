# PR Review Hub Build Sheet

## Goal
Replace the current PR review experience with a modern review hub where:

- GitHub is the source of truth for review artifacts.
- GitHub Copilot and human reviews are synced into normalized Convex tables.
- The PR review tab renders threads, statuses, freshness, and summaries from normalized data.
- The existing in-app AI review becomes a secondary "app summary / explainer" layer.

## Product Shape

### What GitHub owns
- Pull request review comments
- Pull request reviews and review decisions
- Copilot review generation
- Review request / automatic review behavior

### What the app owns
- Sync and reconciliation
- Review freshness tracking by head SHA
- Review analytics and unified filtering
- Modern review tab UI
- Optional app-generated AI summary and explanation

## Architecture

### Source of truth
- GitHub PR state stays authoritative.
- Review artifacts are mirrored into Convex.
- The app never treats the local AI review blob as the primary review artifact.

### Reconciliation model
- Webhooks trigger reconciliation.
- Opening a PR detail page also triggers reconciliation as a fallback.
- Reconciliation fetches canonical review data from GitHub and replaces the synced review slice for that PR.

### Freshness model
- Each review run is pinned to a reviewed head SHA.
- If the PR head SHA changes, older reviews become stale or outdated.
- The review tab shows current head SHA vs latest reviewed SHA.

## Data Model

### Pull request additions
- `headSha`
- `baseSha`

### New tables

#### `prReviewRuns`
Represents a review run or review submission for a specific PR snapshot.

Core fields:
- `pullRequestId`
- `organizationId`
- `source` (`copilot`, `github`, `app_ai`)
- `status` (`pending`, `completed`, `stale`, `failed`)
- `reviewedHeadSha`
- `githubReviewId`
- `authorGithubUsername`
- `summary`
- `createdAt`
- `updatedAt`
- `completedAt`

#### `prReviewThreads`
Normalized review threads for diff comments or general review bodies.

Core fields:
- `pullRequestId`
- `organizationId`
- `reviewRunId`
- `source`
- `isCopilot`
- `githubThreadKey`
- `githubReviewId`
- `rootGithubCommentId`
- `subjectType` (`line`, `file`, `general`)
- `status` (`open`, `resolved`, `outdated`)
- `path`
- `line`
- `startLine`
- `side`
- `summary`
- `snippet`
- `authorGithubUsername`
- `createdAt`
- `updatedAt`

#### `prReviewComments`
Thread comments and replies.

Core fields:
- `threadId`
- `reviewRunId`
- `pullRequestId`
- `organizationId`
- `source`
- `role` (`reviewer`, `author`, `system`)
- `githubCommentId`
- `githubReviewId`
- `authorGithubUsername`
- `body`
- `createdAt`
- `updatedAt`

## Sync Flow

### Trigger points
- `pull_request.opened`
- `pull_request.ready_for_review`
- `pull_request.review_requested`
- `pull_request.reopened`
- `pull_request.converted_to_draft`
- `pull_request.synchronize`
- `pull_request_review.submitted`
- `pull_request_review.edited`
- `pull_request_review.dismissed`
- `pull_request_review_comment.created`
- `pull_request_review_comment.edited`
- `pull_request_review_comment.deleted`
- `pull_request_review_thread.resolved`
- `pull_request_review_thread.unresolved`

### GitHub fetches
- PR details for `headSha`, `baseSha`, labels, reviewers, stats
- PR reviews
- PR review comments

### Replace strategy
- On every reconciliation, replace synced GitHub/Copilot review artifacts for that PR.
- Keep app AI summary data separate.

## PR Review Tab Redesign

### Top summary strip
- Latest review source
- Review freshness
- Open thread count
- Outdated thread count
- Human/Copilot decision summary
- Checks status

### Main layout
- Left rail: filters + thread inbox
- Right pane: selected thread detail
- Bottom or side section: app AI summary / explainer

### Filters
- All
- Copilot
- Human
- Outdated

### Empty state
- No review threads yet
- Open PR in GitHub
- Encourage automatic Copilot review configuration

## Rollout Phases

### Phase 1
- Add schema
- Add Convex review sync/query layer
- Add GitHub reconciliation helpers
- Sync review artifacts from PR detail page and webhooks

### Phase 2
- Replace the current AI-centric tab with the review hub UI
- Keep existing app AI review as a secondary summary panel

### Phase 3
- Add resolved/unresolved enrichment if needed
- Add analytics, review freshness badges in PR list, and richer summary generation

## Known Tradeoffs
- GitHub Copilot review is treated as a GitHub-native feature, not an in-app LLM endpoint.
- The initial implementation can normalize review comments and review bodies without depending on a dedicated Copilot API.
- Resolved thread fidelity may require deeper GitHub review-thread data later.
