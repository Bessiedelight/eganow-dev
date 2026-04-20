import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

async function getCurrentMember(ctx: any, issueId: any) {
  const issue = await ctx.db.get(issueId);
  if (!issue) return null;
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q: any) =>
      q.eq("organizationId", issue.organizationId).eq("userId", userId)
    )
    .first();
  return { issue, member };
}

function formatPrIdentifier(pr: any) {
  return `${pr.githubRepoFullName}#${pr.githubPrNumber}`;
}

/**
 * List activity events for an issue, ordered by time.
 */
export const listByIssue = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activityEvents")
      .withIndex("by_issueId", (q) => q.eq("issueId", args.issueId))
      .order("asc")
      .collect();
  },
});

/**
 * List activity events for a pull request, ordered by time.
 */
export const listByPullRequest = query({
  args: { pullRequestId: v.id("pullRequests") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activityEvents")
      .withIndex("by_pullRequestId", (q) =>
        q.eq("pullRequestId", args.pullRequestId)
      )
      .order("asc")
      .collect();
  },
});

export const getIssueThread = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      return { items: [], latestTimestamp: 0 };
    }

    const issueEvents = await ctx.db
      .query("activityEvents")
      .withIndex("by_issueId", (q) => q.eq("issueId", args.issueId))
      .order("asc")
      .collect();

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issueId", (q) => q.eq("issueId", args.issueId))
      .order("asc")
      .collect();

    const links = await ctx.db
      .query("issuesPullRequests")
      .withIndex("by_issueId", (q) => q.eq("issueId", args.issueId))
      .collect();

    const linkedPrEvents = (
      await Promise.all(
        links.map(async (link) => {
          const pr = await ctx.db.get(link.pullRequestId);
          if (!pr) return [];
          const events = await ctx.db
            .query("activityEvents")
            .withIndex("by_pullRequestId", (q) =>
              q.eq("pullRequestId", link.pullRequestId)
            )
            .order("asc")
            .collect();

          return events
            .filter((event) =>
              [
                "pull_request_linked_to_issue",
                "pull_request_state_changed",
                "pull_request_checks_changed",
                "pull_request_review_requested",
                "pull_request_project_changed",
                "pull_request_team_changed",
              ].includes(event.eventType)
            )
            .filter((event) => !(event.eventType === "pull_request_linked_to_issue" && event.issueId === args.issueId))
            .map((event) => ({
              _id: event._id,
              type: "event" as const,
              scope: "pullRequest" as const,
              createdAt: event.createdAt,
              actorDisplayName: event.actorDisplayName,
              eventType: event.eventType,
              metadata: event.metadata ?? null,
              pullRequest: {
                _id: pr._id,
                identifier: formatPrIdentifier(pr),
                title: pr.title,
                state: pr.state,
              },
            }));
        })
      )
    ).flat();

    const normalizedIssueEvents = issueEvents
      .filter((event) => event.eventType !== "comment_created")
      .map((event) => ({
        _id: event._id,
        type: "event" as const,
        scope: "issue" as const,
        createdAt: event.createdAt,
        actorDisplayName: event.actorDisplayName,
        eventType: event.eventType,
        metadata: event.metadata ?? null,
      }));

    const normalizedComments = comments.map((comment) => ({
      _id: comment._id,
      type: "comment" as const,
      scope: "issue" as const,
      createdAt: comment.createdAt,
      authorDisplayName: comment.authorDisplayName,
      body: comment.body,
      githubCommentId: comment.githubCommentId ?? null,
    }));

    const items = [
      ...normalizedIssueEvents,
      ...normalizedComments,
      ...linkedPrEvents,
    ].sort((a, b) => a.createdAt - b.createdAt);

    const latestTimestamp =
      items.length > 0 ? items[items.length - 1].createdAt : issue.updatedAt;

    return {
      items,
      latestTimestamp,
    };
  },
});

export const markIssueThreadSeen = mutation({
  args: {
    issueId: v.id("issues"),
    lastSeenActivityAt: v.number(),
  },
  handler: async (ctx, args) => {
    const current = await getCurrentMember(ctx, args.issueId);
    if (!current?.member) return null;

    const existing = await ctx.db
      .query("issueViews")
      .withIndex("by_memberId_and_issueId", (q) =>
        q.eq("memberId", current.member._id).eq("issueId", args.issueId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenActivityAt: Math.max(
          existing.lastSeenActivityAt,
          args.lastSeenActivityAt
        ),
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("issueViews", {
      memberId: current.member._id,
      issueId: args.issueId,
      lastSeenActivityAt: args.lastSeenActivityAt,
      updatedAt: Date.now(),
    });
  },
});
