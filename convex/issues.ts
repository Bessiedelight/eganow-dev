import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

function actorInitials(displayName: string) {
  return displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function humanizeIssueValue(value: string | null | undefined) {
  if (value === undefined || value === null || value === "") return "Unassigned";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function dedupeAssigneeIds(memberIds: Id<"members">[]) {
  return Array.from(new Set(memberIds));
}

function normalizeAssigneeIds(args: {
  assigneeId?: Id<"members">;
  assigneeIds?: Id<"members">[];
}) {
  if (args.assigneeIds !== undefined) {
    return dedupeAssigneeIds(args.assigneeIds);
  }
  if (args.assigneeId !== undefined) {
    return args.assigneeId ? [args.assigneeId] : [];
  }
  return undefined;
}

function getIssueAssigneeIds(issue: {
  assigneeId?: Id<"members">;
  assigneeIds?: Id<"members">[];
}) {
  if (issue.assigneeIds && issue.assigneeIds.length > 0) {
    return dedupeAssigneeIds(issue.assigneeIds);
  }
  return issue.assigneeId ? [issue.assigneeId] : [];
}

async function loadAssigneeMembers(
  ctx: any,
  organizationId: Id<"organizations">,
  assigneeIds: Id<"members">[]
): Promise<Doc<"members">[]> {
  const assignees = await Promise.all(
    assigneeIds.map(async (assigneeId) => {
      const assignee = await ctx.db.get(assigneeId);
      if (!assignee) {
        throw new Error("Assignee not found");
      }
      if (assignee.organizationId !== organizationId) {
        throw new Error("Assignee must belong to this organization");
      }
      return assignee;
    })
  );
  return assignees;
}

function sameAssignees(left: Id<"members">[], right: Id<"members">[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function describeAssignees(
  assignees: Array<{ displayName: string }> | null | undefined
) {
  if (!assignees || assignees.length === 0) return "Unassigned";
  return assignees.map((assignee) => assignee.displayName).join(", ");
}

// ─── Queries ──────────────────────────────────────────────────

/**
 * List all issues for an organization (enriched with labels, assignee, linked PRs).
 */
export const listByOrg = query({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const currentMember = userId
      ? await ctx.db
          .query("members")
          .withIndex("by_org_and_user", (q) =>
            q.eq("organizationId", args.orgId).eq("userId", userId)
          )
          .first()
      : null;

    const issues = await ctx.db
      .query("issues")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .order("desc")
      .collect();

    // Enrich each issue with resolved relations
    const enriched = await Promise.all(
      issues.map(async (issue) => {
        // Resolve labels
        const labels = issue.labelIds
          ? await Promise.all(issue.labelIds.map((id) => ctx.db.get(id)))
          : [];

        const assigneeIds = getIssueAssigneeIds(issue);
        const assignees = (
          await Promise.all(assigneeIds.map((id) => ctx.db.get(id)))
        ).filter((assignee): assignee is Doc<"members"> => assignee !== null);
        const assignee = assignees[0] ?? null;

        // Resolve team
        const team = issue.teamId ? await ctx.db.get(issue.teamId) : null;

        // Resolve project
        const project = issue.projectId
          ? await ctx.db.get(issue.projectId)
          : null;

        // Count linked PRs
        const linkedPRs = await ctx.db
          .query("issuesPullRequests")
          .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
          .collect();

        let prSummary = null;
        if (linkedPRs.length > 0) {
          const prDocs = await Promise.all(
            linkedPRs.map((lpr) => ctx.db.get(lpr.pullRequestId))
          );
          const validPRs = prDocs.filter(Boolean);
          const openCount = validPRs.filter((p) => p!.state === "open").length;
          const mergedCount = validPRs.filter(
            (p) => p!.state === "merged"
          ).length;

          if (mergedCount > 0 && openCount === 0) {
            prSummary = { state: "merged" as const, text: "Merged" };
          } else if (openCount > 0) {
            prSummary = {
              state: "open" as const,
              text: `${openCount} Open`,
            };
          }
        }

        const issueEvents = await ctx.db
          .query("activityEvents")
          .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
          .order("desc")
          .take(20);

        const comments = await ctx.db
          .query("comments")
          .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
          .order("desc")
          .take(20);

        let latestThreadAt = Math.max(
          issue.createdAt,
          ...issueEvents.map((event) => event.createdAt),
          ...comments.map((comment) => comment.createdAt)
        );

        for (const link of linkedPRs) {
          const prEvents = await ctx.db
            .query("activityEvents")
            .withIndex("by_pullRequestId", (q) =>
              q.eq("pullRequestId", link.pullRequestId)
            )
            .order("desc")
            .take(10);

          for (const event of prEvents) {
            if (
              [
                "pull_request_linked_to_issue",
                "pull_request_state_changed",
                "pull_request_checks_changed",
                "pull_request_review_requested",
                "pull_request_project_changed",
                "pull_request_team_changed",
              ].includes(event.eventType)
            ) {
              latestThreadAt = Math.max(latestThreadAt, event.createdAt);
            }
          }
        }

        let hasUnseenThreadUpdates = false;
        if (currentMember) {
          const issueView = await ctx.db
            .query("issueViews")
            .withIndex("by_memberId_and_issueId", (q) =>
              q.eq("memberId", currentMember._id).eq("issueId", issue._id)
            )
            .unique();
          hasUnseenThreadUpdates =
            latestThreadAt > (issueView?.lastSeenActivityAt ?? 0);
        }

        return {
          ...issue,
          labels: labels.filter(Boolean),
          assignee,
          assignees,
          team,
          project,
          prSummary,
          latestThreadAt,
          hasUnseenThreadUpdates,
        };
      })
    );

    return enriched;
  },
});

/**
 * Get a single issue by its identifier (e.g. "BAC-12" or "5").
 */
export const getByIdentifier = query({
  args: {
    orgId: v.id("organizations"),
    identifier: v.string(),
  },
  handler: async (ctx, args) => {
    // Try direct identifier match first
    let issue = await ctx.db
      .query("issues")
      .withIndex("by_identifier", (q) =>
        q.eq("organizationId", args.orgId).eq("identifier", args.identifier)
      )
      .first();

    // If not found, try with # prefix (URL might strip it)
    if (!issue) {
      issue = await ctx.db
        .query("issues")
        .withIndex("by_identifier", (q) =>
          q
            .eq("organizationId", args.orgId)
            .eq("identifier", `#${args.identifier}`)
        )
        .first();
    }

    if (!issue) return null;

    // Resolve labels
    const labels = issue.labelIds
      ? await Promise.all(issue.labelIds.map((id) => ctx.db.get(id)))
      : [];

    const assigneeIds = getIssueAssigneeIds(issue);
    const assignees = (
      await Promise.all(assigneeIds.map((id) => ctx.db.get(id)))
    ).filter((assignee): assignee is Doc<"members"> => assignee !== null);
    const assignee = assignees[0] ?? null;

    // Resolve creator
    const creator = await ctx.db.get(issue.creatorId);

    // Resolve team
    const team = issue.teamId ? await ctx.db.get(issue.teamId) : null;

    // Resolve project
    const project = issue.projectId
      ? await ctx.db.get(issue.projectId)
      : null;

    // Get linked PRs
    const linkedPRs = await ctx.db
      .query("issuesPullRequests")
      .withIndex("by_issueId", (q) => q.eq("issueId", issue!._id))
      .collect();

    const prDocs = await Promise.all(
      linkedPRs.map(async (lpr) => {
        const pr = await ctx.db.get(lpr.pullRequestId);
        return pr ? { ...pr, linkType: lpr.linkType } : null;
      })
    );

    // Get sub-issues
    const subIssues = await ctx.db
      .query("issues")
      .withIndex("by_parentIssueId", (q) =>
        q.eq("parentIssueId", issue!._id)
      )
      .collect();

    return {
      ...issue,
      labels: labels.filter(Boolean),
      assignee,
      assignees,
      creator,
      team,
      project,
      linkedPRs: prDocs.filter(Boolean),
      subIssues,
    };
  },
});

/**
 * Get issue by Convex document ID.
 */
export const getById = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.issueId);
  },
});

