import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { runIssueAgentWorker } from "./lib/issue-agent/worker.ts";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadLocalEnv() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));
}

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function hasConvexAdminAuth() {
  return Boolean(
    process.env.CONVEX_DEPLOY_KEY?.trim() || process.env.CONVEX_ADMIN_KEY?.trim()
  );
}

async function main() {
  loadLocalEnv();
  const once = process.argv.includes("--once");
  const pollArg = process.argv.find((arg) => arg.startsWith("--poll="));
  const pollIntervalMs = pollArg
    ? Number.parseInt(pollArg.slice("--poll=".length), 10)
    : undefined;
  const allowUnauthenticatedFallback = envFlag("ISSUE_AGENT_ALLOW_CLI_FALLBACK") === true;
  const inProduction = process.env.NODE_ENV === "production";

  if (inProduction && !hasConvexAdminAuth() && !allowUnauthenticatedFallback) {
    console.warn(
      "Issue agent worker skipped in production because CONVEX_DEPLOY_KEY / CONVEX_ADMIN_KEY is not set and CLI fallback is not available on hosted deployments."
    );
    return;
  }

  await runIssueAgentWorker({
    once,
    pollIntervalMs:
      typeof pollIntervalMs === "number" && Number.isFinite(pollIntervalMs)
        ? pollIntervalMs
        : undefined,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
