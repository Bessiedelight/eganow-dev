"use server"

import { listInstallations } from "@/lib/github/client";

export async function fetchGitHubInstallations() {
  try {
    const installations = await listInstallations();
    
    return installations.map(inst => ({
      installationId: inst.id,
      accountLogin: inst.account && "login" in inst.account ? inst.account.login : "unknown",
      accountType: inst.target_type,
      accountAvatarUrl: inst.account && "avatar_url" in inst.account ? inst.account.avatar_url : undefined,
      installedAt: new Date(inst.created_at).getTime(),
    }));
  } catch (error) {
    console.error("[GitHub Actions] Failed to fetch installations:", error);
    return [];
  }
}
