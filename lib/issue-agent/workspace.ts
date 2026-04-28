import { access, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getInstallationClient } from "../github/client.ts";

const execFileAsync = promisify(execFile);

export type EnsuredIssueAgentWorkspace = {
  baseBranch: string;
  branchName: string;
  worktreePath: string;
  claudeSessionPath: string;
  worktreeCreated: boolean;
};

type EnsureWorkspaceArgs = {
  sessionId: string;
  repoFullName: string;
  branchName: string;
  githubInstallationId: number;
  existingWorktreePath?: string;
};

function sanitizeRepoKey(repoFullName: string) {
  return repoFullName.replace(/[\\/]/g, "__");
}

function encodeClaudeProjectPath(cwd: string) {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function getReposRoot() {
  return process.env.ISSUE_AGENT_REPOS_ROOT || path.join(process.cwd(), ".repos");
}

function getWorkspacesRoot() {
  return (
    process.env.ISSUE_AGENT_WORKSPACES_ROOT ||
    path.join(process.cwd(), ".workspaces")
  );
}

function getClaudeHomeRoot() {
  return process.env.ISSUE_AGENT_CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

function getGitUserName() {
  return process.env.ISSUE_AGENT_GIT_USER_NAME || "Eganow Agent";
}

function getGitUserEmail() {
  return process.env.ISSUE_AGENT_GIT_USER_EMAIL || "agent@eganow.local";
}

async function ensureDir(targetPath: string) {
  await mkdir(targetPath, { recursive: true });
}

function buildGitAuthHeader(token: string) {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return `AUTHORIZATION: basic ${basic}`;
}

async function runGit(args: string[], cwd?: string, token?: string) {
  const fullArgs = token
    ? ["-c", `http.extraheader=${buildGitAuthHeader(token)}`, ...args]
    : args;
  return await execFileAsync("git", fullArgs, {
    cwd,
    windowsHide: true,
  });
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getInstallationAccessToken(installationId: number) {
  const octokit = await getInstallationClient(installationId);
  const auth = (await octokit.auth({
    type: "installation",
  } as never)) as { token?: string };

  if (!auth?.token) {
    throw new Error("Unable to resolve a GitHub installation access token");
  }

  return auth.token;
}

async function getDefaultBranch(
  installationId: number,
  repoFullName: string
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationClient(installationId);
  const { data } = await octokit.request("GET /repos/{owner}/{repo}", {
    owner,
    repo,
  });

  return data.default_branch || "main";
}

async function ensureBaseClone(repoFullName: string, token: string) {
  const repoKey = sanitizeRepoKey(repoFullName);
  const reposRoot = getReposRoot();
  const clonePath = path.join(reposRoot, repoKey);
  const remoteUrl = `https://github.com/${repoFullName}.git`;

  await ensureDir(reposRoot);

  if (!(await pathExists(path.join(clonePath, ".git")))) {
    await runGit(["clone", remoteUrl, clonePath], undefined, token);
    return clonePath;
  }

  await runGit(["fetch", "origin", "--prune"], clonePath, token);
  return clonePath;
}

async function ensureGitIdentity(worktreePath: string) {
  await runGit(["config", "user.name", getGitUserName()], worktreePath);
  await runGit(["config", "user.email", getGitUserEmail()], worktreePath);
}

export async function ensureIssueAgentWorkspace(
  args: EnsureWorkspaceArgs
): Promise<EnsuredIssueAgentWorkspace> {
  const workspacesRoot = getWorkspacesRoot();
  const worktreePath =
    args.existingWorktreePath || path.join(workspacesRoot, args.sessionId);
  const token = await getInstallationAccessToken(args.githubInstallationId);
  const baseBranch = await getDefaultBranch(
    args.githubInstallationId,
    args.repoFullName
  );
  const baseClonePath = await ensureBaseClone(args.repoFullName, token);

  await ensureDir(workspacesRoot);

  if (!(await pathExists(path.join(worktreePath, ".git")))) {
    if (await pathExists(worktreePath)) {
      await rm(worktreePath, { recursive: true, force: true });
    }

    await runGit(
      ["worktree", "add", worktreePath, "-b", args.branchName, `origin/${baseBranch}`],
      baseClonePath
    );
  }

  await ensureGitIdentity(worktreePath);

  const claudeSessionPath = path.join(
    getClaudeHomeRoot(),
    "projects",
    encodeClaudeProjectPath(worktreePath)
  );
  await ensureDir(claudeSessionPath);

  return {
    baseBranch,
    branchName: args.branchName,
    worktreePath,
    claudeSessionPath,
    worktreeCreated: true,
  };
}

export async function listChangedFiles(worktreePath: string) {
  const { stdout } = await runGit(["status", "--short"], worktreePath);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function listAheadCommitCount(
  worktreePath: string,
  baseBranch: string
) {
  const { stdout } = await runGit(
    ["rev-list", "--count", `origin/${baseBranch}..HEAD`],
    worktreePath
  );
  return Number.parseInt(stdout.trim() || "0", 10) || 0;
}

export async function commitAllChanges(
  worktreePath: string,
  message: string
) {
  await runGit(["add", "-A"], worktreePath);
  await runGit(["commit", "-m", message], worktreePath);
}

export async function pushBranch(
  worktreePath: string,
  branchName: string,
  installationId: number
) {
  const token = await getInstallationAccessToken(installationId);
  await runGit(["push", "--set-upstream", "origin", branchName], worktreePath, token);
}
