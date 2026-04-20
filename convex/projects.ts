import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
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
 * Build project board data from project issues plus linked / standalone PRs.
 * This keeps the project board relationship-aware without changing the rest of the app.
 */
export const getBoardData = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      return {
        issues: [],
        standalonePullRequests: [],
      };
    }

    const projectIssues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const directProjectPrs = await ctx.db
      .query("pullRequests")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const linkedPrIds = new Set<string>();
    const linkedProjectIssueIds = new Set<string>();

    const issues = await Promise.all(
      projectIssues.map(async (issue) => {
        const assignee = issue.assigneeId
          ? await ctx.db.get(issue.assigneeId)
          : null;

        const team = issue.teamId ? await ctx.db.get(issue.teamId) : null;

        const links = await ctx.db
          .query("issuesPullRequests")
          .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
          .collect();

        const linkedPullRequests = (
          await Promise.all(
            links.map(async (link) => {
              const pr = await ctx.db.get(link.pullRequestId);
              if (!pr) return null;

              linkedPrIds.add(pr._id);
              linkedProjectIssueIds.add(issue._id);

              const authorMember = pr.authorMemberId
                ? await ctx.db.get(pr.authorMemberId)
                : null;

              return {
                _id: pr._id,
                githubPrNumber: pr.githubPrNumber,
                githubRepoFullName: pr.githubRepoFullName,
                title: pr.title,
                state: pr.state,
                isDraft: pr.isDraft,
                checksStatus: pr.checksStatus || null,
                mergeable: pr.mergeable ?? null,
                additions: pr.additions ?? 0,
                deletions: pr.deletions ?? 0,
                changedFiles: pr.changedFiles ?? 0,
                linkType: link.linkType,
                updatedAt: pr.updatedAt,
                authorMember,
                authorGithubUsername: pr.authorGithubUsername,
              };
            })
          )
        ).filter((pr): pr is NonNullable<typeof pr> => pr !== null);

        const primaryLinkedPullRequest = linkedPullRequests[0] ?? null;

        return {
          ...issue,
          assignee,
          team,
          linkedPullRequests,
          prHealth: primaryLinkedPullRequest
            ? {
                prNumber: primaryLinkedPullRequest.githubPrNumber,
                state: primaryLinkedPullRequest.state,
                checks: primaryLinkedPullRequest.checksStatus,
                mergeable: primaryLinkedPullRequest.mergeable,
                additions: primaryLinkedPullRequest.additions,
                deletions: primaryLinkedPullRequest.deletions,
              }
            : null,
        };
      })
    );

    const standalonePullRequests = (
      await Promise.all(
        directProjectPrs.map(async (pr) => {
          if (linkedPrIds.has(pr._id)) return null;

          const authorMember = pr.authorMemberId
            ? await ctx.db.get(pr.authorMemberId)
            : null;

          const team = pr.teamId ? await ctx.db.get(pr.teamId) : null;

          const links = await ctx.db
            .query("issuesPullRequests")
            .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", pr._id))
            .collect();

          const linkedIssues = (
            await Promise.all(
              links.map(async (link) => {
                const issue = await ctx.db.get(link.issueId);
                if (!issue) return null;
                return {
                  _id: issue._id,
                  identifier: issue.identifier,
                  title: issue.title,
                  status: issue.status,
                  projectId: issue.projectId ?? null,
                  linkType: link.linkType,
                };
              })
            )
          ).filter((issue): issue is NonNullable<typeof issue> => issue !== null);

          const hasLinkedProjectIssue = linkedIssues.some(
            (issue) => issue.projectId === args.projectId
          );

          if (hasLinkedProjectIssue) return null;

          return {
            ...pr,
            authorMember,
            team,
            linkedIssues,
          };
        })
      )
    )
      .filter((pr): pr is NonNullable<typeof pr> => pr !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      issues,
      standalonePullRequests,
    };
  },
});

/**
 * Build delivery dashboard data from the project's assigned issues plus
 * GitHub activity across the project's connected repositories.
 */
