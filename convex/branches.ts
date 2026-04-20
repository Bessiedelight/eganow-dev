import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", args.orgId))
      .order("desc")
      .collect();
    const pullRequests = await ctx.db
      .query("pullRequests")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", args.orgId))
      .collect();

    const activeBranches = branches.filter((branch) => branch.isActive);

    const enriched = await Promise.all(
      activeBranches.map(async (branch) => {
        const authorMember = branch.authorMemberId
          ? await ctx.db.get(branch.authorMemberId)
          : null;

        const openPullRequest = pullRequests.find(
          (pr) =>
            pr.githubRepoFullName === branch.githubRepoFullName &&
            pr.headBranch === branch.branchName &&
            pr.state === "open"
        );

        return {
          ...branch,
          authorMember,
          hasOpenPullRequest: !!openPullRequest,
        };
      })
    );

    return enriched
      .filter((branch) => !branch.hasOpenPullRequest)
      .sort((a, b) => b.committedAt - a.committedAt);
  },
});

export const getByRepoAndBranch = query({
  args: {
    orgId: v.id("organizations"),
    repoFullName: v.string(),
    branchName: v.string(),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_repo_and_branchName", (q) =>
        q.eq("githubRepoFullName", args.repoFullName).eq("branchName", args.branchName)
      )
      .first();

    if (!branch || branch.organizationId !== args.orgId) return null;

    const authorMember = branch.authorMemberId
      ? await ctx.db.get(branch.authorMemberId)
      : null;

    return {
      ...branch,
      authorMember,
    };
  },
});

export const markRepoBranchesInactive = mutation({
  args: {
    orgId: v.id("organizations"),
    githubRepoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_repo", (q) =>
        q.eq("organizationId", args.orgId).eq("githubRepoFullName", args.githubRepoFullName)
      )
      .collect();

    for (const branch of branches) {
      await ctx.db.patch(branch._id, {
        isActive: false,
        updatedAt: Date.now(),
      });
    }
  },
});

export const syncFromGitHub = mutation({
  args: {
    orgId: v.id("organizations"),
    githubRepoFullName: v.string(),
    branchName: v.string(),
    baseBranch: v.string(),
    latestCommitSha: v.string(),
    latestCommitMessage: v.string(),
    authorGithubUsername: v.string(),
    githubUrl: v.string(),
    committedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const authorMember = await ctx.db
      .query("members")
      .withIndex("by_githubUsername", (q) =>
        q.eq("githubUsername", args.authorGithubUsername)
      )
      .first();

    const existing = await ctx.db
      .query("branches")
      .withIndex("by_repo_and_branchName", (q) =>
        q.eq("githubRepoFullName", args.githubRepoFullName).eq("branchName", args.branchName)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        baseBranch: args.baseBranch,
        latestCommitSha: args.latestCommitSha,
        latestCommitMessage: args.latestCommitMessage,
        authorGithubUsername: args.authorGithubUsername,
        authorMemberId: authorMember?._id,
        githubUrl: args.githubUrl,
        committedAt: args.committedAt,
        isActive: true,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("branches", {
      organizationId: args.orgId,
      githubRepoFullName: args.githubRepoFullName,
      branchName: args.branchName,
      baseBranch: args.baseBranch,
      latestCommitSha: args.latestCommitSha,
      latestCommitMessage: args.latestCommitMessage,
      authorGithubUsername: args.authorGithubUsername,
      authorMemberId: authorMember?._id,
      githubUrl: args.githubUrl,
      committedAt: args.committedAt,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});
