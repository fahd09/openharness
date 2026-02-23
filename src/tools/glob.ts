import fg from "fast-glob";
import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({
  pattern: z
    .string()
    .describe('Glob pattern to match files (e.g. "**/*.ts", "src/**/*.js")'),
  path: z
    .string()
    .optional()
    .describe("Directory to search in (defaults to cwd)"),
});

export const globTool: Tool = {
  name: "Glob",
  description:
    "Find files matching a glob pattern. Returns matching file paths sorted by modification time.",
  inputSchema,
  maxResultSizeChars: 100000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);
    const searchDir = input.path ?? context.cwd;

    // Pre-check abort
    if (context.abortSignal?.aborted) {
      yield { type: "result", content: "Tool execution was aborted." };
      return;
    }

    try {
      const entries = await fg(input.pattern, {
        cwd: searchDir,
        absolute: true,
        dot: false,
        ignore: ["**/node_modules/**", "**/.git/**"],
        stats: true,
      });

      if (entries.length === 0) {
        yield { type: "result", content: "No files matched the pattern." };
        return;
      }

      // Sort by modification time (newest first)
      const sorted = entries.sort((a, b) => {
        const aTime = a.stats?.mtimeMs ?? 0;
        const bTime = b.stats?.mtimeMs ?? 0;
        return bTime - aTime;
      });

      const paths = sorted.map((e) => e.path ?? e.name);
      yield {
        type: "result",
        content: `Found ${paths.length} file(s):\n${paths.join("\n")}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "result", content: `Error: ${msg}` };
    }
  },
};
