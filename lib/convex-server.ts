import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Server-side Convex client singleton.
 * Used by webhook handlers and server actions to call Convex mutations.
 */
let _client: ConvexHttpClient | null = null;
let _adminClient: ConvexWorkerClient | null = null;
let _loggedCliFallback = false;

const execFileAsync = promisify(execFile);

export type ConvexWorkerClient = {
  query<FuncRef extends FunctionReference<any, any, any, any>>(
    func: FuncRef,
    args: FunctionArgs<FuncRef>
  ): Promise<FunctionReturnType<FuncRef>>;
  mutation<FuncRef extends FunctionReference<any, any, any, any>>(
    func: FuncRef,
    args: FunctionArgs<FuncRef>
  ): Promise<FunctionReturnType<FuncRef>>;
};

function getConvexCliEntryArgs() {
  const convexCliPath = path.join(
    process.cwd(),
    "node_modules",
    "convex",
    "bin",
    "main.js"
  );

  return [process.execPath, convexCliPath] as const;
}

function parseConvexCliResult<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === "undefined") {
    return null as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return trimmed as T;
  }
}

function formatCliFailure(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.trim()
  ) {
    return error.stderr.trim();
  }

  if (
    error &&
    typeof error === "object" &&
    "stdout" in error &&
    typeof error.stdout === "string" &&
    error.stdout.trim()
  ) {
    return error.stdout.trim();
  }

  return error instanceof Error ? error.message : "Unknown Convex CLI failure";
}

function createConvexCliWorkerClient(): ConvexWorkerClient {
  if (!_loggedCliFallback) {
    _loggedCliFallback = true;
    console.warn(
      "Issue agent worker is using Convex CLI fallback because CONVEX_DEPLOY_KEY / CONVEX_ADMIN_KEY is not set."
    );
  }

  async function runWithCli<FuncRef extends FunctionReference<any, any, any, any>>(
    kind: "query" | "mutation",
    func: FuncRef,
    args: FunctionArgs<FuncRef>
  ): Promise<FunctionReturnType<FuncRef>> {
    const functionName = getFunctionName(func as never);
    const [command, convexCliPath] = getConvexCliEntryArgs();
    const cliArgs = [
      convexCliPath,
      "run",
      functionName,
      JSON.stringify(args ?? {}),
      "--typecheck=disable",
      "--codegen=disable",
    ];
    const deployment = process.env.ISSUE_AGENT_CONVEX_DEPLOYMENT;

    if (deployment) {
      cliArgs.push("--deployment", deployment);
    }

    try {
      const { stdout } = await execFileAsync(command, cliArgs, {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });

      return parseConvexCliResult<FunctionReturnType<FuncRef>>(stdout);
    } catch (error) {
      const message = formatCliFailure(error);
      throw new Error(
        `Failed to run Convex ${kind} "${functionName}" through CLI fallback: ${message}`
      );
    }
  }

  return {
    query(func, args) {
      return runWithCli("query", func, args);
    },
    mutation(func, args) {
      return runWithCli("mutation", func, args);
    },
  };
}

export function getConvexClient(): ConvexHttpClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }

  _client = new ConvexHttpClient(url);
  return _client;
}

export function getConvexAdminClient(): ConvexWorkerClient {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }

  const adminToken =
    process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_ADMIN_KEY;
  if (!adminToken) {
    _adminClient = createConvexCliWorkerClient();
    return _adminClient;
  }

  const client = new ConvexHttpClient(url) as ConvexHttpClient & {
    setAdminAuth(token: string): void;
  };
  client.setAdminAuth(adminToken);
  _adminClient = {
    query(func, args) {
      return client.query(func as never, args as never) as Promise<
        FunctionReturnType<typeof func>
      >;
    },
    mutation(func, args) {
      return client.mutation(func as never, args as never) as Promise<
        FunctionReturnType<typeof func>
      >;
    },
  };
  return _adminClient;
}
