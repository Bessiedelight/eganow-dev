import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get the current user's member record for a specific org.
 */
export const getCurrent = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query("members")
      .withIndex("by_org_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", userId)
      )
      .first();
  },
});

/**
 * List all active members of an organization.
 */
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("members")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    return members;
  },
});

/**
 * Get a member by ID.
 */
export const getById = query({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.memberId);
  },
});
