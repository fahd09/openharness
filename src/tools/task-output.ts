/**
 * TaskOutput tool — reads output from a background shell or background agent.
 *
 * Replaces the former BashOutput tool with unified support for both task types.
 */

import { z } from "zod";
import { readFile } from "fs/promises";
import type { Tool, ToolContext } from "./tool-registry.js";
import { getBackgroundTask } from "./background-task-registry.js";

const inputSchema = z.object({
  task_id: z.string().describe("The ID of the background task (shell or agent) to read from"),
  block: z
    .boolean()
    .optional()
    .describe("Whether to wait for task completion (default: true)"),
  timeout: z
    .number()
    .optional()
    .describe("Max wait time in ms (default 30000, cap 600000)"),
});

export const taskOutputTool: Tool = {
  name: "TaskOutput",
  description:
    "Read output from a running or completed background task (shell or agent). Returns status and output.",
  inputSchema,
  maxResultSizeChars: 150000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(rawInput: unknown, _context: ToolContext) {
    const input = inputSchema.parse(rawInput);
    const task = getBackgroundTask(input.task_id);

    if (!task) {
      yield {
        type: "result",
        content: `Error: No background task found with ID "${input.task_id}"`,
      };
      return;
    }

    const shouldBlock = input.block !== false;
    const waitMs = Math.min(input.timeout ?? 30000, 600000);

    if (task.kind === "shell") {
      const entry = task.entry;

      // If shell is still running and blocking, wait for more output
      if (!entry.finished && shouldBlock) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      const parts: string[] = [];

      if (entry.finished) {
        parts.push(`Status: completed (exit code: ${entry.exitCode})`);
      } else {
        parts.push("Status: running");
      }

      parts.push(`Command: ${entry.command}`);
      parts.push(`Started: ${entry.startedAt}`);

      if (entry.stdout) {
        parts.push(`\n--- stdout ---\n${entry.stdout}`);
      }
      if (entry.stderr) {
        parts.push(`\n--- stderr ---\n${entry.stderr}`);
      }
      if (!entry.stdout && !entry.stderr) {
        parts.push("\n(no output yet)");
      }

      yield { type: "result", content: parts.join("\n") };
      return;
    }

    // Agent task
    const entry = task.entry;

    // If agent is still running and blocking, poll until done or timeout
    if (!entry.finished && shouldBlock) {
      const deadline = Date.now() + waitMs;
      while (!entry.finished && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const parts: string[] = [];

    if (entry.finished) {
      parts.push(`Status: completed${entry.error ? ` (error: ${entry.error})` : ""}`);
    } else {
      parts.push("Status: running");
    }

    parts.push(`Description: ${entry.description}`);
    parts.push(`Started: ${entry.startedAt}`);
    parts.push(`Output file: ${entry.outputFile}`);

    // Read agent output file
    try {
      const content = await readFile(entry.outputFile, "utf-8");
      if (content.trim()) {
        parts.push(`\n--- output ---\n${content}`);
      } else {
        parts.push("\n(no output yet)");
      }
    } catch {
      parts.push("\n(no output yet)");
    }

    yield { type: "result", content: parts.join("\n") };
  },
};