export const getDashboardData = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      return {
        stats: {
          totalIssues: 0,
          doneIssues: 0,
          openIssues: 0,
          totalPRs: 0,
          mergedPRs: 0,
          openPRs: 0,
          failedCheckPRs: 0,
          avgMergeTimeHours: 0,
          ciSuccessRate: 100,
          blockedTasks: 0,
        },
        pullRequests: [],
      };
    }

    const repos = project.githubRepoFullNames ?? [];

    const issues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const prMap = new Map<string, any>();

    const directProjectPrs = await ctx.db
      .query("pullRequests")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const pr of directProjectPrs) {
      prMap.set(pr._id, pr);
    }

    for (const repo of repos) {
      const repoPrs = await ctx.db
        .query("pullRequests")
        .withIndex("by_github", (q) => q.eq("githubRepoFullName", repo))
        .collect();
      for (const pr of repoPrs) {
        prMap.set(pr._id, pr);
      }
    }

    for (const issue of issues) {
      const links = await ctx.db
        .query("issuesPullRequests")
        .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const link of links) {
        const pr = await ctx.db.get(link.pullRequestId);
        if (pr) {
          prMap.set(pr._id, pr);
        }
      }
    }

    const prs = await Promise.all(
      Array.from(prMap.values()).map(async (pr) => {
        const authorMember = pr.authorMemberId
          ? await ctx.db.get(pr.authorMemberId)
          : null;

        const links = await ctx.db
          .query("issuesPullRequests")
          .withIndex("by_pullRequestId", (q) => q.eq("pullRequestId", pr._id))
          .collect();

        const linkedIssues = (
          await Promise.all(
            links.map(async (link) => {
              const issue = await ctx.db.get(link.issueId);
              if (!issue) return null;
              return {
                _id: issue._id,
                identifier: issue.identifier,
                title: issue.title,
                status: issue.status,
                projectId: issue.projectId ?? null,
                linkType: link.linkType,
              };
            })
          )
        ).filter((issue): issue is NonNullable<typeof issue> => issue !== null);

        return {
          ...pr,
          authorMember,
          linkedIssues,
        };
      })
    );

    prs.sort((a, b) => b.updatedAt - a.updatedAt);

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

    const prsWithChecks = prs.filter((p) => p.checksStatus);
    const successfulChecks = prsWithChecks.filter(
      (p) => p.checksStatus === "success"
    );
    const ciSuccessRate =
      prsWithChecks.length > 0
        ? Math.round((successfulChecks.length / prsWithChecks.length) * 100)
        : 100;

    let blockedTasks = 0;
    for (const issue of issues) {
      if (issue.status === "done" || issue.status === "cancelled") continue;
      const links = await ctx.db
        .query("issuesPullRequests")
        .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const link of links) {
        const pr = prMap.get(link.pullRequestId);
        if (pr && pr.checksStatus === "failure" && pr.state === "open") {
          blockedTasks++;
          break;
        }
      }
    }

    return {
      stats: {
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
      },
      pullRequests: prs,
    };
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

export const listLeadCandidates = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return [];

    const teamIds = new Set<Id<"teams">>();
    if (project.leadTeamId) {
      teamIds.add(project.leadTeamId);
    }

    const projectIssues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const issue of projectIssues) {
      if (issue.teamId) {
        teamIds.add(issue.teamId);
      }
    }

    const candidates = new Map<string, any>();

    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId);
      if (!team) continue;

      const memberships = await ctx.db
        .query("teamMembers")
        .withIndex("by_teamId", (q) => q.eq("teamId", team._id))
        .collect();

      for (const membership of memberships) {
        const member = await ctx.db.get(membership.memberId);
        if (!member || member.status !== "active") continue;

        const existing = candidates.get(member._id);
        if (existing) {
          existing.teams.push({
            _id: team._id,
            name: team.name,
            identifier: team.identifier,
          });
          continue;
        }

        candidates.set(member._id, {
          ...member,
          teams: [
            {
              _id: team._id,
              name: team.name,
              identifier: team.identifier,
            },
          ],
        });
      }
    }

    return Array.from(candidates.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
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

export const listLinks = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectLinks")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const addLink = mutation({
  args: {
    projectId: v.id("projects"),
    label: v.optional(v.string()),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("projectLinks", {
      projectId: args.projectId,
      label: args.label,
      url: args.url,
      createdAt: Date.now(),
    });
  },
});

export const removeLink = mutation({
  args: {
    linkId: v.id("projectLinks"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
  },
});

export const generateFileUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveUploadedFile = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("projectFiles", {
      projectId: args.projectId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      createdAt: Date.now(),
    });
  },
});

export const listFiles = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();

    return await Promise.all(
      files.map(async (file) => ({
        ...file,
        url: await ctx.storage.getUrl(file.storageId),
      }))
    );
  },
});

export const removeFile = mutation({
  args: {
    fileId: v.id("projectFiles"),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) return;
    await ctx.db.delete(args.fileId);
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
