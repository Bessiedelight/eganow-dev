import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ─── Queries ──────────────────────────────────────────────────

/**
 * List all teams for an organization, enriched with member count, issue count, etc.
 */
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const enriched = await Promise.all(
      teams.map(async (team) => {
        // Get members
        const teamMembers = await ctx.db
          .query("teamMembers")
          .withIndex("by_teamId", (q) => q.eq("teamId", team._id))
          .collect();

        // Resolve member details
        const members = await Promise.all(
          teamMembers.map(async (tm) => {
            const member = await ctx.db.get(tm.memberId);
            return member
              ? {
                  _id: member._id,
                  displayName: member.displayName,
                  githubUsername: member.githubUsername,
                  role: tm.role,
                }
              : null;
          })
        );

        // Count issues assigned to this team
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_teamId", (q) => q.eq("teamId", team._id))
          .collect();

        // Count PRs assigned to this team
        const prs = await ctx.db
          .query("pullRequests")
          .withIndex("by_teamId", (q) => q.eq("teamId", team._id))
          .collect();

        return {
          ...team,
          members: members.filter(Boolean),
          memberCount: teamMembers.length,
          issueCount: issues.length,
          openIssueCount: issues.filter(
            (i) => i.status !== "done" && i.status !== "cancelled"
          ).length,
          prCount: prs.length,
        };
      })
    );

    return enriched;
  },
});

/**
 * Get a team by ID with full details (members, stats).
 */
export const getById = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) return null;

    // Get team members
    const teamMembers = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId", (q) => q.eq("teamId", team._id))
      .collect();

    const members = await Promise.all(
      teamMembers.map(async (tm) => {
        const member = await ctx.db.get(tm.memberId);
        return member
          ? {
              _id: member._id,
              displayName: member.displayName,
              githubUsername: member.githubUsername,
              githubAvatarUrl: member.githubAvatarUrl,
              role: tm.role,
              joinedAt: tm.joinedAt,
            }
          : null;
      })
    );

    // Count issues
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_teamId", (q) => q.eq("teamId", team._id))
      .collect();

    const prs = await ctx.db
      .query("pullRequests")
      .withIndex("by_teamId", (q) => q.eq("teamId", team._id))
      .collect();

    return {
      ...team,
      members: members.filter(Boolean),
      memberCount: teamMembers.length,
      issueCount: issues.length,
      openIssueCount: issues.filter(
        (i) => i.status !== "done" && i.status !== "cancelled"
      ).length,
      prCount: prs.length,
    };
  },
});

/**
 * List issues for a specific team.
 */
export const listIssuesByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .order("desc")
      .collect();

    // Enrich with assignee + labels
    return Promise.all(
      issues.map(async (issue) => {
        const assignee = issue.assigneeId
          ? await ctx.db.get(issue.assigneeId)
          : null;
        const labels = issue.labelIds
          ? await Promise.all(issue.labelIds.map((id) => ctx.db.get(id)))
          : [];
        return {
          ...issue,
          assignee: assignee
            ? { displayName: assignee.displayName, githubUsername: assignee.githubUsername }
            : null,
          labels: labels.filter(Boolean),
        };
      })
    );
  },
});

/**
 * List pull requests for a specific team.
 */
export const listPRsByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const prs = await ctx.db
      .query("pullRequests")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .order("desc")
      .collect();

    return prs;
  },
});

// ─── Mutations ────────────────────────────────────────────────

/**
 * Create a new team.
 */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    identifier: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.db.insert("teams", {
      organizationId: args.orgId,
      name: args.name,
      identifier: args.identifier.toUpperCase(),
      description: args.description,
      icon: args.icon,
      color: args.color,
      createdBy: userId,
      createdAt: Date.now(),
      isArchived: false,
    });
  },
});

/**
 * Update a team's details.
 */
export const update = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.icon !== undefined) updates.icon = args.icon;
    if (args.color !== undefined) updates.color = args.color;
    await ctx.db.patch(args.teamId, updates);
  },
});

/**
 * Add a member to a team.
 */
export const addMember = mutation({
  args: {
    teamId: v.id("teams"),
    memberId: v.id("members"),
    role: v.union(v.literal("lead"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    // Check if already in team
    const existing = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_member", (q) =>
        q.eq("teamId", args.teamId).eq("memberId", args.memberId)
      )
      .first();

    if (existing) {
      // Update role if changed
      if (existing.role !== args.role) {
        await ctx.db.patch(existing._id, { role: args.role });
      }
      return existing._id;
    }

    return await ctx.db.insert("teamMembers", {
      teamId: args.teamId,
      memberId: args.memberId,
      role: args.role,
      joinedAt: Date.now(),
    });
  },
});

/**
 * Remove a member from a team.
 */
export const removeMember = mutation({
  args: {
    teamId: v.id("teams"),
    memberId: v.id("members"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_member", (q) =>
        q.eq("teamId", args.teamId).eq("memberId", args.memberId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Archive (soft-delete) a team.
 */
export const archive = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.teamId, { isArchived: true });
  },
});

/**
 * List teams the current user belongs to (for sidebar).
 */
export const listMyTeams = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Find the user's member record
    const member = await ctx.db
      .query("members")
      .withIndex("by_org_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", userId)
      )
      .first();

    if (!member) return [];

    // Find all teamMembers entries for this member
    const teamMemberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_memberId", (q) => q.eq("memberId", member._id))
      .collect();

    // Resolve team details
    const teams = await Promise.all(
      teamMemberships.map(async (tm) => {
        const team = await ctx.db.get(tm.teamId);
        return team && !team.isArchived
          ? { _id: team._id, name: team.name, identifier: team.identifier, icon: team.icon, color: team.color }
          : null;
      })
    );

    return teams.filter(Boolean);
  },
});
