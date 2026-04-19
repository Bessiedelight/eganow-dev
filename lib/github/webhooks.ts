import { Webhooks } from "@octokit/webhooks";
import {
  handleInstallationCreated,
  handleInstallationDeleted,
  handleIssueOpened,
  handleIssueClosed,
  handleIssueEdited,
  handleIssueReopened,
  handlePullRequestOpened,
  handlePullRequestClosed,
  handlePullRequestReviewSubmitted,
  handlePullRequestSynchronize,
  handlePush,
} from "./handlers";

/**
 * Central webhook instance.
 *
 * Creates a Webhooks instance with signature verification,
 * then registers all event handlers. The API route delegates
 * incoming payloads to this instance.
 */

let _webhooks: Webhooks | null = null;

export function getWebhooks(): Webhooks {
  if (_webhooks) return _webhooks;

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("GITHUB_WEBHOOK_SECRET is not set in .env.local.");
  }

  _webhooks = new Webhooks({ secret });

  // ─── Installation ──────────────────────────────────────────
  _webhooks.on("installation.created", handleInstallationCreated);
  _webhooks.on("installation.deleted", handleInstallationDeleted);

  // ─── Issues ────────────────────────────────────────────────
  _webhooks.on("issues.opened", handleIssueOpened);
  _webhooks.on("issues.closed", handleIssueClosed);
  _webhooks.on("issues.edited", handleIssueEdited);
  _webhooks.on("issues.reopened", handleIssueReopened);

  // ─── Pull Requests ─────────────────────────────────────────
  _webhooks.on("pull_request.opened", handlePullRequestOpened);
  _webhooks.on("pull_request.closed", handlePullRequestClosed);
  _webhooks.on("pull_request.synchronize", handlePullRequestSynchronize);
  _webhooks.on("pull_request_review.submitted", handlePullRequestReviewSubmitted);

  // ─── Push ──────────────────────────────────────────────────
  _webhooks.on("push", handlePush);

  // ─── Catch-all for debugging ───────────────────────────────
  _webhooks.onAny(({ id, name }) => {
    console.log(`[Webhook] Received event: ${name} (delivery: ${id})`);
  });

  // ─── Error handling ────────────────────────────────────────
  _webhooks.onError((error) => {
    console.error("[Webhook] ❌ Error processing event:", error.message);
  });

  return _webhooks;
}
