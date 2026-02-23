/**
 * BashOutput tool — reads output from a background shell.
 *
 * Equivalent to the original's "TaskOutput" / shell reader.
 * Takes a shell_id and returns the current stdout/stderr.
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";
import { getShell } from "./shell-registry.js";

const inputSchema = z.object({
  shell_id: z.string().describe("The ID of the background shell to read from"),
  timeout: z
    .number()
    .optional()
    .describe("Max time to wait (ms) for output if shell is still running (default: 5000)"),
});

export const bashOutputTool: Tool = {
  name: "BashOutput",
  description:
    "Read output from a running or completed background shell. Returns stdout/stderr and status.",
  inputSchema,
  maxResultSizeChars: 150000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(rawInput: unknown, _context: ToolContext) {
    const input = inputSchema.parse(rawInput);
    const entry = getShell(input.shell_id);

    if (!entry) {
      yield { type: "result", content: `Error: No background shell found with ID "${input.shell_id}"` };
      return;
    }

    // If shell is still running, optionally wait for more output
    if (!entry.finished && input.timeout) {
      const waitMs = Math.min(input.timeout, 30000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const parts: string[] = [];

    // Status line
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
  },
};
