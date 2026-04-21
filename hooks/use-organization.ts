"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

/**
 * Hook to get the current user's organization membership.
 * If the user has a GitHub login but no attached workspace yet,
 * try claiming any pending memberships once.
 */
export function useOrganization() {
  const user = useQuery(api.users.current);
  const orgs = useQuery(api.organizations.getForCurrentUser);
  const installations = useQuery(api.github.getMyInstallations);
  const claimMemberships = useMutation(api.organizations.claimCurrentUserMemberships);
  const lastClaimKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (user === undefined || orgs === undefined || installations === undefined) {
      return;
    }
    if (!user?.githubLogin || orgs.length > 0) return;

    const installationKey = installations
      .map((installation) => installation.installationId)
      .sort((a, b) => a - b)
      .join(",");
    const claimKey = `${user.githubLogin}:${installationKey}`;

    if (lastClaimKeyRef.current === claimKey) {
      return;
    }

    lastClaimKeyRef.current = claimKey;
    void claimMemberships().catch((error) => {
      console.error("Failed to claim GitHub organization memberships", error);
      lastClaimKeyRef.current = null;
    });
  }, [claimMemberships, installations, orgs, user]);

  const organization = orgs?.[0] ?? null;
  const isLoading = orgs === undefined || installations === undefined;
  const needsInstallation = orgs !== undefined && orgs.length === 0;

  return { organization, isLoading, needsInstallation };
}
