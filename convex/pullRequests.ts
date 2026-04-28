import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

function actorInitials(displayName: string) {
  return displayName
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function humanizePullRequestValue(value: string | null | undefined) {
  if (value === undefined || value === null || value === "") return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// ─── Queries ──────────────────────────────────────────────────

/**
 * List all pull requests for an organization, enriched with relations.
 */
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
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

    let prs = await ctx.db
      .query("pullRequests")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .order("desc")
      .collect();

    if (currentMember) {
      prs = prs.filter((pr) => pr.createdAt >= currentMember.joinedAt);
    }

    const enriched = await Promise.all(
      prs.map(async (pr) => {
        // Resolve author member
        const authorMember = pr.authorMemberId
          ? await ctx.db.get(pr.authorMemberId)
          : null;

        // Get linked issues via junction table
        const links = await ctx.db
          .query("issuesPullRequests")
          .withIndex("by_pullRequestId", (q) =>
            q.eq("pullRequestId", pr._id)
          )
          .collect();

        const linkedIssues = await Promise.all(
          links.map(async (link) => {
            const issue = await ctx.db.get(link.issueId);
            return issue
              ? { identifier: issue.identifier, linkType: link.linkType }
              : null;
          })
        );

        // Resolve team & project
        const team = pr.teamId ? await ctx.db.get(pr.teamId) : null;
        const project = pr.projectId
          ? await ctx.db.get(pr.projectId)
          : null;

        return {
          ...pr,
          authorMember,
          linkedIssues: linkedIssues.filter(Boolean),
          team,
          project,
        };
      })
    );

    return enriched;
  },
});

/**
 * Get a single PR by GitHub repo full name and PR number.
 */
export const getByRepoAndNumber = query({
  args: {
    orgId: v.id("organizations"),
    repoFullName: v.string(),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_github", (q) =>
        q
          .eq("githubRepoFullName", args.repoFullName)
          .eq("githubPrNumber", args.prNumber)
      )
      .first();

    if (!pr) return null;

    // Resolve author member
    const authorMember = pr.authorMemberId
      ? await ctx.db.get(pr.authorMemberId)
      : null;

    // Linked issues
    const links = await ctx.db
      .query("issuesPullRequests")
      .withIndex("by_pullRequestId", (q) =>
        q.eq("pullRequestId", pr._id)
      )
      .collect();

    const linkedIssues = await Promise.all(
      links.map(async (link) => {
        const issue = await ctx.db.get(link.issueId);
        return issue
          ? {
              _id: issue._id,
              identifier: issue.identifier,
              title: issue.title,
              status: issue.status,
              linkType: link.linkType,
            }
          : null;
      })
    );

    // Comments
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_pullRequestId", (q) =>
        q.eq("pullRequestId", pr._id)
      )
      .order("asc")
      .collect();

    // Activity events
    const activity = await ctx.db
      .query("activityEvents")
      .withIndex("by_pullRequestId", (q) =>
        q.eq("pullRequestId", pr._id)
      )
      .order("asc")
      .collect();

    // Team & project
    const team = pr.teamId ? await ctx.db.get(pr.teamId) : null;
    const project = pr.projectId
      ? await ctx.db.get(pr.projectId)
      : null;

    return {
      ...pr,
      authorMember,
      linkedIssues: linkedIssues.filter(Boolean),
      comments,
      activity,
      team,
      project,
    };
  },
});

// ─── Mutations ────────────────────────────────────────────────

/**
 * Sync/upsert a pull request from GitHub data.
 */
