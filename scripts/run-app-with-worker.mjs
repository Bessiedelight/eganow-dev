import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "start" ? "start" : "dev";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeExecutable = process.execPath;
const nextCliPath = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
const standaloneServerPath = path.join(rootDir, ".next", "standalone", "server.js");
const workerEntryPath = path.join(rootDir, "issue-agent-worker.ts");

const children = [];
let shuttingDown = false;

function spawnManagedProcess(name, args, options = {}) {
  const { required = true } = options;
  const child = spawn(nodeExecutable, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (!required) {
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
      console.warn(`[${name}] stopped with ${reason}`);
      return;
    }

    shuttingDown = true;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(`[${name}] stopped with ${reason}`);

    for (const sibling of children) {
      if (sibling !== child && !sibling.killed) {
        sibling.kill("SIGTERM");
      }
    }

    process.exit(code ?? 1);
  });

  children.push(child);
  return child;
}

function envFlag(name) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function hasConvexWorkerAuth() {
  return Boolean(
    process.env.CONVEX_DEPLOY_KEY?.trim() || process.env.CONVEX_ADMIN_KEY?.trim()
  );
}

function shouldRunIssueAgentWorker() {
  const explicit = envFlag("ISSUE_AGENT_WORKER_ENABLED");
  if (explicit !== undefined) {
    return explicit;
  }

  if (mode === "dev") {
    return true;
  }

  return hasConvexWorkerAuth();
}

function getAppEntrypointArgs() {
  if (mode === "start" && existsSync(standaloneServerPath)) {
    return [standaloneServerPath];
  }

  return [
    nextCliPath,
    mode,
    ...(mode === "dev" ? ["--turbopack"] : []),
  ];
}

function shutdownAll(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdownAll("SIGINT"));
process.on("SIGTERM", () => shutdownAll("SIGTERM"));

spawnManagedProcess("app", getAppEntrypointArgs());

if (shouldRunIssueAgentWorker()) {
  spawnManagedProcess(
    "issue-agent-worker",
    ["--experimental-strip-types", workerEntryPath],
    { required: mode === "dev" }
  );
} else {
  console.warn(
    "[issue-agent-worker] skipped because no Convex admin credentials are configured. Set CONVEX_DEPLOY_KEY or CONVEX_ADMIN_KEY, or override with ISSUE_AGENT_WORKER_ENABLED=true."
  );
}
