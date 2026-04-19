import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get organizations the current user is a member of.
 */
export const getForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberRecords = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const orgs = await Promise.all(
      memberRecords.map((m) => ctx.db.get(m.organizationId))
    );

    return orgs.filter(Boolean);
  },
});

/**
 * Get a single organization by ID.
 */
export const getById = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.orgId);
  },
});

/**
 * Bootstrap: Create an organization from a GitHub installation
 * if one doesn't already exist. Idempotent.
 */
export const bootstrapFromInstallation = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user already has an org
    const existingMember = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existingMember) {
      return existingMember.organizationId;
    }

    // Find their GitHub installation
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (!installation) {
      // No installation yet — return null instead of throwing to prevent retry loops
      return null;
    }

    // Check if an org already exists for this installation
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_githubInstallationId", (q) =>
        q.eq("githubInstallationId", installation.installationId)
      )
      .first();

    if (existingOrg) {
      // Create member record for this user in the existing org
      const memberId = await ctx.db.insert("members", {
        userId,
        organizationId: existingOrg._id,
        role: "member",
        displayName: installation.accountLogin,
        githubUsername: installation.accountLogin,
        githubAvatarUrl: installation.accountAvatarUrl,
        status: "active",
        joinedAt: Date.now(),
      });
      return existingOrg._id;
    }

    // Create new organization
    const now = Date.now();
    const slug = installation.accountLogin.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    const orgId = await ctx.db.insert("organizations", {
      name: installation.accountLogin,
      slug,
      avatarUrl: installation.accountAvatarUrl,
      githubInstallationId: installation.installationId,
      githubAccountLogin: installation.accountLogin,
      githubAccountType: installation.accountType,
      createdBy: userId,
      createdAt: now,
      issueCounter: 0,
    });

    // Get user info for display name
    const user = await ctx.db.get(userId);
    const displayName = user?.name || user?.email || installation.accountLogin;

    // Create owner member record
    await ctx.db.insert("members", {
      userId,
      organizationId: orgId,
      role: "owner",
      displayName: displayName as string,
      githubUsername: installation.accountLogin,
      githubAvatarUrl: installation.accountAvatarUrl,
      status: "active",
      joinedAt: now,
    });

    // Seed default labels
    const defaultLabels = [
      { name: "bug", color: "#ef4444" },
      { name: "enhancement", color: "#3b82f6" },
      { name: "p0-critical", color: "#f97316" },
      { name: "feature", color: "#a855f7" },
      { name: "tech-debt", color: "#eab308" },
      { name: "documentation", color: "#06b6d4" },
    ];
    for (const label of defaultLabels) {
      await ctx.db.insert("labels", {
        organizationId: orgId,
        name: label.name,
        color: label.color,
        source: "app",
        createdAt: now,
      });
    }

    return orgId;
  },
});
