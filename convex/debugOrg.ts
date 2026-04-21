import { internalQuery } from "./_generated/server";

export const dumpState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const members = await ctx.db.query("members").collect();
    const installations = await ctx.db.query("githubInstallations").collect();
    const users = await ctx.db.query("users").collect();

    return {
      users: users.map(u => ({ id: u._id, githubLogin: u.githubLogin })),
      installations: installations.map(i => ({ id: i._id, accountLogin: i.accountLogin, instId: i.installationId })),
      orgs: orgs.map(o => ({ id: o._id, slug: o.slug, name: o.name, instId: o.githubInstallationId })),
      members: members.map(m => ({ id: m._id, org: m.organizationId, user: m.userId, github: m.githubUsername, status: m.status })),
    };
  },
});
