import { NextRequest, NextResponse } from "next/server";
import { getGitHubApp } from "@/lib/github/app";
import { getInstallationClient } from "@/lib/github/client";

async function fetchOrganizationMemberUsernames(
  installationId: number,
  accountLogin: string
) {
  const octokit = await getInstallationClient(installationId);
  const usernames: string[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.request("GET /orgs/{org}/members", {
      org: accountLogin,
      per_page: 100,
      page,
    });

    const batch = data
      .map((member: { login?: string }) => member.login?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));

    usernames.push(...batch);

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return Array.from(new Set(usernames));
}

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

    let memberUsernames: string[] = [];
    if (installation.target_type === "Organization" && accountLogin !== "unknown") {
      try {
        memberUsernames = await fetchOrganizationMemberUsernames(
          installationId,
          accountLogin
        );
      } catch (error) {
        console.error(
          "[GitHub] Failed to fetch organization members for installation bootstrap:",
          error
        );
      }
    }

    return NextResponse.json({
      installationId: installation.id,
      accountLogin,
      accountType,
      accountAvatarUrl,
      memberUsernames,
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
