import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const terminalStatuses = new Set(["completed", "failed", "closed"]);

const sessionStatusValidator = v.union(
  v.literal("starting"),
  v.literal("active"),
  v.literal("waiting_for_user"),
  v.literal("waiting_for_approval"),
  v.literal("publishing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("closed")
);

const workspaceStatusValidator = v.union(
  v.literal("provisioning"),
  v.literal("ready"),
  v.literal("busy"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("cleaned_up")
);

const messageRoleValidator = v.union(
  v.literal("assistant"),
  v.literal("system"),
  v.literal("tool")
);

const messageTypeValidator = v.union(
  v.literal("chat"),
  v.literal("tool_call"),
  v.literal("tool_result"),
  v.literal("status"),
  v.literal("approval_request"),
  v.literal("approval_result"),
  v.literal("question"),
  v.literal("publish_event"),
  v.literal("error")
);

const taskTypeValidator = v.union(v.literal("turn"), v.literal("publish"));

const taskStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

const approvalDecisionValidator = v.union(
  v.literal("approved"),
  v.literal("denied")
);

const sessionPatchArgs = {
  sessionId: v.id("issueAgentSessions"),
  claudeSessionId: v.optional(v.string()),
  status: v.optional(sessionStatusValidator),
  lastError: v.optional(v.union(v.string(), v.null())),
  baseBranch: v.optional(v.string()),
  branchName: v.optional(v.string()),
  linkedPullRequestId: v.optional(v.id("pullRequests")),
  githubPrNumber: v.optional(v.number()),
  githubPrUrl: v.optional(v.string()),
  usageSummary: v.optional(v.any()),
};

const workspacePatchArgs = {
  sessionId: v.id("issueAgentSessions"),
  baseBranch: v.optional(v.string()),
  branchName: v.optional(v.string()),
  worktreePath: v.optional(v.string()),
  claudeSessionPath: v.optional(v.string()),
  worktreeCreated: v.optional(v.boolean()),
  status: v.optional(workspaceStatusValidator),
  expiresAt: v.optional(v.number()),
  lastHealthyAt: v.optional(v.number()),
};

type ResolvedRepo =
  | { ok: true; repoFullName: string }
  | { ok: false; reason: string };

type SessionPatch = {
  claudeSessionId?: string;
  status?: Doc<"issueAgentSessions">["status"];
  lastError?: string | null;
  baseBranch?: string;
  branchName?: string;
  linkedPullRequestId?: Id<"pullRequests">;
  githubPrNumber?: number;
  githubPrUrl?: string;
  usageSummary?: unknown;
};

type WorkspacePatch = {
  baseBranch?: string;
  branchName?: string;
  worktreePath?: string;
  claudeSessionPath?: string;
  worktreeCreated?: boolean;
  status?: Doc<"issueAgentWorkspaces">["status"];
  expiresAt?: number;
  lastHealthyAt?: number;
};

async function getCurrentMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const member = await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q) =>
      q.eq("organizationId", orgId).eq("userId", userId)
    )
    .unique();

  if (!member || member.status !== "active") {
    throw new Error("Not a member of this organization");
  }

  return { userId, member };
}

async function resolveRepoForIssue(
  ctx: QueryCtx | MutationCtx,
  issue: Doc<"issues">
): Promise<ResolvedRepo> {
  if (issue.githubRepoFullName) {
    return { ok: true, repoFullName: issue.githubRepoFullName };
  }

  if (!issue.projectId) {
    return {
      ok: false,
      reason: "No repository is linked to this issue yet.",
    };
  }

  const project = await ctx.db.get(issue.projectId);
  const repoNames = project?.githubRepoFullNames ?? [];

  if (repoNames.length === 1) {
    return { ok: true, repoFullName: repoNames[0] };
  }

  if (repoNames.length > 1) {
    return {
      ok: false,
      reason:
        "This issue's project is linked to multiple repositories. Manual repo selection is not implemented yet.",
    };
  }

  return {
    ok: false,
    reason: "No repository is linked to this issue's project.",
  };
}

function sanitizeBranchSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildBranchName(issue: Doc<"issues">, sessionKey: string) {
  const identifier = sanitizeBranchSegment(issue.identifier);
  return `eganow/${identifier || "issue"}-${sessionKey.slice(0, 8)}`;
}

async function getSessionWithOwnershipCheck(
  ctx: MutationCtx,
  sessionId: Id<"issueAgentSessions">
) {
  const session = await ctx.db.get(sessionId);
  if (!session) {
    throw new Error("Issue agent session not found");
  }

  const { member } = await getCurrentMember(ctx, session.organizationId);
  if (member._id !== session.memberId) {
    throw new Error("You do not have access to this issue agent session");
  }

  return { session, member };
}

async function getWorkerContext(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"issueAgentSessions">
) {
  const session = await ctx.db.get(sessionId);
  if (!session) {
    return null;
  }

  const issue = await ctx.db.get(session.issueId);
  const organization = await ctx.db.get(session.organizationId);
  const member = await ctx.db.get(session.memberId);
  const workspace = await ctx.db
    .query("issueAgentWorkspaces")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();

  if (!issue || !organization || !member || !workspace) {
    return null;
  }
  const memberUserId = member.userId;
  if (!memberUserId) {
    return null;
  }

  const project = issue.projectId ? await ctx.db.get(issue.projectId) : null;
  const linkedPullRequests = await ctx.db
    .query("issuesPullRequests")
    .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
    .collect();
  const settings = await ctx.db
    .query("aiSettings")
    .withIndex("by_userId", (q) => q.eq("userId", memberUserId))
    .unique();

  return {
    member,
    session,
    issue,
    organization,
    project,
    workspace,
    linkedPullRequests,
    encryptedAnthropicKey: settings?.encryptedAnthropicKey ?? null,
  };
}

async function appendMessageRecord(
  ctx: MutationCtx,
  session: Doc<"issueAgentSessions">,
  args: {
    role: Doc<"issueAgentMessages">["role"];
    messageType: Doc<"issueAgentMessages">["messageType"];
    content: string;
    metadata?: unknown;
  }
) {
  const now = Date.now();

  await ctx.db.insert("issueAgentMessages", {
    sessionId: session._id,
    issueId: session.issueId,
    organizationId: session.organizationId,
    role: args.role,
    messageType: args.messageType,
    content: args.content,
    metadata: args.metadata,
    createdAt: now,
  });

  await ctx.db.patch(session._id, {
    lastActivityAt: now,
    latestAssistantMessageAt:
      args.role === "assistant" ? now : session.latestAssistantMessageAt,
    updatedAt: now,
  });
}

