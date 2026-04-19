import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ─── Queries ──────────────────────────────────────────────────

/**
 * List all projects for an organization.
 */
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();
  },
});

/**
 * Get a project by ID.
 */
export const getById = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
  },
});

/**
 * Get a project by ID, enriched with lead team, lead member, and counts.
 */
export const getByIdEnriched = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;

    const leadTeam = project.leadTeamId
      ? await ctx.db.get(project.leadTeamId)
      : null;

    const leadMember = project.leadMemberId
      ? await ctx.db.get(project.leadMemberId)
      : null;

    // Count issues
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const totalIssues = issues.length;
    const doneIssues = issues.filter(
      (i) => i.status === "done" || i.status === "cancelled"
    ).length;

    // Count PRs
    const prs = await ctx.db
      .query("pullRequests")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const totalPRs = prs.length;
    const mergedPRs = prs.filter((p) => p.state === "merged").length;
    const openPRs = prs.filter((p) => p.state === "open").length;

    return {
      ...project,
      leadTeam,
      leadMember,
      counts: { totalIssues, doneIssues, totalPRs, mergedPRs, openPRs },
    };
  },
});

/**
 * Find a project that owns a given repo (for webhook auto-linking).
 */
export const getByRepo = query({
  args: {
    orgId: v.id("organizations"),
    repoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    return (
      projects.find((p) =>
        p.githubRepoFullNames?.includes(args.repoFullName)
      ) ?? null
    );
  },
});

/**
 * List all issues belonging to a project (enriched with assignee, labels, linked PRs).
 */
export const listIssues = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const enriched = await Promise.all(
      issues.map(async (issue) => {
        const assignee = issue.assigneeId
          ? await ctx.db.get(issue.assigneeId)
          : null;

        const team = issue.teamId ? await ctx.db.get(issue.teamId) : null;

        const labels = issue.labelIds
          ? await Promise.all(issue.labelIds.map((id) => ctx.db.get(id)))
          : [];

        // Get linked PRs
        const linkedPRs = await ctx.db
          .query("issuesPullRequests")
          .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
          .collect();

        let prHealth = null;
        if (linkedPRs.length > 0) {
          const prDoc = await ctx.db.get(linkedPRs[0].pullRequestId);
          if (prDoc) {
            prHealth = {
              prNumber: prDoc.githubPrNumber,
              state: prDoc.state,
              checks: prDoc.checksStatus || null,
              mergeable: prDoc.mergeable ?? null,
              additions: prDoc.additions ?? 0,
              deletions: prDoc.deletions ?? 0,
            };
          }
        }

        return {
          ...issue,
          assignee,
          team,
          labels: labels.filter(Boolean),
          prHealth,
        };
      })
    );

    return enriched;
  },
});

/**
 * List all PRs belonging to a project (enriched with author, linked issues).
 */
export const listPullRequests = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const prs = await ctx.db
      .query("pullRequests")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const enriched = await Promise.all(
      prs.map(async (pr) => {
        const authorMember = pr.authorMemberId
          ? await ctx.db.get(pr.authorMemberId)
          : null;

        const links = await ctx.db
          .query("issuesPullRequests")
          .withIndex("by_pullRequestId", (q) =>
            q.eq("pullRequestId", pr._id)
          )
          .collect();

        const linkedIssues = await Promise.all(
          links.map(async (link) => {
            const issue = await ctx.db.get(link.issueId);
            return issue
              ? {
                  identifier: issue.identifier,
                  title: issue.title,
                  status: issue.status,
                  linkType: link.linkType,
                }
              : null;
          })
        );

        return {
          ...pr,
          authorMember,
          linkedIssues: linkedIssues.filter(Boolean),
        };
      })
    );

    return enriched;
  },
});

/**
 * List activity events for a project.
 */
export const listActivity = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activityEvents")
      .withIndex("by_organizationId")
      .filter((q) => q.eq(q.field("projectId"), args.projectId))
      .order("desc")
      .take(50);
  },
});

/**
 * Get computed stats for the project dashboard.
 */
export const getStats = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const prs = await ctx.db
      .query("pullRequests")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const totalIssues = issues.length;
    const doneIssues = issues.filter((i) => i.status === "done").length;
    const openIssues = issues.filter(
      (i) => i.status !== "done" && i.status !== "cancelled"
    ).length;

    const totalPRs = prs.length;
    const mergedPRs = prs.filter((p) => p.state === "merged");
    const openPRs = prs.filter((p) => p.state === "open");
    const failedCheckPRs = prs.filter(
      (p) => p.checksStatus === "failure" && p.state === "open"
    );

    // Average merge time (in hours)
    let avgMergeTimeHours = 0;
    if (mergedPRs.length > 0) {
      const totalMs = mergedPRs.reduce((acc, pr) => {
        if (pr.mergedAt && pr.createdAt) {
          return acc + (pr.mergedAt - pr.createdAt);
        }
        return acc;
      }, 0);
      avgMergeTimeHours = totalMs / mergedPRs.length / (1000 * 60 * 60);
    }

    // CI success rate
    const prsWithChecks = prs.filter((p) => p.checksStatus);
    const successfulChecks = prsWithChecks.filter(
      (p) => p.checksStatus === "success"
    );
    const ciSuccessRate =
      prsWithChecks.length > 0
        ? Math.round((successfulChecks.length / prsWithChecks.length) * 100)
        : 100;

    // Blocked tasks: issues whose linked PR has failed checks
    let blockedTasks = 0;
    for (const issue of issues) {
      if (issue.status === "done" || issue.status === "cancelled") continue;
      const links = await ctx.db
        .query("issuesPullRequests")
        .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const link of links) {
        const pr = await ctx.db.get(link.pullRequestId);
        if (pr && pr.checksStatus === "failure" && pr.state === "open") {
          blockedTasks++;
          break;
        }
      }
    }

    return {
      totalIssues,
      doneIssues,
      openIssues,
      totalPRs,
      mergedPRs: mergedPRs.length,
      openPRs: openPRs.length,
      failedCheckPRs: failedCheckPRs.length,
      avgMergeTimeHours: Math.round(avgMergeTimeHours * 10) / 10,
      ciSuccessRate,
      blockedTasks,
    };
  },
});

