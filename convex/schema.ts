import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // ─── Existing: GitHub App installations ──────────────────────
  githubInstallations: defineTable({
    userId: v.id("users"),
    installationId: v.number(),
    accountLogin: v.string(),
    accountType: v.string(),
    accountAvatarUrl: v.optional(v.string()),
    status: v.string(),
    installedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_installationId", ["installationId"]),

  // ─── Organizations ──────────────────────────────────────────
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    avatarUrl: v.optional(v.string()),
    githubInstallationId: v.number(),
    githubAccountLogin: v.string(),
    githubAccountType: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    issueCounter: v.number(), // org-wide auto-increment for issue identifiers
  })
    .index("by_slug", ["slug"])
    .index("by_githubInstallationId", ["githubInstallationId"])
    .index("by_createdBy", ["createdBy"]),

  // ─── Members (user ↔ organization mapping) ─────────────────
  members: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
    displayName: v.string(),
    githubUsername: v.optional(v.string()),
    githubAvatarUrl: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("invited"),
      v.literal("deactivated")
    ),
    joinedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_org_and_user", ["organizationId", "userId"])
    .index("by_githubUsername", ["githubUsername"]),

  // ─── Teams ──────────────────────────────────────────────────
  teams: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    identifier: v.string(), // "BAC", "FRONT", "DES"
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultAssigneeId: v.optional(v.id("members")),
    activeCycleNumber: v.optional(v.number()),
    cycleDurationDays: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    isArchived: v.boolean(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_identifier", ["organizationId", "identifier"]),

  // ─── Team Members (junction) ────────────────────────────────
  teamMembers: defineTable({
    teamId: v.id("teams"),
    memberId: v.id("members"),
    role: v.union(v.literal("lead"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_teamId", ["teamId"])
    .index("by_memberId", ["memberId"])
    .index("by_team_and_member", ["teamId", "memberId"]),

  // ─── Projects ───────────────────────────────────────────────
  projects: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.union(
      v.literal("planned"),
      v.literal("in_progress"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    leadTeamId: v.optional(v.id("teams")),
    leadMemberId: v.optional(v.id("members")),
    githubRepoFullNames: v.optional(v.array(v.string())),
    startDate: v.optional(v.number()),
    targetDate: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    progress: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isArchived: v.boolean(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_status", ["organizationId", "status"])
    .index("by_leadTeamId", ["leadTeamId"]),

  // ─── Labels ─────────────────────────────────────────────────
  labels: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    color: v.string(),
    description: v.optional(v.string()),
    source: v.union(v.literal("app"), v.literal("github")),
    createdAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_name", ["organizationId", "name"]),

  // ─── Issues ─────────────────────────────────────────────────
  issues: defineTable({
    organizationId: v.id("organizations"),
    identifier: v.string(),       // "BAC-12" or "#5"
    sequenceNumber: v.number(),   // org-wide auto-increment
    title: v.string(),
    body: v.optional(v.string()),
    status: v.union(
      v.literal("backlog"),
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("in_review"),
      v.literal("done"),
      v.literal("cancelled")
    ),
    priority: v.union(
      v.literal("urgent"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
      v.literal("none")
    ),
    teamId: v.optional(v.id("teams")),
    projectId: v.optional(v.id("projects")),
    assigneeId: v.optional(v.id("members")),
    creatorId: v.id("members"),
    labelIds: v.optional(v.array(v.id("labels"))),
    parentIssueId: v.optional(v.id("issues")),
    cycleNumber: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // GitHub sync fields
    githubIssueNumber: v.optional(v.number()),
    githubRepoFullName: v.optional(v.string()),
    githubIssueId: v.optional(v.number()),
    githubState: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    githubMilestone: v.optional(v.string()),
    // Denormalized
    commentCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_teamId", ["teamId"])
    .index("by_projectId", ["projectId"])
    .index("by_assigneeId", ["assigneeId"])
    .index("by_status", ["organizationId", "status"])
    .index("by_identifier", ["organizationId", "identifier"])
    .index("by_parentIssueId", ["parentIssueId"])
    .index("by_github", ["githubRepoFullName", "githubIssueNumber"])
    .index("by_createdAt", ["organizationId", "createdAt"])
    .index("by_team_status", ["teamId", "status"]),

  // ─── Pull Requests ──────────────────────────────────────────
  pullRequests: defineTable({
    organizationId: v.id("organizations"),
    githubPrNumber: v.number(),
    githubRepoFullName: v.string(),
    githubPrId: v.number(),
    githubUrl: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    state: v.union(
      v.literal("open"),
      v.literal("closed"),
      v.literal("merged")
    ),
    isDraft: v.boolean(),
    baseBranch: v.string(),
    headBranch: v.string(),
    authorGithubUsername: v.string(),
    authorMemberId: v.optional(v.id("members")),
    reviewers: v.optional(v.array(v.object({
      githubUsername: v.string(),
      memberId: v.optional(v.id("members")),
      state: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("changes_requested"),
        v.literal("commented"),
        v.literal("dismissed")
      ),
      submittedAt: v.optional(v.number()),
    }))),
    mergedBy: v.optional(v.string()),
    mergedAt: v.optional(v.number()),
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    changedFiles: v.optional(v.number()),
    checksStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("success"),
      v.literal("failure"),
      v.literal("neutral")
    )),
    mergeable: v.optional(v.boolean()),
    mergeableState: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
    projectId: v.optional(v.id("projects")),
    githubLabels: v.optional(v.array(v.object({
      name: v.string(),
      color: v.string(),
    }))),
    labelIds: v.optional(v.array(v.id("labels"))),
    commentCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_github", ["githubRepoFullName", "githubPrNumber"])
    .index("by_state", ["organizationId", "state"])
    .index("by_teamId", ["teamId"])
    .index("by_projectId", ["projectId"])
    .index("by_authorMemberId", ["authorMemberId"])
    .index("by_createdAt", ["organizationId", "createdAt"]),

  // ─── Commits (for commit-level review) ──────────────────────
  commits: defineTable({
    organizationId: v.id("organizations"),
    githubRepoFullName: v.string(),
    sha: v.string(),
    shortSha: v.string(),
    message: v.string(),
    authorGithubUsername: v.string(),
    authorMemberId: v.optional(v.id("members")),
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    changedFiles: v.optional(v.number()),
    committedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_github", ["githubRepoFullName", "sha"])
    .index("by_repo", ["organizationId", "githubRepoFullName"]),

  // ─── Issue ↔ Pull Request links ─────────────────────────────
  issuesPullRequests: defineTable({
    issueId: v.id("issues"),
    pullRequestId: v.id("pullRequests"),
    linkType: v.union(
      v.literal("closes"),
      v.literal("references"),
      v.literal("manual")
    ),
    source: v.union(v.literal("github"), v.literal("app")),
    createdAt: v.number(),
  })
    .index("by_issueId", ["issueId"])
    .index("by_pullRequestId", ["pullRequestId"]),

  // ─── Comments ───────────────────────────────────────────────
  comments: defineTable({
    organizationId: v.id("organizations"),
    issueId: v.optional(v.id("issues")),
    pullRequestId: v.optional(v.id("pullRequests")),
    commitId: v.optional(v.id("commits")),
    body: v.string(),
    authorMemberId: v.optional(v.id("members")),
    authorGithubUsername: v.optional(v.string()),
    authorDisplayName: v.string(),
    authorAvatarUrl: v.optional(v.string()),
    githubCommentId: v.optional(v.number()),
    source: v.union(v.literal("app"), v.literal("github")),
    parentCommentId: v.optional(v.id("comments")),
    createdAt: v.number(),
    updatedAt: v.number(),
    isEdited: v.boolean(),
  })
    .index("by_issueId", ["issueId", "createdAt"])
    .index("by_pullRequestId", ["pullRequestId", "createdAt"])
    .index("by_parentCommentId", ["parentCommentId"])
    .index("by_githubCommentId", ["githubCommentId"]),

  // ─── Activity Events ───────────────────────────────────────
  activityEvents: defineTable({
    organizationId: v.id("organizations"),
    issueId: v.optional(v.id("issues")),
    pullRequestId: v.optional(v.id("pullRequests")),
    teamId: v.optional(v.id("teams")),
    projectId: v.optional(v.id("projects")),
    eventType: v.string(), // "issue_created", "issue_closed", "pr_linked", etc.
    actorMemberId: v.optional(v.id("members")),
    actorGithubUsername: v.optional(v.string()),
    actorDisplayName: v.string(),
    metadata: v.optional(v.any()),
    source: v.union(v.literal("app"), v.literal("github")),
    createdAt: v.number(),
  })
    .index("by_issueId", ["issueId", "createdAt"])
    .index("by_pullRequestId", ["pullRequestId", "createdAt"])
    .index("by_organizationId", ["organizationId", "createdAt"]),

  // ─── Notifications ─────────────────────────────────────────
  notifications: defineTable({
    memberId: v.id("members"),
    organizationId: v.id("organizations"),
    issueId: v.optional(v.id("issues")),
    pullRequestId: v.optional(v.id("pullRequests")),
    activityEventId: v.optional(v.id("activityEvents")),
    title: v.string(),
    context: v.string(),
    isRead: v.boolean(),
    isSnoozed: v.boolean(),
    snoozedUntil: v.optional(v.number()),
    isArchived: v.boolean(),
    actorDisplayName: v.string(),
    actorAvatarInitials: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_memberId", ["memberId", "createdAt"])
    .index("by_memberId_unread", ["memberId", "isRead"]),

  // ─── AI Reviews ─────────────────────────────────────────────
  aiReviews: defineTable({
    organizationId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
    model: v.optional(v.string()),
    step: v.string(), // ReviewStep — current/last checkpoint
    review: v.optional(v.any()), // PRReviewResult JSON (null until completed)
    contextStats: v.optional(
      v.object({
        filesAnalyzed: v.number(),
        totalDiffLines: v.number(),
        linkedIssuesCount: v.number(),
        relatedFilesExpanded: v.number(),
      })
    ),
    intermediateData: v.optional(v.any()), // File analyses etc (cleared on completion)
    error: v.optional(v.string()),
    processingTimeMs: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pullRequestId", ["pullRequestId"])
    .index("by_organizationId", ["organizationId"]),

  // ─── AI Chat Messages ──────────────────────────────────────
  aiChatMessages: defineTable({
    organizationId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    reviewId: v.id("aiReviews"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    references: v.optional(
      v.array(
        v.object({
          file: v.string(),
          line: v.optional(v.number()),
        })
      )
    ),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
    createdAt: v.number(),
  })
    .index("by_reviewId", ["reviewId", "createdAt"])
    .index("by_pullRequestId", ["pullRequestId", "createdAt"]),

  // ─── AI Settings (per-user, encrypted keys) ────────────────
  aiSettings: defineTable({
    userId: v.id("users"),
    encryptedAnthropicKey: v.optional(v.any()), // EncryptedValue JSON
    preferredProvider: v.union(v.literal("groq"), v.literal("anthropic")),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
});