// ─── Mutations ────────────────────────────────────────────────

/**
 * Create a new issue.
 */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
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
    assigneeIds: v.optional(v.array(v.id("members"))),
    labelIds: v.optional(v.array(v.id("labels"))),
    // GitHub sync fields (set after creating on GitHub)
    githubRepoFullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get member record for current user
    const member = await ctx.db
      .query("members")
      .withIndex("by_org_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", userId)
      )
      .first();

    if (!member) throw new Error("Not a member of this organization");

    // Increment org-wide issue counter
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Organization not found");

    const newSeqNumber = org.issueCounter + 1;
    await ctx.db.patch(args.orgId, { issueCounter: newSeqNumber });

    // Build identifier
    let identifier: string;
    if (args.teamId) {
      const team = await ctx.db.get(args.teamId);
      identifier = team
        ? `${team.identifier}-${newSeqNumber}`
        : `#${newSeqNumber}`;
    } else {
      identifier = `#${newSeqNumber}`;
    }

    const now = Date.now();
    const assigneeIds = normalizeAssigneeIds({
      assigneeId: args.assigneeId,
      assigneeIds: args.assigneeIds,
    }) ?? [];
    await loadAssigneeMembers(ctx, args.orgId, assigneeIds);

    const issueId = await ctx.db.insert("issues", {
      organizationId: args.orgId,
      identifier,
      sequenceNumber: newSeqNumber,
      title: args.title,
      body: args.body,
      status: args.status,
      priority: args.priority,
      teamId: args.teamId,
      projectId: args.projectId,
      assigneeId: assigneeIds[0],
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
      creatorId: member._id,
      labelIds: args.labelIds,
      githubRepoFullName: args.githubRepoFullName,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Record activity event
    await ctx.db.insert("activityEvents", {
      organizationId: args.orgId,
      issueId,
      eventType: "issue_created",
      actorMemberId: member._id,
      actorDisplayName: member.displayName,
      source: "app",
      createdAt: now,
    });

    const initials = member.displayName
      .split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

    for (const assigneeId of assigneeIds) {
      await ctx.db.insert("notifications", {
        memberId: assigneeId,
        organizationId: args.orgId,
        issueId,
        title: args.title,
        context: `${member.displayName} assigned you`,
        isRead: false,
        isSnoozed: false,
        isArchived: false,
        actorDisplayName: member.displayName,
        actorAvatarInitials: initials,
        createdAt: now,
      });
    }

    return { issueId, identifier, sequenceNumber: newSeqNumber };
  },
});

