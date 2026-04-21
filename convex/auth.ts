import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

function normalizeGithubLogin(value: string) {
  return value.trim().toLowerCase();
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    GitHub({
      authorization: {
        params: {
          scope: "read:user user:email",
        },
      },
      async profile(profile) {
        const githubLogin =
          typeof profile.login === "string" && profile.login.trim().length > 0
            ? normalizeGithubLogin(profile.login)
            : undefined;

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
        };
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, args) {
      if (args.type !== "oauth" || args.provider.id !== "github") {
        return;
      }

      const githubLogin =
        typeof args.profile.githubLogin === "string" &&
        args.profile.githubLogin.trim().length > 0
          ? args.profile.githubLogin
          : undefined;

      if (!githubLogin) {
        return;
      }

      await ctx.runMutation(
        internal.organizations.claimMembershipsForGithubLoginInternal,
        {
          userId: args.userId,
          githubLogin,
        }
      );
    },
  },
});
