import { v } from "convex/values";
import { query } from "./_generated/server";

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
