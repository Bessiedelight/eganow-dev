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

/**
 * Get enriched member detail — teams, projects, issues, PRs, activity.
 */
export const getDetailById = query({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    const member = await ctx.db.get(args.memberId);
    if (!member) return null;

    // Teams
    const teamMemberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .collect();
    const teams = (
      await Promise.all(
        teamMemberships.map(async (tm) => {
          const team = await ctx.db.get(tm.teamId);
          return team ? { _id: team._id, name: team.name, identifier: team.identifier, role: tm.role } : null;
        })
      )
    ).filter(Boolean);

    // Projects (lead)
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", member.organizationId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();
    const projects = allProjects.filter((p) => p.leadMemberId === args.memberId);

    // Assigned issues
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_assigneeId", (q) => q.eq("assigneeId", args.memberId))
      .order("desc")
      .take(30);

    // Authored PRs
    const pullRequests = await ctx.db
      .query("pullRequests")
      .withIndex("by_authorMemberId", (q) => q.eq("authorMemberId", args.memberId))
      .order("desc")
      .take(30);

    // Activity events
    const activity = await ctx.db
      .query("activityEvents")
      .withIndex("by_actorMemberId", (q) => q.eq("actorMemberId", args.memberId))
      .order("desc")
      .take(50);

    // Enrich activity with issue / PR titles
    const enrichedActivity = await Promise.all(
      activity.map(async (event) => {
        let issueTitle: string | undefined;
        let issueIdentifier: string | undefined;
        let prTitle: string | undefined;
        let prNumber: number | undefined;
        let prRepo: string | undefined;
        if (event.issueId) {
          const issue = await ctx.db.get(event.issueId);
          if (issue) { issueTitle = issue.title; issueIdentifier = issue.identifier; }
        }
        if (event.pullRequestId) {
          const pr = await ctx.db.get(event.pullRequestId);
          if (pr) { prTitle = pr.title; prNumber = pr.githubPrNumber; prRepo = pr.githubRepoFullName; }
        }
        return { ...event, issueTitle, issueIdentifier, prTitle, prNumber, prRepo };
      })
    );

    return {
      ...member,
      teams,
      projects: projects.map((p) => ({ _id: p._id, name: p.name, status: p.status })),
      issues: issues.map((i) => ({ _id: i._id, identifier: i.identifier, title: i.title, status: i.status, priority: i.priority })),
      pullRequests: pullRequests.map((pr) => ({
        _id: pr._id, title: pr.title, state: pr.state, githubPrNumber: pr.githubPrNumber,
        githubRepoFullName: pr.githubRepoFullName, additions: pr.additions, deletions: pr.deletions,
        changedFiles: pr.changedFiles, isDraft: pr.isDraft,
      })),
      activity: enrichedActivity,
    };
  },
});

/**
 * List activity events performed by a member.
 */
export const listActivity = query({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activityEvents")
      .withIndex("by_actorMemberId", (q) => q.eq("actorMemberId", args.memberId))
      .order("desc")
      .take(50);
  },
});
