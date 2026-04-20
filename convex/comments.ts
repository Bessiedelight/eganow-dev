import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

type CommentTarget = {
  issue: Doc<"issues"> | null;
  pullRequest: Doc<"pullRequests"> | null;
  organizationId: Id<"organizations">;
};

async function getCurrentMember(ctx: any, organizationId: Id<"organizations">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  return await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q: any) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .unique();
}

async function resolveTarget(
  ctx: any,
  args: { issueId?: Id<"issues">; pullRequestId?: Id<"pullRequests"> }
): Promise<CommentTarget> {
  if ((args.issueId && args.pullRequestId) || (!args.issueId && !args.pullRequestId)) {
    throw new Error("Provide either issueId or pullRequestId");
  }

  if (args.issueId) {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");
    return { issue, pullRequest: null, organizationId: issue.organizationId };
  }

  const pullRequest = await ctx.db.get(args.pullRequestId!);
  if (!pullRequest) throw new Error("Pull request not found");
  return {
    issue: null,
    pullRequest,
    organizationId: pullRequest.organizationId,
  };
}

async function enrichComment(ctx: any, comment: Doc<"comments">, currentMemberId?: Id<"members"> | null) {
  const attachmentDocs = await ctx.db
    .query("commentAttachments")
    .withIndex("by_commentId", (q: any) => q.eq("commentId", comment._id))
    .order("asc")
    .take(20);

  const reactionDocs = await ctx.db
    .query("commentReactions")
    .withIndex("by_commentId", (q: any) => q.eq("commentId", comment._id))
    .order("asc")
    .take(100);

  const reactionsMap = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean }
  >();

  for (const reaction of reactionDocs) {
    const existing = reactionsMap.get(reaction.emoji);
    if (existing) {
      existing.count += 1;
      if (currentMemberId && reaction.memberId === currentMemberId) {
        existing.reactedByMe = true;
      }
      continue;
    }

    reactionsMap.set(reaction.emoji, {
      emoji: reaction.emoji,
      count: 1,
      reactedByMe: !!currentMemberId && reaction.memberId === currentMemberId,
    });
  }

  const attachments = await Promise.all(
    attachmentDocs.map(async (attachment: Doc<"commentAttachments">) => ({
      ...attachment,
      url: await ctx.storage.getUrl(attachment.storageId),
      isImage: !!attachment.contentType?.startsWith("image/"),
    }))
  );

  return {
    ...comment,
    attachments,
    reactions: Array.from(reactionsMap.values()),
  };
}

