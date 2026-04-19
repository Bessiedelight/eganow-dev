import { NextRequest, NextResponse } from "next/server";
import { getGitHubApp } from "@/lib/github/app";

/**
 * GET /api/github/installation/[id]
 *
 * Fetches details about a specific GitHub App installation
 * using the app's JWT authentication.
 *
 * Returns: account login, type, avatar URL, etc.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const installationId = parseInt(id, 10);

    if (isNaN(installationId)) {
      return NextResponse.json(
        { error: "Invalid installation ID" },
        { status: 400 }
      );
    }

    const app = getGitHubApp();
    const { data: installation } = await app.octokit.request(
      "GET /app/installations/{installation_id}",
      { installation_id: installationId }
    );

    const account = installation.account;
    const accountLogin =
      account && "login" in account ? account.login : "unknown";
    const accountType = installation.target_type;
    const accountAvatarUrl =
      account && "avatar_url" in account
        ? account.avatar_url
        : undefined;

    return NextResponse.json({
      installationId: installation.id,
      accountLogin,
      accountType,
      accountAvatarUrl,
      permissions: installation.permissions,
      createdAt: installation.created_at,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      "[GitHub] Failed to fetch installation:",
      message
    );
    return NextResponse.json(
      { error: "Failed to fetch installation details" },
      { status: 500 }
    );
  }
}
