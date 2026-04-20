import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "eganow-dev",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function fetchGitHubOrganizations(accessToken: string) {
  const githubOrganizations: string[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/user/orgs?per_page=100&page=${page}`,
      {
        headers: {
          ...GITHUB_API_HEADERS,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub org membership lookup failed with status ${response.status}`
      );
    }

    const organizations = (await response.json()) as Array<{
      login?: string | null;
    }>;

    for (const organization of organizations) {
      const login = organization.login?.trim();
      if (login) {
        githubOrganizations.push(login);
      }
    }

    if (organizations.length < 100) {
      break;
    }

    page += 1;
  }

  return Array.from(new Set(githubOrganizations));
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    GitHub({
      authorization: {
        params: {
          scope: "read:user user:email read:org",
        },
      },
      async profile(profile, tokens) {
        const githubLogin =
          typeof profile.login === "string" ? profile.login : undefined;

        let githubOrganizations: string[] = [];
        if (tokens.access_token) {
          try {
            githubOrganizations = await fetchGitHubOrganizations(
              tokens.access_token
            );
          } catch (error) {
            console.error(
              "[Auth] Failed to fetch GitHub organizations during sign-in",
              error
            );
          }
        }

        return {
          id: profile.id.toString(),
          name:
            typeof profile.name === "string" && profile.name
              ? profile.name
              : githubLogin,
          email:
            typeof profile.email === "string" ? profile.email : undefined,
          image:
            typeof profile.avatar_url === "string"
              ? profile.avatar_url
              : undefined,
          githubLogin,
          githubOrganizations,
        };
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, args) {
      if (args.type !== "oauth" || args.provider.id !== "github") {
        return;
      }

      const githubOrganizations = Array.isArray(args.profile.githubOrganizations)
        ? args.profile.githubOrganizations.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0
          )
        : [];

      if (githubOrganizations.length === 0) {
        return;
      }

      const githubLogin =
        typeof args.profile.githubLogin === "string" &&
        args.profile.githubLogin.trim().length > 0
          ? args.profile.githubLogin
          : undefined;

      await ctx.runMutation(
        internal.organizations.syncMembershipsFromGithubOrganizationsInternal,
        {
          userId: args.userId,
          githubOrganizations,
          githubLogin,
        }
      );
    },
  },
});