/**
 * Update an issue's fields.
 */
export const update = mutation({
  args: {
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("backlog"),
        v.literal("todo"),
        v.literal("in_progress"),
        v.literal("in_review"),
        v.literal("done"),
        v.literal("cancelled")
      )
    ),
    priority: v.optional(
      v.union(
        v.literal("urgent"),
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
        v.literal("none")
      )
    ),
    teamId: v.optional(v.id("teams")),
    projectId: v.optional(v.id("projects")),
    assigneeId: v.optional(v.id("members")),
    assigneeIds: v.optional(v.array(v.id("members"))),
    labelIds: v.optional(v.array(v.id("labels"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const member = await ctx.db
      .query("members")
      .withIndex("by_org_and_user", (q) =>
        q.eq("organizationId", issue.organizationId).eq("userId", userId)
      )
      .first();

    if (!member) throw new Error("Not a member of this organization");

    const now = Date.now();
    const updates: Record<string, any> = { updatedAt: now };
    const nextAssigneeIds = normalizeAssigneeIds({
      assigneeId: args.assigneeId,
      assigneeIds: args.assigneeIds,
    });
    const currentAssigneeIds = getIssueAssigneeIds(issue);

    if (args.title !== undefined) updates.title = args.title;
    if (args.body !== undefined) updates.body = args.body;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.teamId !== undefined) updates.teamId = args.teamId;
    if (args.projectId !== undefined) updates.projectId = args.projectId;
    if (args.labelIds !== undefined) updates.labelIds = args.labelIds;
    if (nextAssigneeIds !== undefined) {
      const assignees = await loadAssigneeMembers(
        ctx,
        issue.organizationId,
        nextAssigneeIds
      );
      updates.assigneeId = nextAssigneeIds[0];
      updates.assigneeIds =
        nextAssigneeIds.length > 0 ? nextAssigneeIds : undefined;
    }

    // Track status changes for activity events
    if (args.status !== undefined && args.status !== issue.status) {
      updates.status = args.status;
      if (args.status === "done" || args.status === "cancelled") {
        updates.completedAt = now;
      }

      const activityEventId = await ctx.db.insert("activityEvents", {
        organizationId: issue.organizationId,
        issueId: args.issueId,
        eventType: "issue_status_changed",
        actorMemberId: member._id,
        actorDisplayName: member.displayName,
        metadata: {
          field: "status",
          oldValue: issue.status,
          newValue: args.status,
          oldLabel: humanizeIssueValue(issue.status),
          newLabel: humanizeIssueValue(args.status),
        },
        source: "app",
        createdAt: now,
      });

      for (const assigneeId of currentAssigneeIds) {
        await ctx.db.insert("notifications", {
          memberId: assigneeId,
          organizationId: issue.organizationId,
          issueId: args.issueId,
          activityEventId,
          title: `${issue.identifier} status changed to ${humanizeIssueValue(args.status)}`,
          context: `${member.displayName} updated issue status`,
          isRead: false,
          isSnoozed: false,
          isArchived: false,
          actorDisplayName: member.displayName,
          actorAvatarInitials: actorInitials(member.displayName),
          createdAt: now,
        });
      }
    }

    if (
      nextAssigneeIds !== undefined &&
      !sameAssignees(currentAssigneeIds, nextAssigneeIds)
    ) {
      const previousAssignees = (
        await Promise.all(currentAssigneeIds.map((id) => ctx.db.get(id)))
      ).filter((assignee): assignee is Doc<"members"> => assignee !== null);
      const nextAssignees = (
        await Promise.all(nextAssigneeIds.map((id) => ctx.db.get(id)))
      ).filter((assignee): assignee is Doc<"members"> => assignee !== null);
      const activityEventId = await ctx.db.insert("activityEvents", {
        organizationId: issue.organizationId,
        issueId: args.issueId,
        eventType: "issue_assignee_changed",
        actorMemberId: member._id,
        actorDisplayName: member.displayName,
        metadata: {
          field: "assignees",
          oldValue: currentAssigneeIds,
          newValue: nextAssigneeIds,
          oldLabel: describeAssignees(previousAssignees),
          newLabel: describeAssignees(nextAssignees),
        },
        source: "app",
        createdAt: now,
      });

      const addedAssigneeIds = nextAssigneeIds.filter(
        (assigneeId) => !currentAssigneeIds.includes(assigneeId)
      );

      for (const assigneeId of addedAssigneeIds) {
        await ctx.db.insert("notifications", {
          memberId: assigneeId,
          organizationId: issue.organizationId,
          issueId: args.issueId,
          activityEventId,
          title: `${issue.identifier} assigned to you`,
          context: `${member.displayName} updated assignees`,
          isRead: false,
          isSnoozed: false,
          isArchived: false,
          actorDisplayName: member.displayName,
          actorAvatarInitials: actorInitials(member.displayName),
          createdAt: now,
        });
      }
    }

    if (args.priority !== undefined && args.priority !== issue.priority) {
      await ctx.db.insert("activityEvents", {
        organizationId: issue.organizationId,
        issueId: args.issueId,
        eventType: "issue_priority_changed",
        actorMemberId: member._id,
        actorDisplayName: member.displayName,
        metadata: {
          field: "priority",
          oldValue: issue.priority,
          newValue: args.priority,
          oldLabel: humanizeIssueValue(issue.priority),
          newLabel: humanizeIssueValue(args.priority),
        },
        source: "app",
        createdAt: now,
      });
    }

    await ctx.db.patch(args.issueId, updates);
  },
});

