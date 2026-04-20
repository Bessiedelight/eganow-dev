import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

function githubUsernameForInstallation(
  accountType: string,
  accountLogin: string
) {
  return accountType === "User" ? accountLogin : undefined;
}

function normalizeGithubLogin(value: string) {
  return value.trim().toLowerCase();
}

function githubLoginToSlug(value: string) {
  return normalizeGithubLogin(value).replace(/[^a-z0-9-]/g, "-");
}

async function createOrganizationForInstallation(
  ctx: MutationCtx,
  installation: Doc<"githubInstallations">,
  ownerUserId: Id<"users">
) {
  const now = Date.now();
  const orgId = await ctx.db.insert("organizations", {
    name: installation.accountLogin,
    slug: githubLoginToSlug(installation.accountLogin),
    avatarUrl: installation.accountAvatarUrl,
    githubInstallationId: installation.installationId,
    githubAccountLogin: installation.accountLogin,
    githubAccountType: installation.accountType,
    createdBy: ownerUserId,
    createdAt: now,
    issueCounter: 0,
  });

  const ownerUser = await ctx.db.get(ownerUserId);
  const ownerDisplayName =
    ownerUser?.name || ownerUser?.email || installation.accountLogin;

  await ctx.db.insert("members", {
    userId: ownerUserId,
    organizationId: orgId,
    role: "owner",
    displayName: ownerDisplayName as string,
    githubUsername:
      ownerUser?.githubLogin ??
      githubUsernameForInstallation(
        installation.accountType,
        installation.accountLogin
      ),
    githubAvatarUrl: installation.accountAvatarUrl,
    status: "active",
    joinedAt: now,
  });

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
}

async function syncMembershipsForGithubOrganizations(
  ctx: MutationCtx,
  userId: Id<"users">,
  githubOrganizations: string[],
  memberGithubUsername?: string
) {
  const normalizedGithubOrganizations = Array.from(
    new Set(
      githubOrganizations
        .map((value) => normalizeGithubLogin(value))
        .filter(Boolean)
    )
  );

  if (normalizedGithubOrganizations.length === 0) {
    return [];
  }

  const organizations = await ctx.db.query("organizations").collect();
  const activeInstallations = (
    await ctx.db.query("githubInstallations").collect()
  ).filter((installation) => installation.status === "active");

  const joinedOrganizationIds: Id<"organizations">[] = [];

  for (const normalizedLogin of normalizedGithubOrganizations) {
    let organization =
      organizations.find(
        (candidate) =>
          normalizeGithubLogin(candidate.githubAccountLogin) === normalizedLogin
      ) ??
      organizations.find(
        (candidate) => candidate.slug === githubLoginToSlug(normalizedLogin)
      ) ??
      null;

    if (!organization) {
      const installation =
        activeInstallations.find(
          (candidate) =>
            normalizeGithubLogin(candidate.accountLogin) === normalizedLogin
        ) ?? null;

      if (installation) {
        const existingOrganization = await ctx.db
          .query("organizations")
          .withIndex("by_githubInstallationId", (q) =>
            q.eq("githubInstallationId", installation.installationId)
          )
          .first();

        if (existingOrganization) {
          organization = existingOrganization;
        } else {
          const organizationId = await createOrganizationForInstallation(
            ctx,
            installation,
            installation.userId
          );
          const createdOrganization = await ctx.db.get(organizationId);
          if (createdOrganization) {
            organizations.push(createdOrganization);
            organization = createdOrganization;
          }
        }
      }
    }

    if (!organization) {
      continue;
    }

    await ensureActiveMembership(
      ctx,
      userId,
      organization._id,
      {
        accountLogin: organization.githubAccountLogin,
        accountType: organization.githubAccountType,
        accountAvatarUrl: organization.avatarUrl,
      },
      memberGithubUsername
    );

    joinedOrganizationIds.push(organization._id);
  }

  return joinedOrganizationIds;
}

async function ensureActiveMembership(
  ctx: MutationCtx,
  userId: Awaited<ReturnType<typeof getAuthUserId>>,
  organizationId: Id<"organizations">,
  installation: {
    accountLogin: string;
    accountType: string;
    accountAvatarUrl?: string;
  },
  memberGithubUsername?: string
) {
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const existingMembership = await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .first();

  const user = await ctx.db.get(userId);
  const displayName = user?.name || user?.email || installation.accountLogin;
  const githubUsername =
    memberGithubUsername ??
    githubUsernameForInstallation(
      installation.accountType,
      installation.accountLogin
    );

  if (existingMembership) {
    if (
      existingMembership.status !== "active" ||
      existingMembership.displayName !== displayName ||
      existingMembership.githubUsername !== githubUsername ||
      existingMembership.githubAvatarUrl !== installation.accountAvatarUrl
    ) {
      await ctx.db.patch(existingMembership._id, {
        status: "active",
        displayName: displayName as string,
        githubUsername,
        githubAvatarUrl: installation.accountAvatarUrl,
      });
    }

    return existingMembership._id;
  }

  return await ctx.db.insert("members", {
    userId,
    organizationId,
    role: "member",
    displayName: displayName as string,
    githubUsername,
    githubAvatarUrl: installation.accountAvatarUrl,
    status: "active",
    joinedAt: Date.now(),
  });
}

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
      memberRecords.map((memberRecord) => ctx.db.get(memberRecord.organizationId))
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
 * Bootstrap: Create or join an organization from a GitHub installation.
 * The installation is shared at the org level; users are attached as members.
 */
export const bootstrapFromInstallation = mutation({
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
      .first();

    if (!installation) {
      return null;
    }

    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_githubInstallationId", (q) =>
        q.eq("githubInstallationId", installation.installationId)
      )
      .first();

    if (existingOrg) {
      const user = await ctx.db.get(userId);
      await ensureActiveMembership(
        ctx,
        userId,
        existingOrg._id,
        installation,
        user?.githubLogin
      );

      return existingOrg._id;
    }

    const orgId = await createOrganizationForInstallation(
      ctx,
      installation,
      userId
    );
    return orgId;
  },
});

export const syncMembershipsFromGithubOrganizationsInternal = internalMutation({
  args: {
    userId: v.id("users"),
    githubOrganizations: v.array(v.string()),
    githubLogin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await syncMembershipsForGithubOrganizations(
      ctx,
      args.userId,
      args.githubOrganizations,
      args.githubLogin
    );
  },
});

export const syncCurrentUserGithubOrganizations = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return [];
    }

    const githubOrganizations = Array.isArray(user.githubOrganizations)
      ? user.githubOrganizations.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        )
      : [];

    if (githubOrganizations.length === 0) {
      return [];
    }

    return await syncMembershipsForGithubOrganizations(
      ctx,
      userId,
      githubOrganizations,
      user.githubLogin
    );
  },
});
