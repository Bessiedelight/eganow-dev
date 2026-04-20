import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";

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

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const activeMemberships = memberships.filter((m) => m.status === "active");
    const organizations = (
      await Promise.all(
        activeMemberships.map((membership) => ctx.db.get(membership.organizationId))
      )
    ).filter((organization): organization is Doc<"organizations"> => organization !== null);

    const installations = await Promise.all(
      organizations.map(async (organization) => {
        const savedInstallation = await ctx.db
          .query("githubInstallations")
          .withIndex("by_installationId", (q) =>
            q.eq("installationId", organization.githubInstallationId)
          )
          .first();

        return {
          _id: savedInstallation?._id,
          userId: savedInstallation?.userId ?? organization.createdBy,
          installationId: organization.githubInstallationId,
          accountLogin:
            savedInstallation?.accountLogin ?? organization.githubAccountLogin,
          accountType:
            savedInstallation?.accountType ?? organization.githubAccountType,
          accountAvatarUrl:
            savedInstallation?.accountAvatarUrl ?? organization.avatarUrl,
          status: "active" as const,
          installedAt: savedInstallation?.installedAt ?? organization.createdAt,
          organizationId: organization._id,
        };
      })
    );

    const deduped = new Map<number, (typeof installations)[number]>();
    for (const installation of installations) {
      deduped.set(installation.installationId, installation);
    }

    return Array.from(deduped.values());
  },
});
