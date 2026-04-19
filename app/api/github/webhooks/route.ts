import { NextRequest, NextResponse } from "next/server";
import { getWebhooks } from "@/lib/github/webhooks";

/**
 * POST /api/github/webhooks
 *
 * Receives webhook events from the GitHub App.
 * Verifies the signature using GITHUB_WEBHOOK_SECRET,
 * then dispatches to the appropriate handler.
 *
 * GitHub sends:
 *   - x-github-event:      event name (e.g. "issues", "push")
 *   - x-hub-signature-256: HMAC signature for verification
 *   - x-github-delivery:   unique delivery ID
 */
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");
    const deliveryId = request.headers.get("x-github-delivery");

    // ── Validate required headers ──────────────────────────────
    if (!signature || !event || !deliveryId) {
      console.warn("[Webhook] Missing required GitHub headers");
      return NextResponse.json(
        { error: "Missing required GitHub webhook headers" },
        { status: 400 }
      );
    }

    // ── Read the raw body ──────────────────────────────────────
    const body = await request.text();

    if (!body) {
      return NextResponse.json(
        { error: "Empty request body" },
        { status: 400 }
      );
    }

    // ── Verify signature & dispatch ────────────────────────────
    const webhooks = getWebhooks();

    await webhooks.verifyAndReceive({
      id: deliveryId,
      name: event as any,
      signature,
      payload: body,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    console.error("[Webhook] Failed to process:", message);

    // Signature verification failures return 401
    if (message.includes("signature")) {
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/github/webhooks
 *
 * Health check endpoint. Useful for verifying
 * the route is deployed and reachable.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "GitHub webhook endpoint is active",
    timestamp: new Date().toISOString(),
  });
}
