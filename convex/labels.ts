import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * List all labels for an organization.
 */
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("labels")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .collect();
  },
});

/**
 * Create a new label.
 */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    color: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for duplicate
    const existing = await ctx.db
      .query("labels")
      .withIndex("by_name", (q) =>
        q.eq("organizationId", args.orgId).eq("name", args.name)
      )
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert("labels", {
      organizationId: args.orgId,
      name: args.name,
      color: args.color,
      description: args.description,
      source: "app",
      createdAt: Date.now(),
    });
  },
});
