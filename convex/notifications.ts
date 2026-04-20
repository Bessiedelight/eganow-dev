import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

function humanizeValue(value: string | null | undefined) {
  if (value === undefined || value === null || value === "") return null;
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shouldHideFromInbox(activityEvent: any) {
  if (!activityEvent) return false;
  return [
    "issue_status_changed",
    "issue_assignee_changed",
    "issue_priority_changed",
    "issue_project_changed",
    "issue_team_changed",
    "issue_title_changed",
    "issue_body_changed",
  ].includes(activityEvent.eventType);
}

// ─── Helper: resolve current member ──────────────────────────
async function getCurrentMember(ctx: any, orgId: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q: any) =>
      q.eq("organizationId", orgId).eq("userId", userId)
    )
    .first();
}

// ─── Queries ──────────────────────────────────────────────────

/**
 * List notifications for the current user, enriched with linked entity data.
 */
export const listForCurrentUser = query({
  args: {
    orgId: v.id("organizations"),
    filter: v.optional(
      v.union(v.literal("all"), v.literal("unread"), v.literal("mentions"))
    ),
    retainedIds: v.optional(v.array(v.id("notifications"))),
  },
  handler: async (ctx, args) => {
    const member = await getCurrentMember(ctx, args.orgId);
    if (!member) return [];

    const filter = args.filter || "all";
    const retainedSet = new Set(args.retainedIds || []);

    let notifications = await ctx.db
      .query("notifications")
      .withIndex("by_memberId", (q: any) => q.eq("memberId", member._id))
      .order("desc")
      .collect();

    // Apply filters
    notifications = notifications.filter((n) => {
      // Always exclude archived
      if (n.isArchived) return false;
      // Exclude snoozed notifications that haven't expired
      if (n.isSnoozed && n.snoozedUntil && n.snoozedUntil > Date.now())
        return false;
        
      // Keep retained items in the view
      if (retainedSet.has(n._id)) return true;

      // Filter-specific logic
      if (filter === "unread") return !n.isRead;
      if (filter === "mentions") return n.context.toLowerCase().includes("mention");
      return true;
    });

    // Enrich with linked entity data
    const enriched = await Promise.all(
      notifications.slice(0, 50).map(async (n) => {
        const activityEvent = n.activityEventId
          ? await ctx.db.get(n.activityEventId)
          : null;

        if (shouldHideFromInbox(activityEvent)) {
          return null;
        }

        let linkedEntity: {
          type: "issue" | "pullRequest" | null;
          identifier?: string;
          title?: string;
          body?: string;
          route?: string;
        } = { type: null };

        let secondaryEntity: {
          type: "issue" | "pullRequest" | null;
          identifier?: string;
          title?: string;
          route?: string;
        } = { type: null };
        let displayTitle = n.title;
        let displayContext = n.context;
        let changeSummary: string | null = null;
        let changeFromLabel: string | null = null;
        let changeToLabel: string | null = null;

        if (n.issueId) {
          const issue = await ctx.db.get(n.issueId);
          if (issue) {
            linkedEntity = {
              type: "issue",
              identifier: issue.identifier,
              title: issue.title,
              body: issue.body,
              route: `/dashboard/issues/${issue.identifier.replace("#", "")}`,
            };
          }
        } else if (n.pullRequestId) {
          const pr = await ctx.db.get(n.pullRequestId);
          if (pr) {
            const prId = `${pr.githubRepoFullName}#${pr.githubPrNumber}`;
            linkedEntity = {
              type: "pullRequest",
              identifier: prId,
              title: pr.title,
              body: pr.body,
              route: `/dashboard/pulls/${encodeURIComponent(prId)}`,
            };
          }
        }

        if (
          activityEvent?.eventType === "pull_request_linked_to_issue" &&
          n.issueId &&
          n.pullRequestId
        ) {
          const issue = await ctx.db.get(n.issueId);
          const pr = await ctx.db.get(n.pullRequestId);

          if (issue && pr) {
            const prId = `${pr.githubRepoFullName}#${pr.githubPrNumber}`;
            linkedEntity = {
              type: "issue",
              identifier: issue.identifier,
              title: issue.title,
              body: issue.body,
              route: `/dashboard/issues/${issue.identifier.replace("#", "")}`,
            };
            secondaryEntity = {
              type: "pullRequest",
              identifier: prId,
              title: pr.title,
              route: `/dashboard/pulls/${encodeURIComponent(prId)}`,
            };
          }
        }

        // Derive notification type from context
        const ctx_lower = n.context.toLowerCase();
        let notifType: "review" | "mention" | "assignment" | "ci" | "status" | "comment" | "merge" | "link" = "status";
        if (activityEvent?.eventType === "pull_request_linked_to_issue") {
          notifType = "link";
        }
        else if (ctx_lower.includes("review") || ctx_lower.includes("approved")) notifType = "review";
        else if (ctx_lower.includes("mention")) notifType = "mention";
        else if (ctx_lower.includes("assign")) notifType = "assignment";
        else if (ctx_lower.includes("ci") || ctx_lower.includes("pipeline") || ctx_lower.includes("failed")) notifType = "ci";
        else if (ctx_lower.includes("comment") || ctx_lower.includes("replied")) notifType = "comment";
        else if (ctx_lower.includes("merged")) notifType = "merge";

        if (activityEvent?.metadata?.field && activityEvent?.metadata?.newLabel) {
          const fieldLabel = humanizeValue(activityEvent.metadata.field) || "Updated";
          changeFromLabel = activityEvent.metadata.oldLabel ?? humanizeValue(activityEvent.metadata.oldValue);
          changeToLabel = activityEvent.metadata.newLabel ?? humanizeValue(activityEvent.metadata.newValue);
          changeSummary = `${fieldLabel} changed${changeToLabel ? ` to ${changeToLabel}` : ""}`;
          displayTitle =
            linkedEntity.identifier && changeToLabel
              ? `${linkedEntity.identifier} ${fieldLabel.toLowerCase()} changed to ${changeToLabel}`
              : `${fieldLabel} changed`;
          displayContext = `${activityEvent.actorDisplayName || n.actorDisplayName} updated ${fieldLabel.toLowerCase()}`;
          notifType =
            activityEvent.metadata.field === "assignee" ? "assignment" :
            activityEvent.metadata.field === "checksStatus" ? "ci" :
            activityEvent.metadata.field === "state" &&
            activityEvent.pullRequestId &&
            activityEvent.metadata.newValue === "merged" ? "merge" :
            "status";
        } else if (activityEvent?.eventType === "pull_request_linked_to_issue") {
          changeSummary = "Pull request linked to issue";
        }

        return {
          ...n,
          linkedEntity,
          secondaryEntity,
          activityEvent,
          notifType,
          displayTitle,
          displayContext,
          changeSummary,
          changeFromLabel,
          changeToLabel,
        };
      })
    );

    return enriched.filter(Boolean);
  },
});