// ─── Mutations ────────────────────────────────────────────────

/**
 * Create a new project.
 */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    leadTeamId: v.optional(v.id("teams")),
    leadMemberId: v.optional(v.id("members")),
    githubRepoFullNames: v.optional(v.array(v.string())),
    startDate: v.optional(v.number()),
    targetDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      organizationId: args.orgId,
      name: args.name,
      description: args.description,
      icon: args.icon,
      color: args.color,
      status: "planned",
      leadTeamId: args.leadTeamId,
      leadMemberId: args.leadMemberId,
      githubRepoFullNames: args.githubRepoFullNames,
      startDate: args.startDate,
      targetDate: args.targetDate,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
    });

    // Auto-link existing issues/PRs for the assigned repos
    if (args.githubRepoFullNames && args.githubRepoFullNames.length > 0) {
      await autoLinkEntities(ctx, projectId, args.githubRepoFullNames);
    }

    return projectId;
  },
});

/**
 * Update a project.
 */
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("planned"),
        v.literal("in_progress"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("cancelled")
      )
    ),
    leadTeamId: v.optional(v.id("teams")),
    leadMemberId: v.optional(v.id("members")),
    githubRepoFullNames: v.optional(v.array(v.string())),
    startDate: v.optional(v.number()),
    targetDate: v.optional(v.number()),
    progress: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const updates: Record<string, any> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.icon !== undefined) updates.icon = args.icon;
    if (args.color !== undefined) updates.color = args.color;
    if (args.status !== undefined) {
      updates.status = args.status;
      if (args.status === "completed") updates.completedAt = Date.now();
    }
    if (args.leadTeamId !== undefined) updates.leadTeamId = args.leadTeamId;
    if (args.leadMemberId !== undefined)
      updates.leadMemberId = args.leadMemberId;
    if (args.startDate !== undefined) updates.startDate = args.startDate;
    if (args.targetDate !== undefined) updates.targetDate = args.targetDate;
    if (args.progress !== undefined) updates.progress = args.progress;

    // Handle repo changes — auto-link entities for any NEW repos
    if (args.githubRepoFullNames !== undefined) {
      updates.githubRepoFullNames = args.githubRepoFullNames;
      const oldRepos = project.githubRepoFullNames || [];
      const newRepos = args.githubRepoFullNames.filter(
        (r) => !oldRepos.includes(r)
      );
      if (newRepos.length > 0) {
        await autoLinkEntities(ctx, args.projectId, newRepos);
      }
    }

    await ctx.db.patch(args.projectId, updates);
  },
});

/**
 * Archive a project.
 */
export const archive = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      isArchived: true,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal: find the project that owns a repo, then return its ID.
 * Used by webhook handlers to auto-assign projectId.
 */
export const findProjectForRepo = mutation({
  args: {
    orgId: v.id("organizations"),
    repoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const match = projects.find((p) =>
      p.githubRepoFullNames?.includes(args.repoFullName)
    );

    return match?._id ?? null;
  },
});

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Auto-link existing issues and PRs from the given repos to a project.
 */
async function autoLinkEntities(
  ctx: any,
  projectId: any,
  repoFullNames: string[]
) {
  for (const repo of repoFullNames) {
    // Link existing issues from this repo that have no project
    const issues = await ctx.db
      .query("issues")
      .filter((q: any) =>
        q.and(
          q.eq(q.field("githubRepoFullName"), repo),
          q.or(
            q.eq(q.field("projectId"), undefined),
            q.eq(q.field("projectId"), null)
          )
        )
      )
      .collect();

    for (const issue of issues) {
      await ctx.db.patch(issue._id, { projectId, updatedAt: Date.now() });
    }

    // Link existing PRs from this repo that have no project
    const prs = await ctx.db
      .query("pullRequests")
      .filter((q: any) =>
        q.and(
          q.eq(q.field("githubRepoFullName"), repo),
          q.or(
            q.eq(q.field("projectId"), undefined),
            q.eq(q.field("projectId"), null)
          )
        )
      )
      .collect();

    for (const pr of prs) {
      await ctx.db.patch(pr._id, { projectId, updatedAt: Date.now() });
    }
  }
}
