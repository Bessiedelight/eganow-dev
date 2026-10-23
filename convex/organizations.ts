import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

type InstallationSeed = Pick<
  Doc<"githubInstallations">,
  | "installationId"
  | "accountLogin"
  | "accountType"
  | "accountAvatarUrl"
  | "userId"
  | "installedByGithubLogin"
>;

function githubUsernameForInstallation(
  accountType: string,
  accountLogin: string
) {
  return accountType === "User" ? normalizeGithubIdentity(accountLogin) : undefined;
}

function normalizeGithubIdentity(value: string) {
  return value.trim().toLowerCase();
}

function githubLoginToSlug(value: string) {
  return normalizeGithubIdentity(value).replace(/[^a-z0-9-]/g, "-");
}

async function getUserByGithubLogin(
  ctx: MutationCtx,
  githubLogin?: string
) {
  if (!githubLogin) return null;

  return await ctx.db
    .query("users")
    .withIndex("by_githubLogin", (q) =>
      q.eq("githubLogin", normalizeGithubIdentity(githubLogin))
    )
    .first();
}

async function createOrganizationForInstallation(
  ctx: MutationCtx,
  installation: InstallationSeed,
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

async function getOrCreateOrganizationForInstallation(
  ctx: MutationCtx,
  installation: InstallationSeed,
  ownerUserId?: Id<"users">
) {
  const existing = await ctx.db
    .query("organizations")
    .withIndex("by_githubInstallationId", (q) =>
      q.eq("githubInstallationId", installation.installationId)
    )
    .first();

  if (existing) {
    return existing;
  }

  const existingByGithubAccountLogin = await ctx.db
    .query("organizations")
    .withIndex("by_githubAccountLogin", (q) =>
      q.eq("githubAccountLogin", installation.accountLogin)
    )
    .first();

  if (existingByGithubAccountLogin) {
    await ctx.db.patch(existingByGithubAccountLogin._id, {
      name: installation.accountLogin,
      slug: githubLoginToSlug(installation.accountLogin),
      avatarUrl: installation.accountAvatarUrl,
      githubInstallationId: installation.installationId,
      githubAccountLogin: installation.accountLogin,
      githubAccountType: installation.accountType,
    });

    return {
      ...existingByGithubAccountLogin,
      name: installation.accountLogin,
      slug: githubLoginToSlug(installation.accountLogin),
      avatarUrl: installation.accountAvatarUrl,
      githubInstallationId: installation.installationId,
      githubAccountLogin: installation.accountLogin,
      githubAccountType: installation.accountType,
    };
  }

  if (!ownerUserId) {
    return null;
  }

  const orgId = await createOrganizationForInstallation(ctx, installation, ownerUserId);
  return await ctx.db.get(orgId);
}

async function syncRosterMembers(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  githubUsernames: string[]
) {
  const now = Date.now();
  const normalizedUsernames = Array.from(
    new Set(
      githubUsernames
        .map((value) => normalizeGithubIdentity(value))
        .filter(Boolean)
    )
  );

  for (const githubUsername of normalizedUsernames) {
    const existingMembership = await ctx.db
      .query("members")
      .withIndex("by_organizationId_and_githubUsername", (q) =>
        q.eq("organizationId", organizationId).eq("githubUsername", githubUsername)
      )
      .first();

    if (existingMembership) {
      if (
        existingMembership.githubUsername !== githubUsername ||
        existingMembership.displayName !== githubUsername ||
        (existingMembership.userId === undefined &&
          existingMembership.status !== "invited")
      ) {
        await ctx.db.patch(existingMembership._id, {
          githubUsername,
          displayName: existingMembership.userId
            ? existingMembership.displayName
            : githubUsername,
          status: existingMembership.userId ? "active" : "invited",
        });
      }
      continue;
    }

    await ctx.db.insert("members", {
      userId: undefined,
      organizationId,
      role: "member",
      displayName: githubUsername,
      githubUsername,
      status: "invited",
      joinedAt: now,
    });
  }
}

async function upsertRosterMember(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  githubUsername: string
) {
  const normalizedGithubUsername = normalizeGithubIdentity(githubUsername);

  const existingMembership = await ctx.db
    .query("members")
    .withIndex("by_organizationId_and_githubUsername", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("githubUsername", normalizedGithubUsername)
    )
    .first();

  if (existingMembership) {
    await ctx.db.patch(existingMembership._id, {
      githubUsername: normalizedGithubUsername,
      displayName: existingMembership.userId
        ? existingMembership.displayName
        : normalizedGithubUsername,
      status: existingMembership.userId ? "active" : "invited",
    });
    return existingMembership._id;
  }

  return await ctx.db.insert("members", {
    userId: undefined,
    organizationId,
    role: "member",
    displayName: normalizedGithubUsername,
    githubUsername: normalizedGithubUsername,
    status: "invited",
    joinedAt: Date.now(),
  });
}

async function deactivateRosterMember(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  githubUsername: string
) {
  const normalizedGithubUsername = normalizeGithubIdentity(githubUsername);

  const existingMembership = await ctx.db
    .query("members")
    .withIndex("by_organizationId_and_githubUsername", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("githubUsername", normalizedGithubUsername)
    )
    .first();

  if (!existingMembership) {
    return null;
  }

  await ctx.db.patch(existingMembership._id, {
    status: "deactivated",
  });

  return existingMembership._id;
}

async function ensureClaimedMembership(
  ctx: MutationCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
  installation: {
    accountLogin: string;
    accountType: string;
    accountAvatarUrl?: string;
  },
  memberGithubUsername?: string,
  role: "owner" | "admin" | "member" | "viewer" = "member"
) {
  const normalizedGithubUsername = memberGithubUsername
    ? normalizeGithubIdentity(memberGithubUsername)
    : githubUsernameForInstallation(
        installation.accountType,
        installation.accountLogin
      );

  const existingMembershipByUser = await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .first();

  const claimedMembership =
    !existingMembershipByUser && normalizedGithubUsername
      ? await ctx.db
          .query("members")
          .withIndex("by_organizationId_and_githubUsername", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("githubUsername", normalizedGithubUsername)
          )
          .first()
      : null;

  const existingMembership = existingMembershipByUser ?? claimedMembership;
  const user = await ctx.db.get(userId);
  const displayName = user?.name || user?.email || installation.accountLogin;

  if (existingMembership) {
    await ctx.db.patch(existingMembership._id, {
      userId,
      role: existingMembership.role === "owner" ? "owner" : role,
      displayName: displayName as string,
      githubUsername: normalizedGithubUsername,
      githubAvatarUrl: installation.accountAvatarUrl,
      status: "active",
    });

    return existingMembership._id;
  }

  return await ctx.db.insert("members", {
    userId,
    organizationId,
    role,
    displayName: displayName as string,
    githubUsername: normalizedGithubUsername,
    githubAvatarUrl: installation.accountAvatarUrl,
    status: "active",
    joinedAt: Date.now(),
  });
}

async function claimMembershipsForGithubLogin(
  ctx: MutationCtx,
  userId: Id<"users">,
  githubLogin: string
) {
  const normalizedGithubLogin = normalizeGithubIdentity(githubLogin);
  const user = await ctx.db.get(userId);
  const installations = await ctx.db
    .query("githubInstallations")
    .withIndex("by_installedByGithubLogin", (q) =>
      q.eq("installedByGithubLogin", normalizedGithubLogin)
    )
    .collect();

  for (const installation of installations.filter(
    (candidate) => candidate.status === "active"
  )) {
    const organization = await getOrCreateOrganizationForInstallation(
      ctx,
      installation,
      userId
    );

    if (!organization) continue;

    await ensureClaimedMembership(
      ctx,
      userId,
      organization._id,
      installation,
      normalizedGithubLogin,
      "owner"
    );
  }

  const pendingMemberships = await ctx.db
    .query("members")
    .withIndex("by_githubUsername", (q) => q.eq("githubUsername", normalizedGithubLogin))
    .collect();

  const claimedOrganizationIds: Id<"organizations">[] = [];

  for (const membership of pendingMemberships) {
    await ensureClaimedMembership(
      ctx,
      userId,
      membership.organizationId,
      {
        accountLogin: user?.githubLogin || membership.displayName,
        accountType: "User",
        accountAvatarUrl: user?.image,
      },
      normalizedGithubLogin
    );

    claimedOrganizationIds.push(membership.organizationId);
  }

  return Array.from(new Set(claimedOrganizationIds));
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

    const user = await ctx.db.get(userId);

    if (
      installation.status !== "active" ||
      installation.userId !== userId ||
      !user?.githubLogin ||
      installation.installedByGithubLogin !== user.githubLogin
    ) {
      throw new Error("Installation is not verified for the current user");
    }
    const organization = await getOrCreateOrganizationForInstallation(
      ctx,
      installation,
      userId
    );

    if (!organization) {
      return null;
    }

    await ensureClaimedMembership(
      ctx,
      userId,
      organization._id,
      installation,
      user?.githubLogin,
      "owner"
    );

    return organization._id;
  },
});