/**
 * Get unread notification count for the current user.
 */
export const getUnreadCount = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const member = await getCurrentMember(ctx, args.orgId);
    if (!member) return 0;

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_memberId_unread", (q: any) =>
        q.eq("memberId", member._id).eq("isRead", false)
      )
      .collect();

    let count = 0;
    for (const notification of unread) {
      if (notification.isArchived) continue;
      if (
        notification.isSnoozed &&
        notification.snoozedUntil &&
        notification.snoozedUntil > Date.now()
      ) {
        continue;
      }
      const activityEvent = notification.activityEventId
        ? await ctx.db.get(notification.activityEventId)
        : null;
      if (shouldHideFromInbox(activityEvent)) continue;
      count++;
    }

    return count;
  },
});

// ─── Mutations ────────────────────────────────────────────────

/**
 * Mark a single notification as read.
 */
export const markAsRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { isRead: true });
  },
});

/**
 * Mark all notifications as read for the current user in an org.
 */
export const markAllAsRead = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const member = await getCurrentMember(ctx, args.orgId);
    if (!member) return;

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_memberId_unread", (q: any) =>
        q.eq("memberId", member._id).eq("isRead", false)
      )
      .collect();

    await Promise.all(
      unread.map((n) => ctx.db.patch(n._id, { isRead: true }))
    );
  },
});

/**
 * Snooze a notification for a given duration (ms).
 */
export const snooze = mutation({
  args: {
    notificationId: v.id("notifications"),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, {
      isSnoozed: true,
      snoozedUntil: Date.now() + args.durationMs,
    });
  },
});

/**
 * Archive a notification.
 */
export const archive = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { isArchived: true });
  },
});

// ─── Internal helper: create a notification (used by other modules) ──

/**
 * Insert a notification. Called from other mutations (issues, comments, PRs).
 * Exported so other Convex modules can import it directly.
 */
export const _createNotification = mutation({
  args: {
    memberId: v.id("members"),
    organizationId: v.id("organizations"),
    issueId: v.optional(v.id("issues")),
    pullRequestId: v.optional(v.id("pullRequests")),
    activityEventId: v.optional(v.id("activityEvents")),
    title: v.string(),
    context: v.string(),
    actorDisplayName: v.string(),
    actorAvatarInitials: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      memberId: args.memberId,
      organizationId: args.organizationId,
      issueId: args.issueId,
      pullRequestId: args.pullRequestId,
      activityEventId: args.activityEventId,
      title: args.title,
      context: args.context,
      isRead: false,
      isSnoozed: false,
      isArchived: false,
      actorDisplayName: args.actorDisplayName,
      actorAvatarInitials: args.actorAvatarInitials,
      createdAt: Date.now(),
    });
  },
});
