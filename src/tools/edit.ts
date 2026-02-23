import { readFile, writeFile } from "fs/promises";
import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({
  file_path: z
    .string()
    .describe("The absolute path to the file to modify"),
  old_string: z.string().describe("The exact string to find and replace"),
  new_string: z
    .string()
    .describe("The replacement string (must differ from old_string)"),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe("Replace all occurrences (default: false)"),
});

export const editTool: Tool = {
  name: "Edit",
  description:
    "Perform exact string replacement in a file. The old_string must be unique in the file unless replace_all is true.",
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
    if (input.old_string === input.new_string) {
      yield { type: "result", content: "Error: old_string and new_string must be different" };
      return;
    }

    try {
      // Read-before-write enforcement: file must be read first
      if (context.readFiles && !context.readFiles.has(input.file_path)) {
        yield {
          type: "result",
          content: `Error: You must read ${input.file_path} before editing it. Use the Read tool first.`,
        };
        return;
      }

      const content = await readFile(input.file_path, "utf-8");

      // Check how many times old_string appears
      const occurrences = content.split(input.old_string).length - 1;

      if (occurrences === 0) {
        yield {
          type: "result",
          content: `Error: old_string not found in ${input.file_path}. Make sure the string matches exactly, including whitespace and indentation.`,
        };
        return;
      }

      if (occurrences > 1 && !input.replace_all) {
        yield {
          type: "result",
          content: `Error: old_string appears ${occurrences} times in ${input.file_path}. Provide more context to make it unique, or set replace_all to true.`,
        };
        return;
      }

      let newContent: string;
      if (input.replace_all) {
        newContent = content.split(input.old_string).join(input.new_string);
      } else {
        newContent = content.replace(input.old_string, input.new_string);
      }

      await writeFile(input.file_path, newContent, "utf-8");

      const replaced = input.replace_all ? occurrences : 1;
      yield {
        type: "result",
        content: `Successfully replaced ${replaced} occurrence(s) in ${input.file_path}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "result", content: `Error editing file: ${msg}` };
    }
  },
};