export const syncFromGitHub = mutation({
  args: {
    orgId: v.id("organizations"),
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
    baseSha: v.optional(v.string()),
    headSha: v.optional(v.string()),
    authorGithubUsername: v.string(),
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    changedFiles: v.optional(v.number()),
    mergeable: v.optional(v.boolean()),
    mergeableState: v.optional(v.string()),
    mergedBy: v.optional(v.string()),
    mergedAt: v.optional(v.number()),
    reviewers: v.optional(
      v.array(
        v.object({
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
        })
      )
    ),
    githubLabels: v.optional(
      v.array(v.object({ name: v.string(), color: v.string() }))
    ),
    checksStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("success"),
        v.literal("failure"),
        v.literal("neutral")
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Resolve author to member
    let authorMember = await ctx.db
      .query("members")
      .withIndex("by_organizationId_and_githubUsername", (q) =>
        q
          .eq("organizationId", args.orgId)
          .eq("githubUsername", args.authorGithubUsername.toLowerCase())
      )
      .first();

    // Fallback: If GitHub username isn't mapped, assume the person syncing is the author for testing
    if (!authorMember) {
      const userId = await getAuthUserId(ctx);
      if (userId) {
        authorMember = await ctx.db
          .query("members")
          .withIndex("by_org_and_user", (q) =>
            q.eq("organizationId", args.orgId).eq("userId", userId)
          )
          .first();
      }
    }

    // Check if PR already exists
    const existing = await ctx.db
      .query("pullRequests")
      .withIndex("by_github", (q) =>
        q
          .eq("githubRepoFullName", args.githubRepoFullName)
          .eq("githubPrNumber", args.githubPrNumber)
      )
      .first();

    if (existing) {
      // Only update fields that have actual values — don't overwrite
      // existing stats with undefined from the lightweight list endpoint
      const patch: Record<string, any> = {
        title: args.title,
        body: args.body,
        state: args.state,
        isDraft: args.isDraft,
        baseBranch: args.baseBranch,
        headBranch: args.headBranch,
        baseSha: args.baseSha,
        headSha: args.headSha,
        githubUrl: args.githubUrl,
        authorMemberId: authorMember?._id || existing.authorMemberId,
        updatedAt: now,
      };
      // Only overwrite stats if we have real values (from detail endpoint)
      if (args.additions !== undefined) patch.additions = args.additions;
      if (args.deletions !== undefined) patch.deletions = args.deletions;
      if (args.changedFiles !== undefined) patch.changedFiles = args.changedFiles;
      if (args.mergeable !== undefined) patch.mergeable = args.mergeable;
      if (args.mergeableState !== undefined) patch.mergeableState = args.mergeableState;
      if (args.mergedBy !== undefined) patch.mergedBy = args.mergedBy;
      if (args.mergedAt !== undefined) patch.mergedAt = args.mergedAt;
      if (args.reviewers !== undefined) patch.reviewers = args.reviewers;
      if (args.githubLabels !== undefined) patch.githubLabels = args.githubLabels;
      if (args.checksStatus !== undefined) patch.checksStatus = args.checksStatus;

      await ctx.db.patch(existing._id, patch);

      // ─── Retroactive Auth Mapping Notification ───────────
      // If we didn't have an author mapped previously, but now we do, fire the notification
      if (!existing.authorMemberId && patch.authorMemberId) {
        await ctx.db.insert("notifications", {
          memberId: patch.authorMemberId,
          organizationId: args.orgId,
          pullRequestId: existing._id,
          title: args.title,
          context: `You created PR #${args.githubPrNumber}`,
          isRead: false,
          isSnoozed: false,
          isArchived: false,
          actorDisplayName: args.authorGithubUsername,
          actorAvatarInitials: args.authorGithubUsername.slice(0, 2).toUpperCase(),
          createdAt: now,
        });
      }

      // ─── Notifications on state transitions ─────────────
      // PR merged → notify author
      if (args.state === "merged" && existing.state !== "merged" && existing.authorMemberId) {
        const activityEventId = await ctx.db.insert("activityEvents", {
          organizationId: args.orgId,
          pullRequestId: existing._id,
          teamId: existing.teamId,
          projectId: existing.projectId,
          eventType: "pull_request_state_changed",
          actorDisplayName: args.mergedBy || "GitHub",
          metadata: {
            field: "state",
            oldValue: existing.state,
            newValue: args.state,
            oldLabel: humanizePullRequestValue(existing.state),
            newLabel: humanizePullRequestValue(args.state),
          },
          source: "github",
          createdAt: now,
        });
        await ctx.db.insert("notifications", {
          memberId: existing.authorMemberId,
          organizationId: args.orgId,
          pullRequestId: existing._id,
          activityEventId,
          title: `PR #${args.githubPrNumber} merged`,
          context: `${args.mergedBy || "Someone"} updated pull request state`,
          isRead: false,
          isSnoozed: false,
          isArchived: false,
          actorDisplayName: args.mergedBy || "GitHub",
          actorAvatarInitials: (args.mergedBy || "GH").slice(0, 2).toUpperCase(),
          createdAt: now,
        });
      }

      // CI failure → notify author
      if (
        args.checksStatus === "failure" &&
        existing.checksStatus !== "failure" &&
        existing.authorMemberId
      ) {
        const activityEventId = await ctx.db.insert("activityEvents", {
          organizationId: args.orgId,
          pullRequestId: existing._id,
          teamId: existing.teamId,
          projectId: existing.projectId,
          eventType: "pull_request_checks_changed",
          actorDisplayName: "GitHub CI",
          metadata: {
            field: "checksStatus",
            oldValue: existing.checksStatus ?? null,
            newValue: args.checksStatus,
            oldLabel: humanizePullRequestValue(existing.checksStatus ?? "unknown"),
            newLabel: humanizePullRequestValue(args.checksStatus),
          },
          source: "github",
          createdAt: now,
        });
        await ctx.db.insert("notifications", {
          memberId: existing.authorMemberId,
          organizationId: args.orgId,
          pullRequestId: existing._id,
          activityEventId,
          title: `PR #${args.githubPrNumber} checks changed to Failure`,
          context: `GitHub CI updated pull request checks`,
          isRead: false,
          isSnoozed: false,
          isArchived: false,
          actorDisplayName: "GitHub CI",
          actorAvatarInitials: "CI",
          createdAt: now,
        });
      }

      // New reviewers added → notify them (dedup against existing notifications)
      if (args.reviewers && args.reviewers.length > 0) {
        const existingNotifs = await ctx.db
          .query("notifications")
          .withIndex("by_memberId", (q: any) => q) // we'll filter manually
          .collect();

        for (const reviewer of args.reviewers) {
          if (!reviewer.memberId) continue;
          // Check if we already notified this reviewer for this PR
          const alreadyNotified = existingNotifs.some(
            (n: any) =>
              n.pullRequestId === existing._id &&
              n.memberId === reviewer.memberId &&
              n.context.includes("requested your review")
          );
          if (!alreadyNotified) {
            const activityEventId = await ctx.db.insert("activityEvents", {
              organizationId: args.orgId,
              pullRequestId: existing._id,
              teamId: existing.teamId,
              projectId: existing.projectId,
              eventType: "pull_request_review_requested",
              actorMemberId: authorMember?._id,
              actorDisplayName: args.authorGithubUsername,
              metadata: {
                field: "reviewer",
                newValue: reviewer.githubUsername,
                newLabel: reviewer.githubUsername,
              },
              source: "github",
              createdAt: now,
            });
            await ctx.db.insert("notifications", {
              memberId: reviewer.memberId,
              organizationId: args.orgId,
              pullRequestId: existing._id,
              activityEventId,
              title: `Review requested on PR #${args.githubPrNumber}`,
              context: `${args.authorGithubUsername} requested your review`,
              isRead: false,
              isSnoozed: false,
              isArchived: false,
              actorDisplayName: args.authorGithubUsername,
              actorAvatarInitials: args.authorGithubUsername.slice(0, 2).toUpperCase(),
              createdAt: now,
            });
          }
        }
      }

      // Parse body for issue links on update too
      if (args.body) {
        await parseAndLinkIssues(
          ctx, args.body, existing._id, args.orgId, args.githubRepoFullName, now
        );
        await inheritProjectAndTeamFromLinkedIssues(ctx, existing._id, now);
      }
      return existing._id;
    }

    // Create new PR
    const prId = await ctx.db.insert("pullRequests", {
      organizationId: args.orgId,
      githubPrNumber: args.githubPrNumber,
      githubRepoFullName: args.githubRepoFullName,
      githubPrId: args.githubPrId,
      githubUrl: args.githubUrl,
      title: args.title,
      body: args.body,
      state: args.state,
      isDraft: args.isDraft,
      baseBranch: args.baseBranch,
      headBranch: args.headBranch,
      baseSha: args.baseSha,
      headSha: args.headSha,
      authorGithubUsername: args.authorGithubUsername,
      authorMemberId: authorMember?._id,
      additions: args.additions,
      deletions: args.deletions,
      changedFiles: args.changedFiles,
      mergeable: args.mergeable,
      mergeableState: args.mergeableState,
      mergedBy: args.mergedBy,
      mergedAt: args.mergedAt,
      reviewers: args.reviewers,
      githubLabels: args.githubLabels,
      checksStatus: args.checksStatus,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // ─── Auto-detect issue links from PR body ─────────────
    if (args.body) {
      await parseAndLinkIssues(
        ctx, args.body, prId, args.orgId, args.githubRepoFullName, now
      );
      await inheritProjectAndTeamFromLinkedIssues(ctx, prId, now);
    }

    // Notify author on new PR
    if (authorMember?._id) {
      await ctx.db.insert("notifications", {
        memberId: authorMember._id,
        organizationId: args.orgId,
        pullRequestId: prId,
        title: args.title,
        context: `You created PR #${args.githubPrNumber}`,
        isRead: false,
        isSnoozed: false,
        isArchived: false,
        actorDisplayName: args.authorGithubUsername,
        actorAvatarInitials: args.authorGithubUsername.slice(0, 2).toUpperCase(),
        createdAt: now,
      });
    }

    // Notify reviewers on new PR
    if (args.reviewers && args.reviewers.length > 0) {
      for (const reviewer of args.reviewers) {
        if (!reviewer.memberId) continue;
        const activityEventId = await ctx.db.insert("activityEvents", {
          organizationId: args.orgId,
          pullRequestId: prId,
          actorMemberId: authorMember?._id,
          actorDisplayName: args.authorGithubUsername,
          metadata: {
            field: "reviewer",
            newValue: reviewer.githubUsername,
            newLabel: reviewer.githubUsername,
          },
          eventType: "pull_request_review_requested",
          source: "github",
          createdAt: now,
        });
        await ctx.db.insert("notifications", {
          memberId: reviewer.memberId,
          organizationId: args.orgId,
          pullRequestId: prId,
          activityEventId,
          title: `Review requested on PR #${args.githubPrNumber}`,
          context: `${args.authorGithubUsername} requested your review`,
          isRead: false,
          isSnoozed: false,
          isArchived: false,
          actorDisplayName: args.authorGithubUsername,
          actorAvatarInitials: args.authorGithubUsername.slice(0, 2).toUpperCase(),
          createdAt: now,
        });
      }
    }

    return prId;
  },
});

/**
 * Update app-native fields on a PR (title, body, team, project).
 */
export const update = mutation({
  args: {
    prId: v.id("pullRequests"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pr = await ctx.db.get(args.prId);
    if (!pr) throw new Error("Pull request not found");

    const updates: Record<string, any> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.body !== undefined) updates.body = args.body;
    if (args.teamId !== undefined) updates.teamId = args.teamId;
    if (args.projectId !== undefined) updates.projectId = args.projectId;

    const userId = await getAuthUserId(ctx);
    const actorMember = userId
      ? await ctx.db
          .query("members")
          .withIndex("by_org_and_user", (q) =>
            q.eq("organizationId", pr.organizationId).eq("userId", userId)
          )
          .first()
      : null;
    const actorDisplayName = actorMember?.displayName || "Someone";

    if (args.projectId !== undefined && args.projectId !== pr.projectId) {
      const previousProject = pr.projectId ? await ctx.db.get(pr.projectId) : null;
      const nextProject = args.projectId ? await ctx.db.get(args.projectId) : null;
      await ctx.db.insert("activityEvents", {
        organizationId: pr.organizationId,
        pullRequestId: pr._id,
        teamId: args.teamId ?? pr.teamId,
        projectId: args.projectId ?? pr.projectId,
        eventType: "pull_request_project_changed",
        actorMemberId: actorMember?._id,
        actorDisplayName,
        metadata: {
          field: "project",
          oldValue: pr.projectId ?? null,
          newValue: args.projectId ?? null,
          oldLabel: previousProject?.name ?? "No project",
          newLabel: nextProject?.name ?? "No project",
        },
        source: "app",
        createdAt: now,
      });
    }

    if (args.teamId !== undefined && args.teamId !== pr.teamId) {
      const previousTeam = pr.teamId ? await ctx.db.get(pr.teamId) : null;
      const nextTeam = args.teamId ? await ctx.db.get(args.teamId) : null;
      await ctx.db.insert("activityEvents", {
        organizationId: pr.organizationId,
        pullRequestId: pr._id,
        teamId: args.teamId ?? pr.teamId,
        projectId: args.projectId ?? pr.projectId,
        eventType: "pull_request_team_changed",
        actorMemberId: actorMember?._id,
        actorDisplayName,
        metadata: {
          field: "team",
          oldValue: pr.teamId ?? null,
          newValue: args.teamId ?? null,
          oldLabel: previousTeam?.name ?? "No team",
          newLabel: nextTeam?.name ?? "No team",
        },
        source: "app",
        createdAt: now,
      });
    }

    await ctx.db.patch(args.prId, updates);
  },
});

// ─── Helper: Parse PR body for issue references ───────────────

export const linkToIssue = mutation({
  args: {
    prId: v.id("pullRequests"),
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pr = await ctx.db.get(args.prId);
    const issue = await ctx.db.get(args.issueId);

    if (!pr) throw new Error("Pull request not found");
    if (!issue) throw new Error("Issue not found");
    if (pr.organizationId !== issue.organizationId) {
      throw new Error("Issue and pull request must belong to the same organization");
    }

    const existingLinks = await ctx.db
      .query("issuesPullRequests")
      .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", args.prId))
      .collect();

    const alreadyLinked = existingLinks.some((link) => link.issueId === args.issueId);
    if (alreadyLinked) {
      return { linked: true, alreadyLinked: true };
    }

    await ctx.db.insert("issuesPullRequests", {
      issueId: args.issueId,
      pullRequestId: args.prId,
      linkType: "manual",
      source: "app",
      createdAt: now,
    });

    await inheritProjectAndTeamFromLinkedIssues(ctx, args.prId, now);

    const userId = await getAuthUserId(ctx);
    const actorMember = userId
      ? await ctx.db
          .query("members")
          .withIndex("by_org_and_user", (q) =>
            q.eq("organizationId", pr.organizationId).eq("userId", userId)
          )
          .first()
      : null;

    const actorDisplayName = actorMember?.displayName || "Someone";
    const actorAvatarInitials = actorDisplayName
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    const activityEventId = await ctx.db.insert("activityEvents", {
      organizationId: pr.organizationId,
      issueId: issue._id,
      pullRequestId: pr._id,
      teamId: issue.teamId ?? pr.teamId,
      projectId: issue.projectId ?? pr.projectId,
      eventType: "pull_request_linked_to_issue",
      actorMemberId: actorMember?._id,
      actorDisplayName,
      metadata: {
        linkType: "manual",
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        pullRequestNumber: pr.githubPrNumber,
        pullRequestTitle: pr.title,
        repoFullName: pr.githubRepoFullName,
      },
      source: "app",
      createdAt: now,
    });

    const recipientIds = new Set<Id<"members">>();
    if (issue.assigneeId) recipientIds.add(issue.assigneeId);
    if (pr.authorMemberId) recipientIds.add(pr.authorMemberId);
    if (actorMember?._id) recipientIds.delete(actorMember._id);

    for (const memberId of recipientIds) {
      await ctx.db.insert("notifications", {
        memberId,
        organizationId: pr.organizationId,
        issueId: issue._id,
        pullRequestId: pr._id,
        activityEventId,
        title: `Linked PR #${pr.githubPrNumber} to ${issue.identifier}`,
        context: `${actorDisplayName} linked a pull request to an issue`,
        isRead: false,
        isSnoozed: false,
        isArchived: false,
        actorDisplayName,
        actorAvatarInitials,
        createdAt: now,
      });
    }

    return { linked: true, alreadyLinked: false };
  },
});

async function parseAndLinkIssues(
  ctx: any,
  body: string,
  pullRequestId: any,
  orgId: any,
  repoFullName: string,
  now: number
) {
  // Match patterns: "Closes #123", "Fixes #45", "Resolves #12"
  const closePatterns =
    /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  // Match app-native identifiers: "Closes BAC-102", "Fixes LOG-214"
  const identPatterns =
    /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+([A-Z]+-\d+)/gi;
  // Match simple refs: "refs #123", "#123" preceded by text
  const refPatterns = /(?:ref[sd]?|references?)\s+#(\d+)/gi;

  const linkedIssueIds = new Set<string>();

  // 1. Check "Closes/Fixes/Resolves #N" → GitHub issue number in same repo
  let match;
  while ((match = closePatterns.exec(body)) !== null) {
    const issueNumber = parseInt(match[1], 10);
    const issue = await ctx.db
      .query("issues")
      .withIndex("by_github", (q: any) =>
        q.eq("githubRepoFullName", repoFullName).eq("githubIssueNumber", issueNumber)
      )
      .first();
    if (issue && !linkedIssueIds.has(issue._id)) {
      linkedIssueIds.add(issue._id);
      // Check if link already exists
      const existing = await ctx.db
        .query("issuesPullRequests")
        .withIndex("by_pullRequestId", (q: any) =>
          q.eq("pullRequestId", pullRequestId)
        )
        .collect();
      const alreadyLinked = existing.some(
        (e: any) => e.issueId === issue._id
      );
      if (!alreadyLinked) {
        await ctx.db.insert("issuesPullRequests", {
          issueId: issue._id,
          pullRequestId,
          linkType: "closes",
          source: "github",
          createdAt: now,
        });
      }
    }
  }

  // 2. Check "Closes BAC-102" → app-native identifier
  while ((match = identPatterns.exec(body)) !== null) {
    const identifier = match[1];
    const issue = await ctx.db
      .query("issues")
      .withIndex("by_identifier", (q: any) =>
        q.eq("organizationId", orgId).eq("identifier", identifier)
      )
      .first();
    if (issue && !linkedIssueIds.has(issue._id)) {
      linkedIssueIds.add(issue._id);
      const existing = await ctx.db
        .query("issuesPullRequests")
        .withIndex("by_pullRequestId", (q: any) =>
          q.eq("pullRequestId", pullRequestId)
        )
        .collect();
      const alreadyLinked = existing.some(
        (e: any) => e.issueId === issue._id
      );
      if (!alreadyLinked) {
        await ctx.db.insert("issuesPullRequests", {
          issueId: issue._id,
          pullRequestId,
          linkType: "closes",
          source: "github",
          createdAt: now,
        });
      }
    }
  }

  // 3. Check "Refs #N" → reference links
  while ((match = refPatterns.exec(body)) !== null) {
    const issueNumber = parseInt(match[1], 10);
    const issue = await ctx.db
      .query("issues")
      .withIndex("by_github", (q: any) =>
        q.eq("githubRepoFullName", repoFullName).eq("githubIssueNumber", issueNumber)
      )
      .first();
    if (issue && !linkedIssueIds.has(issue._id)) {
      linkedIssueIds.add(issue._id);
      const existing = await ctx.db
        .query("issuesPullRequests")
        .withIndex("by_pullRequestId", (q: any) =>
          q.eq("pullRequestId", pullRequestId)
        )
        .collect();
      const alreadyLinked = existing.some(
        (e: any) => e.issueId === issue._id
      );
      if (!alreadyLinked) {
        await ctx.db.insert("issuesPullRequests", {
          issueId: issue._id,
          pullRequestId,
          linkType: "references",
          source: "github",
          createdAt: now,
        });
      }
    }
  }
}

async function inheritProjectAndTeamFromLinkedIssues(
  ctx: any,
  pullRequestId: any,
  now: number
) {
  const pr = await ctx.db.get(pullRequestId);
  if (!pr) return;

  const links = await ctx.db
    .query("issuesPullRequests")
    .withIndex("by_pullRequestId", (q: any) => q.eq("pullRequestId", pullRequestId))
    .collect();

  if (links.length === 0) return;

  const linkedIssues = (
    await Promise.all(links.map((link: any) => ctx.db.get(link.issueId)))
  ).filter(Boolean);

  if (linkedIssues.length === 0) return;

  const projectIds = Array.from(
    new Set(
      linkedIssues
        .map((issue: any) => issue.projectId)
        .filter((projectId: any) => projectId !== undefined && projectId !== null)
    )
  );

  const teamIds = Array.from(
    new Set(
      linkedIssues
        .map((issue: any) => issue.teamId)
        .filter((teamId: any) => teamId !== undefined && teamId !== null)
    )
  );

  const updates: Record<string, any> = {};

  if (projectIds.length === 1 && pr.projectId !== projectIds[0]) {
    updates.projectId = projectIds[0];
  }

  if (teamIds.length === 1 && pr.teamId !== teamIds[0]) {
    updates.teamId = teamIds[0];
  }

  if (Object.keys(updates).length === 0) return;

  updates.updatedAt = now;
  await ctx.db.patch(pullRequestId, updates);
}
