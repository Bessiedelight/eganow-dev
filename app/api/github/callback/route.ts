import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/github/callback
 *
 * GitHub redirects here after a user installs the GitHub App.
 * 
 * GitHub sends these query params:
 *   - installation_id: The numeric ID of the new installation
 *   - setup_action: "install" | "update" | "request"
 *
 * We redirect to the settings page with the installation_id
 * so the client can save it to Convex (needs auth context).
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");

  console.log(
    `[GitHub Callback] Received: installation_id=${installationId}, action=${setupAction}`
  );

  if (!installationId) {
    // If no installation_id, just redirect to settings
    return NextResponse.redirect(
      new URL("/dashboard/settings", request.url)
    );
  }

  // Redirect to settings with installation_id as a query param.
  // The settings page client component will pick this up and
  // call the Convex mutation to persist it.
  const redirectUrl = new URL("/dashboard/settings", request.url);
  redirectUrl.searchParams.set("installation_id", installationId);
  redirectUrl.searchParams.set("setup_action", setupAction ?? "install");

  return NextResponse.redirect(redirectUrl);
}