async function enqueueTaskRecord(
  ctx: MutationCtx,
  session: Doc<"issueAgentSessions">,
  taskType: Doc<"issueAgentTasks">["taskType"],
  prompt?: string
) {
  const now = Date.now();

  if (taskType === "publish") {
    const recentTasks = await ctx.db
      .query("issueAgentTasks")
      .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .take(10);

    const existingPublishTask = recentTasks.find(
      (task) =>
        task.taskType === "publish" &&
        (task.status === "queued" || task.status === "running")
    );

    if (existingPublishTask) {
      return existingPublishTask._id;
    }
  }

  const taskId = await ctx.db.insert("issueAgentTasks", {
    sessionId: session._id,
    issueId: session.issueId,
    organizationId: session.organizationId,
    memberId: session.memberId,
    taskType,
    prompt,
    status: "queued",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("issueAgentMessages", {
    sessionId: session._id,
    issueId: session.issueId,
    organizationId: session.organizationId,
    role: "system",
    messageType: "status",
    content:
      taskType === "publish"
        ? "Queued pull request publication. Waiting for the issue agent worker."
        : "Queued your Claude request. Waiting for the issue agent worker.",
    createdAt: now,
  });

  await ctx.db.patch(session._id, {
    status: taskType === "publish" ? "publishing" : "starting",
    lastActivityAt: now,
    updatedAt: now,
    lastError: undefined,
  });

  return taskId;
}

async function patchSessionRecord(
  ctx: MutationCtx,
  sessionId: Id<"issueAgentSessions">,
  args: SessionPatch
) {
  const now = Date.now();
  const patch: Record<string, unknown> = {
    updatedAt: now,
    lastActivityAt: now,
  };

  if (args.claudeSessionId !== undefined) patch.claudeSessionId = args.claudeSessionId;
  if (args.status !== undefined) patch.status = args.status;
  if (args.lastError !== undefined) patch.lastError = args.lastError ?? undefined;
  if (args.baseBranch !== undefined) patch.baseBranch = args.baseBranch;
  if (args.branchName !== undefined) patch.branchName = args.branchName;
  if (args.linkedPullRequestId !== undefined) {
    patch.linkedPullRequestId = args.linkedPullRequestId;
  }
  if (args.githubPrNumber !== undefined) patch.githubPrNumber = args.githubPrNumber;
  if (args.githubPrUrl !== undefined) patch.githubPrUrl = args.githubPrUrl;
  if (args.usageSummary !== undefined) patch.usageSummary = args.usageSummary;
  if (
    args.status === "closed" ||
    args.status === "completed" ||
    args.status === "failed"
  ) {
    patch.closedAt = now;
  }

  await ctx.db.patch(sessionId, patch);
}

async function patchWorkspaceRecord(
  ctx: MutationCtx,
  workspaceId: Id<"issueAgentWorkspaces">,
  args: WorkspacePatch
) {
  const patch: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (args.baseBranch !== undefined) patch.baseBranch = args.baseBranch;
  if (args.branchName !== undefined) patch.branchName = args.branchName;
  if (args.worktreePath !== undefined) patch.worktreePath = args.worktreePath;
  if (args.claudeSessionPath !== undefined) {
    patch.claudeSessionPath = args.claudeSessionPath;
  }
  if (args.worktreeCreated !== undefined) {
    patch.worktreeCreated = args.worktreeCreated;
  }
  if (args.status !== undefined) patch.status = args.status;
  if (args.expiresAt !== undefined) patch.expiresAt = args.expiresAt;
  if (args.lastHealthyAt !== undefined) patch.lastHealthyAt = args.lastHealthyAt;

  await ctx.db.patch(workspaceId, patch);
}

async function createIssueAgentSession(
  ctx: MutationCtx,
  args: {
    issue: Doc<"issues">;
    memberId: Id<"members">;
    githubInstallationId: number;
    repoFullName: string;
  }
) {
  const now = Date.now();
  const workspaceKey = `${args.issue._id}:${args.memberId}:${now}`;
  const branchName = buildBranchName(args.issue, workspaceKey);

  const sessionId = await ctx.db.insert("issueAgentSessions", {
    organizationId: args.issue.organizationId,
    issueId: args.issue._id,
    memberId: args.memberId,
    provider: "anthropic",
    sdk: "claude-agent-sdk",
    githubInstallationId: args.githubInstallationId,
    repoFullName: args.repoFullName,
    branchName,
    workspaceKey,
    status: "starting",
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("issueAgentWorkspaces", {
    sessionId,
    provider: "filesystem_git_worktree",
    workspaceKey,
    repoFullName: args.repoFullName,
    branchName,
    worktreeCreated: false,
    isTopLevelSession: true,
    status: "provisioning",
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("issueAgentMessages", {
    sessionId,
    issueId: args.issue._id,
    organizationId: args.issue.organizationId,
    role: "system",
    messageType: "status",
    content: "Issue agent session created. Preparing workspace.",
    createdAt: now,
  });

  return sessionId;
}

export const getLatestSessionByIssue = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) return null;

    const { member } = await getCurrentMember(ctx, issue.organizationId);
    const sessions = await ctx.db
      .query("issueAgentSessions")
      .withIndex("by_issueId_and_createdAt", (q) => q.eq("issueId", args.issueId))
      .order("desc")
      .take(20);

    const memberSessions = sessions.filter((session) => session.memberId === member._id);
    return (
      memberSessions.find((session) => !terminalStatuses.has(session.status)) ??
      memberSessions[0] ??
      null
    );
  },
});

export const listMessagesBySession = query({
  args: { sessionId: v.id("issueAgentSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];

    const { member } = await getCurrentMember(ctx, session.organizationId);
    if (member._id !== session.memberId) {
      return [];
    }

    return await ctx.db
      .query("issueAgentMessages")
      .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

export const listApprovalsBySession = query({
  args: { sessionId: v.id("issueAgentSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];

    const { member } = await getCurrentMember(ctx, session.organizationId);
    if (member._id !== session.memberId) {
      return [];
    }

    return await ctx.db
      .query("issueAgentApprovals")
      .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

export const getWorkspaceBySession = query({
  args: { sessionId: v.id("issueAgentSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    const { member } = await getCurrentMember(ctx, session.organizationId);
    if (member._id !== session.memberId) {
      return null;
    }

    return await ctx.db
      .query("issueAgentWorkspaces")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});

export const getExecutionContext = query({
  args: { sessionId: v.id("issueAgentSessions") },
  handler: async (ctx, args) => {
    const context = await getWorkerContext(ctx, args.sessionId);
    if (!context) {
      return null;
    }

    const { member } = await getCurrentMember(ctx, context.session.organizationId);
    if (member._id !== context.session.memberId) {
      return null;
    }

    return {
      userId: member.userId,
      member,
      session: context.session,
      issue: context.issue,
      organization: context.organization,
      project: context.project,
      workspace: context.workspace,
      linkedPullRequests: context.linkedPullRequests,
    };
  },
});

export const getMyAnthropicKeyCiphertext = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const settings = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    return settings?.encryptedAnthropicKey ?? null;
  },
});

export const createOrReuseSession = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new Error("Issue not found");
    }

    const { member } = await getCurrentMember(ctx, issue.organizationId);
    const organization = await ctx.db.get(issue.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }
    if (!organization.githubInstallationId) {
      throw new Error("This organization does not have a GitHub installation connected");
    }

    const resolvedRepo = await resolveRepoForIssue(ctx, issue);
    if (!resolvedRepo.ok) {
      throw new Error(resolvedRepo.reason);
    }

    const latestSessions = await ctx.db
      .query("issueAgentSessions")
      .withIndex("by_issueId_and_createdAt", (q) => q.eq("issueId", issue._id))
      .order("desc")
      .take(20);

    const existing = latestSessions.find(
      (session) =>
        session.memberId === member._id &&
        session.repoFullName === resolvedRepo.repoFullName &&
        !terminalStatuses.has(session.status)
    );

    if (existing) {
      return existing._id;
    }

    return await createIssueAgentSession(ctx, {
      issue,
      memberId: member._id,
      githubInstallationId: organization.githubInstallationId,
      repoFullName: resolvedRepo.repoFullName,
    });
  },
});

export const resetSessionForIssue = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new Error("Issue not found");
    }

    const { member } = await getCurrentMember(ctx, issue.organizationId);
    const organization = await ctx.db.get(issue.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }
    if (!organization.githubInstallationId) {
      throw new Error("This organization does not have a GitHub installation connected");
    }

    const resolvedRepo = await resolveRepoForIssue(ctx, issue);
    if (!resolvedRepo.ok) {
      throw new Error(resolvedRepo.reason);
    }

    const recentSessions = await ctx.db
      .query("issueAgentSessions")
      .withIndex("by_issueId_and_createdAt", (q) => q.eq("issueId", issue._id))
      .order("desc")
      .take(20);

    const openSessions = recentSessions.filter(
      (session) =>
        session.memberId === member._id &&
        session.repoFullName === resolvedRepo.repoFullName &&
        !terminalStatuses.has(session.status)
    );

    for (const session of openSessions) {
      await patchSessionRecord(ctx, session._id, {
        status: "closed",
        lastError: null,
      });

      const sessionTasks = await ctx.db
        .query("issueAgentTasks")
        .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", session._id))
        .order("desc")
        .take(50);

      for (const task of sessionTasks) {
        if (task.status === "queued") {
          await ctx.db.patch(task._id, {
            status: "cancelled",
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
    }

    return await createIssueAgentSession(ctx, {
      issue,
      memberId: member._id,
      githubInstallationId: organization.githubInstallationId,
      repoFullName: resolvedRepo.repoFullName,
    });
  },
});

export const sendUserMessage = mutation({
  args: {
    sessionId: v.id("issueAgentSessions"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { session } = await getSessionWithOwnershipCheck(ctx, args.sessionId);
    if (terminalStatuses.has(session.status)) {
      throw new Error("This issue agent session is closed. Start a new chat session.");
    }
    const now = Date.now();

    await ctx.db.insert("issueAgentMessages", {
      sessionId: session._id,
      issueId: session.issueId,
      organizationId: session.organizationId,
      role: "user",
      messageType: "chat",
      content: args.content,
      createdAt: now,
    });

    await ctx.db.patch(session._id, {
      status: "active",
      lastActivityAt: now,
      latestUserMessageAt: now,
      updatedAt: now,
      lastError: undefined,
    });

    return null;
  },
});

export const enqueueTask = mutation({
  args: {
    sessionId: v.id("issueAgentSessions"),
    taskType: taskTypeValidator,
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { session } = await getSessionWithOwnershipCheck(ctx, args.sessionId);

    if (terminalStatuses.has(session.status)) {
      throw new Error("This issue agent session is already closed");
    }

    return await enqueueTaskRecord(ctx, session, args.taskType, args.prompt);
  },
});

export const sendAndEnqueue = mutation({
  args: {
    sessionId: v.id("issueAgentSessions"),
    content: v.string(),
    taskType: taskTypeValidator,
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { session } = await getSessionWithOwnershipCheck(ctx, args.sessionId);
    if (terminalStatuses.has(session.status)) {
      throw new Error("This issue agent session is closed. Start a new chat session.");
    }
    const now = Date.now();

    await ctx.db.insert("issueAgentMessages", {
      sessionId: session._id,
      issueId: session.issueId,
      organizationId: session.organizationId,
      role: "user",
      messageType: "chat",
      content: args.content,
      createdAt: now,
    });

    await ctx.db.patch(session._id, {
      status: "active",
      lastActivityAt: now,
      latestUserMessageAt: now,
      updatedAt: now,
      lastError: undefined,
    });

    return await enqueueTaskRecord(ctx, session, args.taskType, args.prompt);
  },
});

export const stopActiveRun = mutation({
  args: {
    sessionId: v.id("issueAgentSessions"),
  },
  handler: async (ctx, args) => {
    const { session } = await getSessionWithOwnershipCheck(ctx, args.sessionId);
    const sessionTasks = await ctx.db
      .query("issueAgentTasks")
      .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .take(50);

    const cancellableTasks = sessionTasks.filter(
      (task) => task.status === "queued" || task.status === "running"
    );

    if (cancellableTasks.length === 0) {
      return { stopped: false, cancelledTaskCount: 0 };
    }

    const now = Date.now();
    for (const task of cancellableTasks) {
      await ctx.db.patch(task._id, {
        status: "cancelled",
        error: "Stopped by user",
        completedAt: now,
        lastHeartbeatAt: task.status === "running" ? now : task.lastHeartbeatAt,
        updatedAt: now,
      });
    }

    await ctx.db.patch(session._id, {
      status: "waiting_for_user",
      lastActivityAt: now,
      updatedAt: now,
      lastError: undefined,
    });

    await ctx.db.insert("issueAgentMessages", {
      sessionId: session._id,
      issueId: session.issueId,
      organizationId: session.organizationId,
      role: "system",
      messageType: "status",
      content: "Stopped the current Claude run.",
      createdAt: now,
    });

    return { stopped: true, cancelledTaskCount: cancellableTasks.length };
  },
});

export const resolveApproval = mutation({
  args: {
    approvalId: v.id("issueAgentApprovals"),
    decision: approvalDecisionValidator,
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error("Approval request not found");
    }
    if (approval.status !== "pending") {
      throw new Error("This approval request has already been resolved");
    }

    const session = await ctx.db.get(approval.sessionId);
    if (!session) {
      throw new Error("Issue agent session not found");
    }

    const { member } = await getCurrentMember(ctx, session.organizationId);
    if (member._id !== session.memberId) {
      throw new Error("You do not have access to this approval request");
    }

    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: args.decision,
      decision: args.decision,
      resolvedAt: now,
      resolvedBy: member._id,
    });

    await ctx.db.insert("issueAgentMessages", {
      sessionId: session._id,
      issueId: session.issueId,
      organizationId: session.organizationId,
      role: "system",
      messageType: "approval_result",
      content:
        args.decision === "approved"
          ? "Publish approved. Opening the pull request now."
          : "Publish denied. The branch stays available for more changes.",
      metadata: {
        approvalId: approval._id,
        toolName: approval.toolName,
        decision: args.decision,
      },
      createdAt: now,
    });

    if (args.decision === "approved") {
      const taskId = await enqueueTaskRecord(ctx, session, "publish");
      return { taskId, status: "approved" as const };
    }

    await ctx.db.patch(session._id, {
      status: "waiting_for_user",
      lastActivityAt: now,
      updatedAt: now,
    });

    return { taskId: null, status: "denied" as const };
  },
});

export const appendAssistantMessage = mutation({
  args: {
    sessionId: v.id("issueAgentSessions"),
    role: messageRoleValidator,
    messageType: messageTypeValidator,
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { session } = await getSessionWithOwnershipCheck(ctx, args.sessionId);
    await appendMessageRecord(ctx, session, args);
    return null;
  },
});

export const updateSession = mutation({
  args: sessionPatchArgs,
  handler: async (ctx, args) => {
    await getSessionWithOwnershipCheck(ctx, args.sessionId);
    await patchSessionRecord(ctx, args.sessionId, args);
    return null;
  },
});

export const updateWorkspace = mutation({
  args: workspacePatchArgs,
  handler: async (ctx, args) => {
    const { session } = await getSessionWithOwnershipCheck(ctx, args.sessionId);
    const workspace = await ctx.db
      .query("issueAgentWorkspaces")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .unique();

    if (!workspace) {
      throw new Error("Issue agent workspace not found");
    }

    await patchWorkspaceRecord(ctx, workspace._id, args);
    return null;
  },
});

export const getExecutionContextForWorker = internalQuery({
  args: { sessionId: v.id("issueAgentSessions") },
  handler: async (ctx, args) => {
    return await getWorkerContext(ctx, args.sessionId);
  },
});

export const getTaskStateForWorker = internalQuery({
  args: { taskId: v.id("issueAgentTasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      return null;
    }

    const session = await ctx.db.get(task.sessionId);
    return {
      taskStatus: task.status,
      sessionStatus: session?.status ?? null,
    };
  },
});

export const claimNextTask = internalMutation({
  args: { workerId: v.string() },
  handler: async (ctx, args) => {
    const nextTask = (
      await ctx.db
        .query("issueAgentTasks")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "queued"))
        .order("asc")
        .take(1)
    )[0];

    if (!nextTask) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(nextTask._id, {
      status: "running",
      workerId: args.workerId,
      attemptCount: nextTask.attemptCount + 1,
      startedAt: nextTask.startedAt ?? now,
      lastHeartbeatAt: now,
      updatedAt: now,
      error: undefined,
    });

    const session = await ctx.db.get(nextTask.sessionId);
    if (session) {
      await ctx.db.patch(session._id, {
        status: nextTask.taskType === "publish" ? "publishing" : "starting",
        lastActivityAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("issueAgentMessages", {
        sessionId: session._id,
        issueId: session.issueId,
        organizationId: session.organizationId,
        role: "system",
        messageType: "status",
        content:
          nextTask.taskType === "publish"
            ? "Worker claimed the publish job. Opening the pull request next."
            : "Worker claimed your request. Preparing the workspace and starting Claude.",
        createdAt: now,
      });
    }

    return {
      _id: nextTask._id,
      sessionId: nextTask.sessionId,
      taskType: nextTask.taskType,
      prompt: nextTask.prompt ?? null,
    };
  },
});

export const heartbeatTask = internalMutation({
  args: {
    taskId: v.id("issueAgentTasks"),
    workerId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.status !== "running") {
      return null;
    }

    await ctx.db.patch(task._id, {
      workerId: args.workerId,
      lastHeartbeatAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const completeTask = internalMutation({
  args: {
    taskId: v.id("issueAgentTasks"),
    status: v.optional(taskStatusValidator),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(task._id, {
      status: args.status ?? "completed",
      completedAt: now,
      lastHeartbeatAt: now,
      updatedAt: now,
    });

    return null;
  },
});

export const failTask = internalMutation({
  args: {
    taskId: v.id("issueAgentTasks"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(task._id, {
      status: "failed",
      error: args.error,
      completedAt: now,
      lastHeartbeatAt: now,
      updatedAt: now,
    });

    return null;
  },
});

export const appendAssistantMessageFromWorker = internalMutation({
  args: {
    sessionId: v.id("issueAgentSessions"),
    role: messageRoleValidator,
    messageType: messageTypeValidator,
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Issue agent session not found");
    }

    await appendMessageRecord(ctx, session, args);
    return null;
  },
});

export const updateSessionFromWorker = internalMutation({
  args: sessionPatchArgs,
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Issue agent session not found");
    }

    await patchSessionRecord(ctx, session._id, args);
    return null;
  },
});

export const updateWorkspaceFromWorker = internalMutation({
  args: workspacePatchArgs,
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("issueAgentWorkspaces")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!workspace) {
      throw new Error("Issue agent workspace not found");
    }

    await patchWorkspaceRecord(ctx, workspace._id, args);
    return null;
  },
});

export const requestPublishApprovalFromWorker = internalMutation({
  args: {
    sessionId: v.id("issueAgentSessions"),
    toolInput: v.optional(v.any()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Issue agent session not found");
    }

    const existingApprovals = await ctx.db
      .query("issueAgentApprovals")
      .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .take(10);

    const pending = existingApprovals.find(
      (approval) =>
        approval.status === "pending" &&
        approval.toolName === "eganow_publish_pull_request"
    );

    if (pending) {
      return pending._id;
    }

    const now = Date.now();
    const approvalId = await ctx.db.insert("issueAgentApprovals", {
      sessionId: session._id,
      toolName: "eganow_publish_pull_request",
      toolInput: args.toolInput,
      reason: args.reason,
      status: "pending",
      createdAt: now,
    });

    await ctx.db.patch(session._id, {
      status: "waiting_for_approval",
      lastActivityAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("issueAgentMessages", {
      sessionId: session._id,
      issueId: session.issueId,
      organizationId: session.organizationId,
      role: "system",
      messageType: "approval_request",
      content:
        args.reason ||
        "Claude is ready to publish a pull request. Approve to let the app commit, push, and open the PR.",
      metadata: {
        approvalId,
        toolName: "eganow_publish_pull_request",
      },
      createdAt: now,
    });

    return approvalId;
  },
});
