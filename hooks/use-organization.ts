"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

/**
 * Hook to get the current user's organization membership.
 * GitHub installation linking is handled explicitly from the callback flow.
 */
export function useOrganization() {
  const user = useQuery(api.users.current);
  const orgs = useQuery(api.organizations.getForCurrentUser);
  const syncGithubOrganizations = useMutation(
    api.organizations.syncCurrentUserGithubOrganizations
  );
  const hasTriggeredRepair = React.useRef(false);

  React.useEffect(() => {
    if (hasTriggeredRepair.current) return;
    if (orgs === undefined || user === undefined) return;
    if (orgs.length > 0) return;
    if (!Array.isArray(user?.githubOrganizations) || user.githubOrganizations.length === 0) {
      return;
    }

    hasTriggeredRepair.current = true;
    void syncGithubOrganizations().catch((error) => {
      console.error("Failed to repair GitHub organization membership", error);
      hasTriggeredRepair.current = false;
    });
  }, [orgs, syncGithubOrganizations, user]);

  const organization = orgs?.[0] ?? null;
  const isLoading = orgs === undefined;
  const needsInstallation = orgs !== undefined && orgs.length === 0;

  return { organization, isLoading, needsInstallation };
}
