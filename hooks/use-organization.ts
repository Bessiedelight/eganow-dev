"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { useEffect, useRef, useState } from "react";

/**
 * Hook to get the current user's organization.
 * Flow:
 *   1. Check if user has organizations
 *   2. If not, sync GitHub installations from the API into Convex
 *   3. Then bootstrap an org from the installation
 */
export function useOrganization() {
  const orgs = useQuery(api.organizations.getForCurrentUser);
  const bootstrap = useMutation(api.organizations.bootstrapFromInstallation);
  const saveInstallation = useMutation(api.github.saveInstallation);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const hasAttempted = useRef(false);

  useEffect(() => {
    if (
      orgs !== undefined &&
      orgs.length === 0 &&
      !isBootstrapping &&
      !hasAttempted.current
    ) {
      hasAttempted.current = true;
      setIsBootstrapping(true);

      (async () => {
        try {
          // Step 1: Sync GitHub installations from the API into Convex
          const { fetchGitHubInstallations } = await import(
            "../app/dashboard/settings/actions"
          );
          const installations = await fetchGitHubInstallations();

          for (const inst of installations) {
            try {
              await saveInstallation({
                installationId: inst.installationId,
                accountLogin: inst.accountLogin,
                accountType: inst.accountType,
                accountAvatarUrl: inst.accountAvatarUrl,
              });
            } catch {
              // May already exist — ignore
            }
          }

          // Step 2: Bootstrap org from the saved installation
          if (installations.length > 0) {
            await bootstrap();
          }
        } catch (err) {
          console.error("Failed to bootstrap organization:", err);
        } finally {
          setIsBootstrapping(false);
        }
      })();
    }
  }, [orgs, bootstrap, saveInstallation, isBootstrapping]);

  const organization = orgs?.[0] ?? null;
  const isLoading = orgs === undefined || isBootstrapping;
  const needsInstallation =
    orgs !== undefined && orgs.length === 0 && !isBootstrapping;

  return { organization, isLoading, needsInstallation };
}
