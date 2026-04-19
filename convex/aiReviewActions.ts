"use node";

/**
 * AI Review Actions — Node.js Runtime
 *
 * Background actions that require Node.js (crypto, LLM API calls).
 * Scheduled by mutations in aiReviews.ts via ctx.scheduler.runAfter.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/** Execute a full PR review in the background (10-min budget) */
export const executeReview = internalAction({
  args: {
    reviewId: v.id("aiReviews"),
    installationId: v.number(),
    repoFullName: v.string(),
    prNumber: v.number(),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // If Anthropic, decrypt the user's API key
    let anthropicApiKey: string | undefined;
    if (args.provider === "anthropic") {
      const settings = await ctx.runQuery(
        internal.aiReviews.getSettingsInternal,
        { userId: args.userId }
      );
      if (!settings?.encryptedAnthropicKey) {
        await ctx.runMutation(internal.aiReviews.failReview, {
          reviewId: args.reviewId,
          error:
            "Anthropic API key not configured. Go to Settings to add it.",
          processingTimeMs: 0,
        });
        return;
      }
      const { decryptApiKey } = await import("../lib/ai/crypto");
      anthropicApiKey = decryptApiKey(settings.encryptedAnthropicKey);
    }

    // Run the pipeline
    const { executeReviewPipeline } = await import(
      "../lib/ai/pr-review-executor"
    );
    await executeReviewPipeline(
      ctx,
      args.reviewId as string,
      {
        updateStep: internal.aiReviews.updateStep,
        completeReview: internal.aiReviews.completeReview,
        failReview: internal.aiReviews.failReview,
      },
      {
        installationId: args.installationId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        provider: args.provider,
        anthropicApiKey,
      }
    );
  },
});

/** Encrypt and save an Anthropic API key */
export const encryptAndSaveKey = internalAction({
  args: {
    userId: v.id("users"),
    rawKey: v.string(),
    preferredProvider: v.union(v.literal("groq"), v.literal("anthropic")),
  },
  handler: async (ctx, args) => {
    const { encryptApiKey } = await import("../lib/ai/crypto");
    const encrypted = encryptApiKey(args.rawKey);

    const existing = await ctx.runQuery(
      internal.aiReviews.getSettingsInternal,
      { userId: args.userId }
    );

    if (existing) {
      await ctx.runMutation(internal.aiReviews.updateSettingsInternal, {
        settingsId: existing._id,
        encryptedAnthropicKey: encrypted,
        preferredProvider: args.preferredProvider,
      });
    } else {
      await ctx.runMutation(internal.aiReviews.insertSettingsInternal, {
        userId: args.userId,
        encryptedAnthropicKey: encrypted,
        preferredProvider: args.preferredProvider,
      });
    }
  },
});

/** Generate an AI response to a chat message */
export const generateChatResponse = internalAction({
  args: {
    reviewId: v.id("aiReviews"),
    pullRequestId: v.id("pullRequests"),
    orgId: v.id("organizations"),
    message: v.string(),
    provider: v.union(v.literal("groq"), v.literal("anthropic")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      // Get the review for context
      const review = await ctx.runQuery(
        internal.aiReviews.getReviewInternal,
        { reviewId: args.reviewId }
      );
      if (!review || !review.review) {
        await ctx.runMutation(internal.aiReviews.saveAIChatMessage, {
          orgId: args.orgId,
          pullRequestId: args.pullRequestId,
          reviewId: args.reviewId,
          role: "assistant",
          content:
            "I need a completed review to answer questions. Please generate a review first.",
          provider: args.provider,
        });
        return;
      }

      // Get PR details for context
      const pr = await ctx.runQuery(
        internal.aiReviews.getPullRequestInternal,
        { pullRequestId: args.pullRequestId }
      );

      // Get chat history
      const chatHistory = await ctx.runQuery(
        internal.aiReviews.getChatMessagesInternal,
        { reviewId: args.reviewId }
      );

      // Resolve API key if Anthropic
      let anthropicApiKey: string | undefined;
      if (args.provider === "anthropic") {
        const settings = await ctx.runQuery(
          internal.aiReviews.getSettingsInternal,
          { userId: args.userId }
        );
        if (settings?.encryptedAnthropicKey) {
          const { decryptApiKey } = await import("../lib/ai/crypto");
          anthropicApiKey = decryptApiKey(settings.encryptedAnthropicKey);
        }
      }

      // Create adapter and call LLM
      const { createAdapter } = await import("../lib/ai/llm-provider");
      const { CHAT_SYSTEM, buildChatPrompt } = await import(
        "../lib/ai/pr-review-prompts"
      );

      const adapter = createAdapter(args.provider, anthropicApiKey);

      const prompt = buildChatPrompt(
        JSON.stringify(review.review, null, 2),
        {
          title: pr?.title || "",
          body: pr?.body || "",
          diff: "",
        },
        chatHistory.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
        args.message
      );

      const response = await adapter.call({
        systemPrompt: CHAT_SYSTEM,
        userPrompt: prompt,
        temperature: 0.4,
        maxTokens: 2048,
      });

      await ctx.runMutation(internal.aiReviews.saveAIChatMessage, {
        orgId: args.orgId,
        pullRequestId: args.pullRequestId,
        reviewId: args.reviewId,
        role: "assistant",
        content: response,
        provider: args.provider,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate response";
      await ctx.runMutation(internal.aiReviews.saveAIChatMessage, {
        orgId: args.orgId,
        pullRequestId: args.pullRequestId,
        reviewId: args.reviewId,
        role: "assistant",
        content: `Sorry, I encountered an error: ${message}`,
        provider: args.provider,
      });
    }
  },
});
