import { internal } from "../../convex/_generated/api.js";
import { getConvexAdminClient } from "../convex-server.ts";
import { publishIssueAgentPullRequest } from "./publish.ts";
import { runIssueAgentTurn } from "./runner.ts";

type WorkerOptions = {
  once?: boolean;
  pollIntervalMs?: number;
  workerId?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startHeartbeat(
  convex: ReturnType<typeof getConvexAdminClient>,
  taskId: string,
  workerId: string,
  intervalMs: number
) {
  return setInterval(() => {
    void convex.mutation(internal.issueAgents.heartbeatTask, {
      taskId: taskId as never,
      workerId,
    });
  }, intervalMs);
}

function defaultWorkerId() {
  return `issue-agent-worker-${process.pid}`;
}

export async function runIssueAgentWorker(options: WorkerOptions = {}) {
  const convex = getConvexAdminClient();
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const heartbeatIntervalMs = Math.max(1000, Math.floor(pollIntervalMs * 2.5));
  const workerId = options.workerId ?? defaultWorkerId();

  console.info(
    `[issue-agent-worker] started as ${workerId} (poll ${pollIntervalMs}ms)`
  );

  for (;;) {
    const task = await convex.mutation(internal.issueAgents.claimNextTask, {
      workerId,
    });

    if (!task) {
      if (options.once) {
        return null;
      }

      await sleep(pollIntervalMs);
      continue;
    }

    try {
      console.info(
        `[issue-agent-worker] claimed ${task.taskType} task ${task._id} for session ${task.sessionId}`
      );
      await convex.mutation(internal.issueAgents.heartbeatTask, {
        taskId: task._id,
        workerId,
      });
      const heartbeat = startHeartbeat(
        convex,
        task._id,
        workerId,
        heartbeatIntervalMs
      );

      try {
        if (task.taskType === "publish") {
          await publishIssueAgentPullRequest({
            convex,
            sessionId: task.sessionId,
          });
        } else {
          const result = await runIssueAgentTurn({
            convex,
            taskId: task._id,
            sessionId: task.sessionId,
            prompt: task.prompt ?? "",
          });

          if (result.status === "cancelled") {
            await convex.mutation(internal.issueAgents.completeTask, {
              taskId: task._id,
              status: "cancelled",
            });

            if (options.once) {
              return null;
            }

            continue;
          }
        }
      } finally {
        clearInterval(heartbeat);
      }

      await convex.mutation(internal.issueAgents.completeTask, {
        taskId: task._id,
      });
      console.info(
        `[issue-agent-worker] completed ${task.taskType} task ${task._id} for session ${task.sessionId}`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Issue agent worker task failed";

      console.error(
        `[issue-agent-worker] failed ${task.taskType} task ${task._id} for session ${task.sessionId}: ${message}`
      );
      await convex.mutation(internal.issueAgents.failTask, {
        taskId: task._id,
        error: message,
      });
    }

    if (options.once) {
      return null;
    }
  }
}
