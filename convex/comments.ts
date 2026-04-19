import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * List comments for an issue, ordered by creation time.
 */
export const listByIssue = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("comments")
      .withIndex("by_issueId", (q) => q.eq("issueId", args.issueId))
      .order("asc")
      .collect();
  },
});

/**
 * Create a comment on an issue.
 */
export const create = mutation({
  args: {
    issueId: v.id("issues"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    // Get member record
    const member = await ctx.db
      .query("members")
      .withIndex("by_org_and_user", (q) =>
        q.eq("organizationId", issue.organizationId).eq("userId", userId)
      )
      .first();

    if (!member) throw new Error("Not a member of this organization");

    const now = Date.now();

    const commentId = await ctx.db.insert("comments", {
      organizationId: issue.organizationId,
      issueId: args.issueId,
      body: args.body,
      authorMemberId: member._id,
      authorDisplayName: member.displayName,
      authorGithubUsername: member.githubUsername,
      source: "app",
      createdAt: now,
      updatedAt: now,
      isEdited: false,
    });

    // Increment comment count on issue
    await ctx.db.patch(args.issueId, {
      commentCount: issue.commentCount + 1,
      updatedAt: now,
    });

    // Record activity event
    await ctx.db.insert("activityEvents", {
      organizationId: issue.organizationId,
      issueId: args.issueId,
      eventType: "comment_created",
      actorMemberId: member._id,
      actorDisplayName: member.displayName,
      source: "app",
      createdAt: now,
    });

    // Notify assignee + creator (deduplicated, excluding self)
    const initials = member.displayName
      .split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
    const notifySet = new Set<string>();
    const toNotify: string[] = [];
    if (issue.assigneeId && issue.assigneeId !== member._id) {
      notifySet.add(issue.assigneeId);
      toNotify.push(issue.assigneeId);
    }
    if (issue.creatorId && issue.creatorId !== member._id && !notifySet.has(issue.creatorId)) {
      toNotify.push(issue.creatorId);
    }
    await Promise.all(
      toNotify.map((targetMemberId) =>
        ctx.db.insert("notifications", {
          memberId: targetMemberId as any,
          organizationId: issue.organizationId,
          issueId: args.issueId,
          title: issue.title,
          context: `${member.displayName} commented`,
          isRead: false,
          isSnoozed: false,
          isArchived: false,
          actorDisplayName: member.displayName,
          actorAvatarInitials: initials,
          createdAt: now,
        })
      )
    );

    return commentId;
  },
});

/**
 * Link a Convex comment to its GitHub counterpart.
 */
export const linkToGitHub = mutation({
  args: {
    commentId: v.id("comments"),
    githubCommentId: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentId, {
      githubCommentId: args.githubCommentId,
    });
  },
});