export const syncInstallationRosterFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    accountLogin: v.string(),
    accountType: v.string(),
    accountAvatarUrl: v.optional(v.string()),
    installedByGithubLogin: v.optional(v.string()),
    memberUsernames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) =>
        q.eq("installationId", args.installationId)
      )
      .first();

    if (!installation) {
      return null;
    }

    const installerUser = await getUserByGithubLogin(ctx, args.installedByGithubLogin);
    const organization = await getOrCreateOrganizationForInstallation(
      ctx,
      {
        ...installation,
        accountLogin: args.accountLogin,
        accountType: args.accountType,
        accountAvatarUrl: args.accountAvatarUrl,
        installedByGithubLogin: args.installedByGithubLogin,
      },
      installerUser?._id ?? installation.userId ?? undefined
    );

    if (!organization) {
      return null;
    }

    if (installerUser?._id) {
      await ensureClaimedMembership(
        ctx,
        installerUser._id,
        organization._id,
        installation,
        installerUser.githubLogin,
        "owner"
      );
    }

    await syncRosterMembers(ctx, organization._id, args.memberUsernames);
    return organization._id;
  },
});

export const addRosterMemberFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    githubUsername: v.string(),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_githubInstallationId", (q) =>
        q.eq("githubInstallationId", args.installationId)
      )
      .first();

    if (!organization) {
      return null;
    }

    return await upsertRosterMember(ctx, organization._id, args.githubUsername);
  },
});

export const removeRosterMemberFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    githubUsername: v.string(),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_githubInstallationId", (q) =>
        q.eq("githubInstallationId", args.installationId)
      )
      .first();

    if (!organization) {
      return null;
    }

    return await deactivateRosterMember(
      ctx,
      organization._id,
      args.githubUsername
    );
  },
});

export const claimCurrentUserMemberships = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    const githubLogin = user?.githubLogin;

    if (!githubLogin) {
      return [];
    }

    return await claimMembershipsForGithubLogin(ctx, userId, githubLogin);
  },
});

export const claimMembershipsForGithubLoginInternal = internalMutation({
  args: {
    userId: v.id("users"),
    githubLogin: v.string(),
  },
  handler: async (ctx, args) => {
    return await claimMembershipsForGithubLogin(
      ctx,
      args.userId,
      args.githubLogin
    );
  },
});
