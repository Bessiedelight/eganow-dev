import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Queries ──────────────────────────────────────────────────

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("commits")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.orgId)
      )
      .order("desc")
      .take(100);
  },
});

export const getBySha = query({
  args: {
    repoFullName: v.string(),
    sha: v.string(),
  },
  handler: async (ctx, args) => {
    // Try full SHA first
    let commit = await ctx.db
      .query("commits")
      .withIndex("by_github", (q) =>
        q.eq("githubRepoFullName", args.repoFullName).eq("sha", args.sha)
      )
      .first();

    if (commit) return commit;

    // Try matching by shortSha (7-char prefix)
    const allRepoCommits = await ctx.db
      .query("commits")
      .withIndex("by_github", (q) =>
        q.eq("githubRepoFullName", args.repoFullName)
      )
      .collect();

    return allRepoCommits.find(
      (c) => c.shortSha === args.sha || c.sha.startsWith(args.sha)
    ) || null;
  },
});

// ─── Mutations ────────────────────────────────────────────────

export const syncFromGitHub = mutation({
  args: {
    orgId: v.id("organizations"),
    githubRepoFullName: v.string(),
    sha: v.string(),
    message: v.string(),
    authorGithubUsername: v.string(),
    committedAt: v.number(),
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    changedFiles: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const shortSha = args.sha.substring(0, 7);
    const authorMember = await ctx.db
      .query("members")
      .withIndex("by_organizationId_and_githubUsername", (q) =>
        q
          .eq("organizationId", args.orgId)
          .eq("githubUsername", args.authorGithubUsername.toLowerCase())
      )
      .first();

    // Check if commit already exists
    const existing = await ctx.db
      .query("commits")
      .withIndex("by_github", (q) =>
        q
          .eq("githubRepoFullName", args.githubRepoFullName)
          .eq("sha", args.sha)
      )
      .first();

    if (existing) {
      // Only update if we have new stats
      const updates: Record<string, any> = { updatedAt: now };
      if (args.additions !== undefined) updates.additions = args.additions;
      if (args.deletions !== undefined) updates.deletions = args.deletions;
      if (args.changedFiles !== undefined) updates.changedFiles = args.changedFiles;
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    return await ctx.db.insert("commits", {
      organizationId: args.orgId,
      githubRepoFullName: args.githubRepoFullName,
      sha: args.sha,
      shortSha,
      message: args.message,
      authorGithubUsername: args.authorGithubUsername,
      authorMemberId: authorMember?._id,
      additions: args.additions,
      deletions: args.deletions,
      changedFiles: args.changedFiles,
      committedAt: args.committedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});
