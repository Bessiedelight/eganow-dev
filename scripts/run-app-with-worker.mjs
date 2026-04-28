import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "start" ? "start" : "dev";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeExecutable = process.execPath;
const nextCliPath = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
const workerEntryPath = path.join(rootDir, "issue-agent-worker.ts");

const children = [];
let shuttingDown = false;

function spawnManagedProcess(name, args) {
  const child = spawn(nodeExecutable, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
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

spawnManagedProcess("app", [
  nextCliPath,
  mode,
  ...(mode === "dev" ? ["--turbopack"] : []),
]);
spawnManagedProcess("issue-agent-worker", [
  "--experimental-strip-types",
  workerEntryPath,
]);
