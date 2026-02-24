/**
 * TaskStop tool — stops a running background task (shell or agent).
 *
 * Replaces the former KillShell tool with unified support for both task types.
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";
import { getBackgroundTask, stopBackgroundTask } from "./background-task-registry.js";

const inputSchema = z.object({
  task_id: z
    .string()
    .optional()
    .describe("The ID of the background task to stop"),
  shell_id: z
    .string()
    .optional()
    .describe("Deprecated: use task_id instead"),
});

export const taskStopTool: Tool = {
  name: "TaskStop",
  description: "Stop a running background task (shell or agent) by its ID.",
  inputSchema,
  maxResultSizeChars: 10000,
  isConcurrencySafe: () => true,
  isReadOnly: () => false,

  async *call(rawInput: unknown, _context: ToolContext) {
    const input = inputSchema.parse(rawInput);
    const taskId = input.task_id ?? input.shell_id;

    if (!taskId) {
      yield {
        type: "result",
        content: "Error: Either task_id or shell_id is required.",
      };
      return;
    }

    const task = getBackgroundTask(taskId);
    if (!task) {
      yield {
        type: "result",
        content: `Error: No background task found with ID "${taskId}"`,
      };
      return;
    }

    // Already finished
    if (
      (task.kind === "shell" && task.entry.finished) ||
      (task.kind === "agent" && task.entry.finished)
    ) {
      yield {
        type: "result",
        content: `Task ${taskId} has already finished.`,
      };
      return;
    }

    const stopped = stopBackgroundTask(taskId);
    if (stopped) {
      yield {
        type: "result",
        content: `Task ${taskId} terminated.`,
      };
    } else {
      yield {
        type: "result",
        content: `Error: Failed to terminate task ${taskId}.`,
      };
    }
  },
};
