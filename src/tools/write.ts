import { writeFile, mkdir, stat } from "fs/promises";
import { dirname } from "path";
import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({
  file_path: z
    .string()
    .describe("The absolute path to the file to write"),
  content: z.string().describe("The content to write to the file"),
});

export const writeTool: Tool = {
  name: "Write",
  description:
    "Write content to a NEW file. The file must not already exist — use the Edit tool to modify existing files. Creates parent directories as needed.",
  inputSchema,
  maxResultSizeChars: 100000,
  isConcurrencySafe: () => false,
  isReadOnly: () => false,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);

    // Pre-check abort
    if (context.abortSignal?.aborted) {
      yield { type: "result", content: "Tool execution was aborted." };
      return;
    }

    if (!input.file_path.startsWith("/")) {
      yield { type: "result", content: "Error: file_path must be an absolute path" };
      return;
    }

    try {
      // Write is only for NEW files. If file already exists, reject.
      try {
        await stat(input.file_path);
        // File exists — refuse and point to Edit
        yield {
          type: "result",
          content: `Error: ${input.file_path} already exists. The Write tool can only create new files. Use the Edit tool to modify existing files.`,
        };
        return;
      } catch {
        // File doesn't exist — good, proceed with creation
      }

      // Ensure parent directory exists
      await mkdir(dirname(input.file_path), { recursive: true });
      await writeFile(input.file_path, input.content, "utf-8");

      const lineCount = input.content.split("\n").length;
      yield {
        type: "result",
        content: `Successfully wrote ${lineCount} lines to ${input.file_path}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "result", content: `Error writing file: ${msg}` };
    }
  },
};