/**
 * Link a Convex issue to a GitHub issue (called after GitHub API creates it).
 */
export const linkToGitHub = mutation({
  args: {
    issueId: v.id("issues"),
    githubIssueNumber: v.number(),
    githubIssueId: v.number(),
    githubUrl: v.string(),
    githubRepoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.issueId, {
      githubIssueNumber: args.githubIssueNumber,
      githubIssueId: args.githubIssueId,
      githubUrl: args.githubUrl,
      githubRepoFullName: args.githubRepoFullName,
      githubState: "open",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Sync/upsert an issue from a GitHub webhook event.
 */
export const syncFromGitHub = mutation({
  args: {
    orgId: v.id("organizations"),
    githubIssueNumber: v.number(),
    githubRepoFullName: v.string(),
    githubIssueId: v.number(),
    title: v.string(),
    body: v.optional(v.string()),
    state: v.string(),
    authorGithubUsername: v.string(),
    githubUrl: v.string(),
    labels: v.optional(v.array(v.string())),
    milestone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if issue already exists
    const existing = await ctx.db
      .query("issues")
      .withIndex("by_github", (q) =>
        q
          .eq("githubRepoFullName", args.githubRepoFullName)
          .eq("githubIssueNumber", args.githubIssueNumber)
      )
      .first();

    // Map GitHub state to internal status
    const status = args.state === "closed" ? "done" : "todo";

    // Resolve author to member
    const authorMember = await ctx.db
      .query("members")
      .withIndex("by_organizationId_and_githubUsername", (q) =>
        q
          .eq("organizationId", args.orgId)
          .eq("githubUsername", args.authorGithubUsername.toLowerCase())
      )
      .first();

    if (existing) {
      // Update existing issue
      await ctx.db.patch(existing._id, {
        title: args.title,
        body: args.body,
        githubState: args.state,
        githubUrl: args.githubUrl,
        githubMilestone: args.milestone,
        status: existing.status === "done" || existing.status === "cancelled"
          ? existing.status // Don't overwrite manually closed issues
          : status,
        updatedAt: now,
      });
      return existing._id;
    }

    // Create new issue from GitHub
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Organization not found");

    const newSeqNumber = org.issueCounter + 1;
    await ctx.db.patch(args.orgId, { issueCounter: newSeqNumber });

    // Find member who created it, or use a fallback
    const creatorId = authorMember?._id;
    if (!creatorId) {
      // If we can't find the member, we need a system member. For now, use the org creator.
      const orgCreatorMember = await ctx.db
        .query("members")
        .withIndex("by_org_and_user", (q) =>
          q.eq("organizationId", args.orgId).eq("userId", org.createdBy)
        )
        .first();

      if (!orgCreatorMember) throw new Error("No member found for issue sync");

      const issueId = await ctx.db.insert("issues", {
        organizationId: args.orgId,
        identifier: `#${newSeqNumber}`,
        sequenceNumber: newSeqNumber,
        title: args.title,
        body: args.body,
        status,
        priority: "none",
        creatorId: orgCreatorMember._id,
        githubIssueNumber: args.githubIssueNumber,
        githubRepoFullName: args.githubRepoFullName,
        githubIssueId: args.githubIssueId,
        githubState: args.state,
        githubUrl: args.githubUrl,
        githubMilestone: args.milestone,
        commentCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return issueId;
    }

    const issueId = await ctx.db.insert("issues", {
      organizationId: args.orgId,
      identifier: `#${newSeqNumber}`,
      sequenceNumber: newSeqNumber,
      title: args.title,
      body: args.body,
      status,
      priority: "none",
      creatorId,
      githubIssueNumber: args.githubIssueNumber,
      githubRepoFullName: args.githubRepoFullName,
      githubIssueId: args.githubIssueId,
      githubState: args.state,
      githubUrl: args.githubUrl,
      githubMilestone: args.milestone,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return issueId;
  },
});
