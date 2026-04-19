import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Save a GitHub App installation linked to the current user.
 */
export const saveInstallation = mutation({
  args: {
    installationId: v.number(),
    accountLogin: v.string(),
    accountType: v.string(),
    accountAvatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if this installation already exists
    const existing = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) =>
        q.eq("installationId", args.installationId)
      )
      .unique();

    if (existing) {
      // Update existing installation
      await ctx.db.patch(existing._id, {
        accountLogin: args.accountLogin,
        accountType: args.accountType,
        accountAvatarUrl: args.accountAvatarUrl,
        status: "active",
      });
      return existing._id;
    }

    // Create new installation record
    return await ctx.db.insert("githubInstallations", {
      userId,
      installationId: args.installationId,
      accountLogin: args.accountLogin,
      accountType: args.accountType,
      accountAvatarUrl: args.accountAvatarUrl,
      status: "active",
      installedAt: Date.now(),
    });
  },
});

/**
 * Remove a GitHub App installation.
 */
export const removeInstallation = mutation({
  args: {
    installationId: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) =>
        q.eq("installationId", args.installationId)
      )
      .unique();

    if (installation && installation.userId === userId) {
      await ctx.db.patch(installation._id, { status: "removed" });
    }
  },
});

/**
 * Look up a GitHub installation by its GitHub-native installation ID.
 * Returns the installation record with the organizationId attached.
 * Used by webhook handlers to resolve which org an event belongs to.
 */
export const getInstallationByGitHubId = query({
  args: { installationId: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) =>
        q.eq("installationId", args.installationId)
      )
      .first();

    if (!installation) return null;

    // Find the org that owns this installation
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_githubInstallationId", (q) =>
        q.eq("githubInstallationId", args.installationId)
      )
      .first();

    if (!org) return null;

    return {
      ...installation,
      organizationId: org._id,
    };
  },
});

/**
 * Get the current user's GitHub App installations.
 */
export const getMyInstallations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const installations = await ctx.db
      .query("githubInstallations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return installations.filter((i) => i.status === "active");
  },
});
