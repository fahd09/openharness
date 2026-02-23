/**
 * KillShell tool — terminates a background shell process.
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";
import { killShell, getShell } from "./shell-registry.js";

const inputSchema = z.object({
  shell_id: z.string().describe("The ID of the background shell to terminate"),
});

export const killShellTool: Tool = {
  name: "KillShell",
  description: "Terminate a running background shell process by its ID.",
  inputSchema,
  maxResultSizeChars: 10000,
  isConcurrencySafe: () => false,
  isReadOnly: () => false,

  async *call(rawInput: unknown, _context: ToolContext) {
    const input = inputSchema.parse(rawInput);
    const entry = getShell(input.shell_id);

    if (!entry) {
      yield { type: "result", content: `Error: No background shell found with ID "${input.shell_id}"` };
      return;
    }

    if (entry.finished) {
      yield { type: "result", content: `Shell ${input.shell_id} has already finished (exit code: ${entry.exitCode}).` };
      return;
    }

    const killed = killShell(input.shell_id);
    if (killed) {
      yield { type: "result", content: `Shell ${input.shell_id} terminated.` };
    } else {
      yield { type: "result", content: `Error: Failed to terminate shell ${input.shell_id}.` };
    }
  },
};
