import { readFile, stat } from "fs/promises";
import { z } from "zod";
import { isPdfPath, extractPdfText } from "../core/pdf.js";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({
  file_path: z.string().describe("The absolute path to the file to read"),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Number of lines to read"),
  pages: z
    .string()
    .optional()
    .describe("Page range for PDF files (e.g., '1-5', '3')"),
});

export const readTool: Tool = {
  name: "Read",
  description:
    "Read a file from the filesystem. Returns line-numbered content.",
  inputSchema,
  maxResultSizeChars: 100000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

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
      // Check file exists and get size
      const fileStat = await stat(input.file_path);
      if (fileStat.isDirectory()) {
        yield {
          type: "result",
          content: "Error: Path is a directory, not a file. Use Bash with ls to list directory contents.",
        };
        return;
      }

      // PDF files: extract text instead of reading raw
      if (isPdfPath(input.file_path)) {
        const text = await extractPdfText(input.file_path, input.pages);
        context.readFiles?.add(input.file_path);
        yield { type: "result", content: text };
        return;
      }

      const raw = await readFile(input.file_path, "utf-8");
      const allLines = raw.split("\n");
      const totalLines = allLines.length;

      // Apply offset and limit
      const startLine = Math.max(1, input.offset ?? 1);
      const maxLines = input.limit ?? 2000;
      const endLine = Math.min(totalLines, startLine + maxLines - 1);

      const selectedLines = allLines.slice(startLine - 1, endLine);

      // Format with line numbers (cat -n style)
      const numbered = selectedLines
        .map((line, i) => {
          const lineNum = startLine + i;
          const padding = String(endLine).length;
          return `${String(lineNum).padStart(padding)}\t${line}`;
        })
        .join("\n");

      let result = numbered;
      if (endLine < totalLines) {
        result += `\n\n(${totalLines - endLine} more lines not shown. Use offset/limit to read more.)`;
      }

      // Track this file as read (for read-before-write enforcement)
      context.readFiles?.add(input.file_path);

      yield { type: "result", content: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "result", content: `Error reading file: ${msg}` };
    }
  },
};
