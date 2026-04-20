/**
 * AI Reviews — Convex Queries & Mutations
 *
 * NON-Node.js module: Contains queries and mutations that run in the
 * default Convex runtime. The "use node" actions are in aiReviewActions.ts.
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

// ════════════════════════════════════════════════════
// QUERIES (reactive — powers real-time UI updates)
// ════════════════════════════════════════════════════

/** Get the latest review for a PR (reactive — UI auto-updates at each checkpoint) */
export const getByPullRequest = query({
  args: { pullRequestId: v.id("pullRequests") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiReviews")
      .withIndex("by_pullRequestId", (q) =>
        q.eq("pullRequestId", args.pullRequestId)
      )
      .order("desc")
      .first();
  },
});

/** Get chat messages for a review */
export const getChatMessages = query({
  args: { reviewId: v.id("aiReviews") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiChatMessages")
      .withIndex("by_reviewId", (q) => q.eq("reviewId", args.reviewId))
      .collect();
  },
});

/** Get user's AI settings (never exposes the encrypted key to the client) */
export const getMySettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const settings = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    return {
      hasAnthropicKey: !!settings?.encryptedAnthropicKey,
      preferredProvider: settings?.preferredProvider || "groq",
    };
  },
});

// ════════════════════════════════════════════════════
// MUTATIONS (client-facing)
// ════════════════════════════════════════════════════

/** Trigger an AI review — creates record + schedules background action */
export const triggerReview = mutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    repoFullName: v.string(),
    prNumber: v.number(),
    installationId: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if there's already an active review
    const existing = await ctx.db
      .query("aiReviews")
      .withIndex("by_pullRequestId", (q) =>
        q.eq("pullRequestId", args.pullRequestId)
      )
      .order("desc")
      .first();

    if (
      existing &&
      existing.step !== "completed" &&
      existing.step !== "failed"
    ) {
      throw new Error("A review is already in progress for this PR.");
    }

    // Determine provider from user settings
    const settings = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const provider = settings?.preferredProvider || "groq";

    // Create review record (status: pending)
    const now = Date.now();
    const reviewId = await ctx.db.insert("aiReviews", {
      organizationId: args.orgId,
      pullRequestId: args.pullRequestId,
      provider,
      step: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // Schedule background action (runs immediately, non-blocking)
    await ctx.scheduler.runAfter(
      0,
      internal.aiReviewActions.executeReview,
      {
        reviewId,
        installationId: args.installationId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        provider,
        userId,
      }
    );

    return reviewId;
  },
});

/** Save AI settings (provider preference, or trigger key encryption) */
export const saveAISettings = mutation({
  args: {
    anthropicApiKey: v.optional(v.string()),
    preferredProvider: v.union(v.literal("groq"), v.literal("anthropic")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    if (args.anthropicApiKey) {
      // Key encryption must happen in "use node" action (needs Node.js crypto)
      await ctx.scheduler.runAfter(
        0,
        internal.aiReviewActions.encryptAndSaveKey,
        {
          userId,
          rawKey: args.anthropicApiKey,
          preferredProvider: args.preferredProvider,
        }
      );
    } else {
      // Just update provider preference (no key change)
      const existing = await ctx.db
        .query("aiSettings")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          preferredProvider: args.preferredProvider,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("aiSettings", {
          userId,
          preferredProvider: args.preferredProvider,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

/** Clear the stored Anthropic API key */
export const clearAnthropicKey = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedAnthropicKey: undefined,
        preferredProvider: "groq",
        updatedAt: Date.now(),
      });
    }
  },
});

/** Send a follow-up chat message — schedules AI response */
export const sendChatMessage = mutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    reviewId: v.id("aiReviews"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();

    // Determine provider
    const settings = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const provider = settings?.preferredProvider || "groq";

    // Save user message
    await ctx.db.insert("aiChatMessages", {
      organizationId: args.orgId,
      pullRequestId: args.pullRequestId,
      reviewId: args.reviewId,
      role: "user",
      content: args.message,
      provider,
      createdAt: now,
    });

    // Schedule AI response generation
    await ctx.scheduler.runAfter(
      0,
      internal.aiReviewActions.generateChatResponse,
      {
        reviewId: args.reviewId,
        pullRequestId: args.pullRequestId,
        orgId: args.orgId,
        message: args.message,
        provider,
        userId,
      }
    );
  },
});

// ════════════════════════════════════════════════════
// INTERNAL QUERIES (used by background actions)
// ════════════════════════════════════════════════════

export const getSettingsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const getReviewInternal = internalQuery({
  args: { reviewId: v.id("aiReviews") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.reviewId);
  },
});

export const getChatMessagesInternal = internalQuery({
  args: { reviewId: v.id("aiReviews") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiChatMessages")
      .withIndex("by_reviewId", (q) => q.eq("reviewId", args.reviewId))
      .collect();
  },
});

export const getPullRequestInternal = internalQuery({
  args: { pullRequestId: v.id("pullRequests") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.pullRequestId);
  },
});

// ════════════════════════════════════════════════════
// INTERNAL MUTATIONS (called by background actions for checkpointing)
// ════════════════════════════════════════════════════

export const updateStep = internalMutation({
  args: {
    reviewId: v.id("aiReviews"),
    step: v.string(),
    contextStats: v.optional(v.any()),
    intermediateData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      step: args.step,
      updatedAt: Date.now(),
    };
    if (args.contextStats !== undefined) {
      patch.contextStats = args.contextStats;
    }
    if (args.intermediateData !== undefined) {
      patch.intermediateData = args.intermediateData;
    }
    await ctx.db.patch(args.reviewId, patch);
  },
});

export const completeReview = internalMutation({
  args: {
    reviewId: v.id("aiReviews"),
    review: v.any(),
    processingTimeMs: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reviewId, {
      step: "completed",
      review: args.review,
      model: args.model,
      processingTimeMs: args.processingTimeMs,
      intermediateData: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const failReview = internalMutation({
  args: {
    reviewId: v.id("aiReviews"),
    error: v.string(),
    processingTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reviewId, {
      step: "failed",
      error: args.error,
      processingTimeMs: args.processingTimeMs,
      updatedAt: Date.now(),
    });
  },
});

export const saveAIChatMessage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    pullRequestId: v.id("pullRequests"),
    reviewId: v.id("aiReviews"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiChatMessages", {
      organizationId: args.orgId,
      pullRequestId: args.pullRequestId,
      reviewId: args.reviewId,
      role: args.role,
      content: args.content,
      provider: args.provider,
      createdAt: Date.now(),
    });
  },
});

export const updateSettingsInternal = internalMutation({
  args: {
    settingsId: v.id("aiSettings"),
    encryptedAnthropicKey: v.any(),
    preferredProvider: v.union(v.literal("groq"), v.literal("anthropic")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.settingsId, {
      encryptedAnthropicKey: args.encryptedAnthropicKey,
      preferredProvider: args.preferredProvider,
      updatedAt: Date.now(),
    });
  },
});

export const insertSettingsInternal = internalMutation({
  args: {
    userId: v.id("users"),
    encryptedAnthropicKey: v.any(),
    preferredProvider: v.union(v.literal("groq"), v.literal("anthropic")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiSettings", {
      userId: args.userId,
      encryptedAnthropicKey: args.encryptedAnthropicKey,
      preferredProvider: args.preferredProvider,
      updatedAt: Date.now(),
    });
  },
});
