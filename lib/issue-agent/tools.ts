import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

import { internal } from "../../convex/_generated/api.js";
import type { ConvexWorkerClient } from "../convex-server.ts";

type IssueAgentContext = Awaited<
  ReturnType<ConvexWorkerClient["query"] extends (
    func: any,
    args: any
  ) => Promise<infer T>
    ? () => Promise<T>
    : never>
>;

type CreateIssueAgentMcpServerArgs = {
  convex: ConvexWorkerClient;
  context: any;
  onPublishApprovalRequested?: () => void;
};

function formatLinkedPullRequests(context: any) {
  if (!context.linkedPullRequests?.length) {
    return "None";
  }

  return context.linkedPullRequests
    .map((link: any) => `${link.pullRequestId} (${link.linkType})`)
    .join(", ");
}

export function createIssueAgentMcpServer({
  convex,
  context,
  onPublishApprovalRequested,
}: CreateIssueAgentMcpServerArgs) {
  return createSdkMcpServer({
    name: "eganow",
    version: "1.0.0",
    tools: [
      tool(
        "eganow_get_issue_context",
        "Get the canonical issue and session context from Eganow before planning or making changes.",
        {},
        async () => ({
          content: [
            {
              type: "text",
              text: [
                `Issue: ${context.issue.identifier} - ${context.issue.title}`,
                `Repository: ${context.session.repoFullName}`,
                `Project: ${context.project?.name || "None"}`,
                `GitHub issue: ${
                  typeof context.issue.githubIssueNumber === "number"
                    ? `#${context.issue.githubIssueNumber}`
                    : "Not linked"
                }`,
                `Current branch: ${context.workspace.branchName}`,
                "",
                "Issue body:",
                context.issue.body || "No issue body provided.",
              ].join("\n"),
            },
          ],
        })
      ),
      tool(
        "eganow_get_repo_context",
        "Get repository-level context Eganow already knows about, including branches and linked pull requests.",
        {},
        async () => ({
          content: [
            {
              type: "text",
              text: [
                `Repository: ${context.session.repoFullName}`,
                `Base branch: ${context.workspace.baseBranch}`,
                `Issue branch: ${context.workspace.branchName}`,
                `Existing linked PRs: ${formatLinkedPullRequests(context)}`,
                `Published PR on session: ${
                  context.session.githubPrUrl || "None"
                }`,
              ].join("\n"),
            },
          ],
        })
      ),
      tool(
        "eganow_publish_pull_request",
        "Request publication of the current branch as a pull request through Eganow's controlled GitHub App flow. Use this only when code changes are complete and the user wants a PR.",
        {},
        async () => {
          await convex.mutation(internal.issueAgents.requestPublishApprovalFromWorker, {
            sessionId: context.session._id,
            reason:
              "Claude is ready to publish the current issue branch as a pull request through Eganow.",
          });
          onPublishApprovalRequested?.();

          return {
            content: [
              {
                type: "text",
                text:
                  "Publish approval requested. Wait for the user to approve before expecting the pull request to be created.",
              },
            ],
          };
        }
      ),
    ],
  });
}