async function createCommentRecord(
  ctx: any,
  args: {
    member: Doc<"members">;
    issue: Doc<"issues"> | null;
    pullRequest: Doc<"pullRequests"> | null;
    body: string;
    parentCommentId?: Id<"comments">;
    attachments?: Array<{
      storageId: Id<"_storage">;
      fileName: string;
      contentType?: string;
      size?: number;
    }>;
  }
) {
  const now = Date.now();
  const organizationId = args.issue?.organizationId ?? args.pullRequest!.organizationId;

  let parentComment: Doc<"comments"> | null = null;
  if (args.parentCommentId) {
    parentComment = await ctx.db.get(args.parentCommentId);
    if (!parentComment) throw new Error("Parent comment not found");

    const sameIssue =
      !!args.issue &&
      parentComment.issueId &&
      parentComment.issueId === args.issue._id;
    const samePullRequest =
      !!args.pullRequest &&
      parentComment.pullRequestId &&
      parentComment.pullRequestId === args.pullRequest._id;

    if (!sameIssue && !samePullRequest) {
      throw new Error("Reply must belong to the same discussion");
    }
  }

  const commentId = await ctx.db.insert("comments", {
    organizationId,
    issueId: args.issue?._id,
    pullRequestId: args.pullRequest?._id,
    body: args.body,
    authorMemberId: args.member._id,
    authorDisplayName: args.member.displayName,
    authorGithubUsername: args.member.githubUsername,
    authorAvatarUrl: args.member.githubAvatarUrl,
    source: "app",
    parentCommentId: args.parentCommentId,
    createdAt: now,
    updatedAt: now,
    isEdited: false,
  });

  for (const attachment of args.attachments || []) {
    await ctx.db.insert("commentAttachments", {
      commentId,
      storageId: attachment.storageId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      size: attachment.size,
      createdAt: now,
    });
  }

  if (args.issue) {
    await ctx.db.patch(args.issue._id, {
      commentCount: args.issue.commentCount + 1,
      updatedAt: now,
    });
  }

  if (args.pullRequest) {
    await ctx.db.patch(args.pullRequest._id, {
      commentCount: (args.pullRequest.commentCount ?? 0) + 1,
      updatedAt: now,
    });
  }

  const eventType = args.parentCommentId ? "comment_replied" : "comment_created";
  const activityEventId = await ctx.db.insert("activityEvents", {
    organizationId,
    issueId: args.issue?._id,
    pullRequestId: args.pullRequest?._id,
    teamId: args.issue?.teamId ?? args.pullRequest?.teamId,
    projectId: args.issue?.projectId ?? args.pullRequest?.projectId,
    eventType,
    actorMemberId: args.member._id,
    actorDisplayName: args.member.displayName,
    metadata: {
      commentId,
      parentCommentId: args.parentCommentId,
    },
    source: "app",
    createdAt: now,
  });

  const recipientIds = new Set<Id<"members">>();
  if (args.issue?.assigneeId) recipientIds.add(args.issue.assigneeId);
  if (args.issue?.creatorId) recipientIds.add(args.issue.creatorId);
  if (args.pullRequest?.authorMemberId) recipientIds.add(args.pullRequest.authorMemberId);
  if (parentComment?.authorMemberId) recipientIds.add(parentComment.authorMemberId);

  const recentComments = args.issue
    ? await ctx.db
        .query("comments")
        .withIndex("by_issueId", (q: any) => q.eq("issueId", args.issue!._id))
        .order("desc")
        .take(50)
    : await ctx.db
        .query("comments")
        .withIndex("by_pullRequestId", (q: any) =>
          q.eq("pullRequestId", args.pullRequest!._id)
        )
        .order("desc")
        .take(50);

  for (const comment of recentComments) {
    if (comment.authorMemberId) recipientIds.add(comment.authorMemberId);
  }

  recipientIds.delete(args.member._id);

  const initials = args.member.displayName
    .split(" ")
    .map((word: string) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  for (const memberId of recipientIds) {
    await ctx.db.insert("notifications", {
      memberId,
      organizationId,
      issueId: args.issue?._id,
      pullRequestId: args.pullRequest?._id,
      activityEventId,
      title: args.issue?.title ?? args.pullRequest?.title ?? "Discussion",
      context: args.parentCommentId
        ? `${args.member.displayName} replied in discussion`
        : `${args.member.displayName} commented in discussion`,
      isRead: false,
      isSnoozed: false,
      isArchived: false,
      actorDisplayName: args.member.displayName,
      actorAvatarInitials: initials,
      createdAt: now,
    });
  }

  return commentId;
}

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

export const listThread = query({
  args: {
    orgId: v.id("organizations"),
    issueId: v.optional(v.id("issues")),
    pullRequestId: v.optional(v.id("pullRequests")),
  },
  handler: async (ctx, args) => {
    const target = await resolveTarget(ctx, {
      issueId: args.issueId,
      pullRequestId: args.pullRequestId,
    });
    if (target.organizationId !== args.orgId) return [];

    const currentMember = await getCurrentMember(ctx, args.orgId);
    if (!currentMember) return [];

    const commentDocs = target.issue
      ? await ctx.db
          .query("comments")
          .withIndex("by_issueId", (q: any) => q.eq("issueId", target.issue!._id))
          .order("desc")
          .take(200)
      : await ctx.db
          .query("comments")
          .withIndex("by_pullRequestId", (q: any) =>
            q.eq("pullRequestId", target.pullRequest!._id)
          )
          .order("desc")
          .take(200);

    const comments = [...commentDocs].reverse();
    return await Promise.all(
      comments.map((comment) => enrichComment(ctx, comment, currentMember._id))
    );
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
    const target = await resolveTarget(ctx, { issueId: args.issueId });
    const member = await getCurrentMember(ctx, target.organizationId);
    if (!member) throw new Error("Not authenticated");

    return await createCommentRecord(ctx, {
      member,
      issue: target.issue,
      pullRequest: null,
      body: args.body,
    });
  },
});

export const generateAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const createThreadComment = mutation({
  args: {
    issueId: v.optional(v.id("issues")),
    pullRequestId: v.optional(v.id("pullRequests")),
    parentCommentId: v.optional(v.id("comments")),
    body: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          fileName: v.string(),
          contentType: v.optional(v.string()),
          size: v.optional(v.number()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const target = await resolveTarget(ctx, {
      issueId: args.issueId,
      pullRequestId: args.pullRequestId,
    });
    const member = await getCurrentMember(ctx, target.organizationId);
    if (!member) throw new Error("Not authenticated");

    return await createCommentRecord(ctx, {
      member,
      issue: target.issue,
      pullRequest: target.pullRequest,
      body: args.body,
      parentCommentId: args.parentCommentId,
      attachments: args.attachments,
    });
  },
});

export const toggleReaction = mutation({
  args: {
    commentId: v.id("comments"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");

    const member = await getCurrentMember(ctx, comment.organizationId);
    if (!member) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("commentReactions")
      .withIndex("by_commentId_and_memberId_and_emoji", (q: any) =>
        q.eq("commentId", args.commentId).eq("memberId", member._id).eq("emoji", args.emoji)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { reacted: false };
    }

    await ctx.db.insert("commentReactions", {
      commentId: args.commentId,
      memberId: member._id,
      emoji: args.emoji,
      createdAt: Date.now(),
    });

    return { reacted: true };
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
