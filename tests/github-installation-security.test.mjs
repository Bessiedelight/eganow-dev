import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Webhooks } from "@octokit/webhooks";
import ts from "typescript";

// Load the actual Convex handlers without requiring a deployed backend or a TS loader.
async function loadHandlers(filename) {
  const sourceUrl = new URL(`../convex/${filename}.ts`, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const code = outputText.replace(/from "([^"]+)"/g, (_, specifier) => {
    const resolved = specifier.startsWith(".")
      ? new URL(`${specifier}.js`, sourceUrl).href
      : import.meta.resolve(specifier);
    return `from ${JSON.stringify(resolved)}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const github = await loadHandlers("github");
const organizations = await loadHandlers("organizations");

test("the webhook verifier dispatches only correctly signed payloads", async () => {
  const secret = "synthetic-test-secret";
  const webhooks = new Webhooks({ secret });
  let dispatched = 0;
  webhooks.on("installation.created", () => { dispatched += 1; });
  const payload = JSON.stringify({ action: "created", installation: { id: 123 } });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const event = { id: "synthetic-delivery", name: "installation", payload, signature };
  await assert.rejects(webhooks.verifyAndReceive({ ...event, signature: "sha256=invalid" }), /signature/);
  await assert.rejects(webhooks.verifyAndReceive({ ...event, payload: payload.replace("123", "456") }), /signature/);
  assert.equal(dispatched, 0);
  await webhooks.verifyAndReceive(event);
  assert.equal(dispatched, 1);
});

test("browser mutation validators reject installer metadata and roster inputs", () => {
  for (const fn of [github.saveInstallation, organizations.bootstrapFromInstallation]) {
    assert.deepEqual(Object.keys(JSON.parse(fn.exportArgs()).value), ["installationId"]);
  }
});

function fixture(currentUserId = "attacker") {
  const tables = {
    users: [
      { _id: "victim", githubLogin: "victim", name: "Victim" },
      { _id: "attacker", githubLogin: "attacker", name: "Attacker" },
    ],
    githubInstallations: [{
      _id: "installation", installationId: 123, userId: "victim",
      installedByGithubLogin: "victim", accountLogin: "victim-org",
      accountType: "Organization", status: "active", installedAt: 1,
    }],
    organizations: [{
      _id: "organization", githubInstallationId: 123,
      githubAccountLogin: "victim-org", createdBy: "victim",
    }],
    members: [{
      _id: "owner", userId: "victim", organizationId: "organization",
      role: "owner", githubUsername: "victim", status: "active",
    }],
    labels: [],
  };
  const ctx = {
    auth: { getUserIdentity: async () => currentUserId ? { subject: currentUserId } : null },
    db: {
      get: async (id) => Object.values(tables).flat().find((row) => row._id === id) ?? null,
      query: (table) => {
        const predicates = [];
        const query = {
          withIndex: (_name, configure) => {
            const index = {
              eq: (field, value) => {
                predicates.push((row) => row[field] === value);
                return index;
              },
            };
            configure(index);
            return query;
          },
          collect: async () => tables[table].filter((row) => predicates.every((p) => p(row))),
          first: async () => (await query.collect())[0] ?? null,
          unique: async () => {
            const rows = await query.collect();
            assert.ok(rows.length <= 1);
            return rows[0] ?? null;
          },
        };
        return query;
      },
      patch: async (id, fields) => {
        const row = await ctx.db.get(id);
        assert.ok(row);
        Object.assign(row, fields);
      },
      insert: async (table, fields) => {
        const id = `${table}-${tables[table].length}`;
        tables[table].push({ _id: id, ...fields });
        return id;
      },
    },
  };
  return { ctx, tables };
}

test("webhook installation and roster writes are internal", () => {
  for (const fn of [
    github.saveInstallationFromWebhook,
    github.removeInstallationFromWebhook,
    organizations.syncInstallationRosterFromWebhook,
    organizations.addRosterMemberFromWebhook,
    organizations.removeRosterMemberFromWebhook,
  ]) {
    assert.equal(fn.isInternal, true);
    assert.notEqual(fn.isPublic, true);
  }
});

test("an ordinary user cannot replace a victim's installation provenance", async () => {
  const { ctx, tables } = fixture();
  const before = structuredClone(tables);
  await assert.rejects(github.saveInstallation._handler(ctx, { installationId: 123 }), /not verified/);
  assert.deepEqual(tables, before);
  await organizations.claimCurrentUserMemberships._handler(ctx, {});
  assert.deepEqual(tables, before);
});

test("direct bootstrap cannot bypass installation linking", async () => {
  const { ctx, tables } = fixture();
  const before = structuredClone(tables);
  await assert.rejects(organizations.bootstrapFromInstallation._handler(ctx, { installationId: 123 }), /not verified/);
  assert.deepEqual(tables, before);
});

test("unauthenticated callers cannot link or bootstrap installations", async () => {
  const { ctx, tables } = fixture(null);
  const before = structuredClone(tables);
  for (const fn of [github.saveInstallation, organizations.bootstrapFromInstallation]) {
    await assert.rejects(fn._handler(ctx, { installationId: 123 }), /Not authenticated/);
  }
  assert.deepEqual(tables, before);
});

test("a browser cannot create an installation before its webhook arrives", async () => {
  const { ctx, tables } = fixture("victim");
  tables.githubInstallations = [];
  await assert.rejects(github.saveInstallation._handler(ctx, { installationId: 123 }), /not verified/);
  assert.deepEqual(tables.githubInstallations, []);
});

test("removed installations cannot be linked, bootstrapped, or claimed", async () => {
  const { ctx, tables } = fixture("victim");
  tables.githubInstallations[0].status = "removed";
  tables.members = [];
  const before = structuredClone(tables);
  for (const fn of [github.saveInstallation, organizations.bootstrapFromInstallation]) {
    await assert.rejects(fn._handler(ctx, { installationId: 123 }), /not verified/);
  }
  await organizations.claimCurrentUserMemberships._handler(ctx, {});
  assert.deepEqual(tables, before);
});

test("missing installer identity cannot authorize linking or bootstrap", async () => {
  const { ctx, tables } = fixture("victim");
  delete tables.users[0].githubLogin;
  delete tables.githubInstallations[0].installedByGithubLogin;
  const before = structuredClone(tables);
  for (const fn of [github.saveInstallation, organizations.bootstrapFromInstallation]) {
    await assert.rejects(fn._handler(ctx, { installationId: 123 }), /not verified/);
  }
  assert.deepEqual(tables, before);
});

test("a matching login cannot replace another linked user", async () => {
  const { ctx, tables } = fixture();
  tables.users[1].githubLogin = "victim";
  const before = structuredClone(tables);
  for (const fn of [github.saveInstallation, organizations.bootstrapFromInstallation]) {
    await assert.rejects(fn._handler(ctx, { installationId: 123 }), /not verified/);
  }
  assert.deepEqual(tables, before);
});

test("the verified installer can link and bootstrap without replacing provenance or metadata", async () => {
  const { ctx, tables } = fixture("victim");
  delete tables.githubInstallations[0].userId;
  tables.members = [];
  const before = structuredClone(tables.githubInstallations[0]);
  assert.equal(await github.saveInstallation._handler(ctx, { installationId: 123 }), "installation");
  assert.deepEqual(tables.githubInstallations[0], { ...before, userId: "victim" });
  assert.equal(await organizations.bootstrapFromInstallation._handler(ctx, { installationId: 123 }), "organization");
  assert.equal(tables.members.length, 1);
  assert.equal(tables.members[0].userId, "victim");
  assert.equal(tables.members[0].role, "owner");
  assert.equal(tables.members[0].status, "active");
});

test("verified webhook persistence still supports automatic installer and roster claims", async () => {
  const { ctx, tables } = fixture("victim");
  tables.githubInstallations = [];
  tables.organizations = [];
  tables.members = [];
  const args = {
    installationId: 123, accountLogin: "victim-org", accountType: "Organization",
    installedByGithubLogin: "victim",
  };
  await github.saveInstallationFromWebhook._handler(ctx, args);
  await organizations.syncInstallationRosterFromWebhook._handler(ctx, { ...args, memberUsernames: ["attacker"] });
  await organizations.claimCurrentUserMemberships._handler(ctx, {});
  const owner = tables.members.find((row) => row.userId === "victim");
  assert.equal(owner.role, "owner");
  assert.equal(owner.status, "active");
  const memberContext = fixture();
  memberContext.ctx.db = ctx.db;
  await organizations.claimCurrentUserMemberships._handler(memberContext.ctx, {});
  const member = tables.members.find((row) => row.userId === "attacker");
  assert.equal(member.role, "member");
  assert.equal(member.status, "active");
});
