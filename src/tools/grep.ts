import { execFile } from "child_process";
import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({
  pattern: z
    .string()
    .describe("Regex pattern to search for in file contents"),
  path: z
    .string()
    .optional()
    .describe("File or directory to search in (defaults to cwd)"),
  glob: z
    .string()
    .optional()
    .describe('Glob pattern to filter files (e.g. "*.ts")'),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .default("files_with_matches")
    .describe("Output mode (default: files_with_matches)"),
  "-i": z.boolean().optional().describe("Case insensitive search"),
  "-n": z
    .boolean()
    .optional()
    .default(true)
    .describe("Show line numbers (for content mode)"),
  "-A": z.number().optional().describe("Lines to show after each match"),
  "-B": z.number().optional().describe("Lines to show before each match"),
  "-C": z.number().optional().describe("Context lines before and after"),
  head_limit: z
    .number()
    .optional()
    .describe("Limit output to first N entries"),
  offset: z
    .number()
    .optional()
    .describe("Skip first N entries before applying head_limit"),
  type: z
    .string()
    .optional()
    .describe("File type to search (rg --type, e.g. js, py, rust)"),
  multiline: z
    .boolean()
    .optional()
    .describe("Enable multiline matching where . matches newlines (rg -U)"),
});

export const grepTool: Tool = {
  name: "Grep",
  description:
    "Search file contents using ripgrep (rg). Supports regex, file filtering, and context lines.",
  inputSchema,
  maxResultSizeChars: 100000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);
    const searchPath = input.path ?? context.cwd;

    // Pre-check: if already aborted, don't spawn
    if (context.abortSignal?.aborted) {
      yield { type: "result", content: "Tool execution was aborted." };
      return;
    }

    yield { type: "progress", content: `Searching for "${input.pattern}"...` };

    // Build rg arguments
    const args: string[] = [];

    // Output mode
    switch (input.output_mode) {
      case "files_with_matches":
        args.push("-l");
        break;
      case "count":
        args.push("-c");
        break;
      case "content":
        if (input["-n"] !== false) args.push("-n");
        break;
    }

    if (input["-i"]) args.push("-i");
    if (input["-A"] !== undefined) args.push("-A", String(input["-A"]));
    if (input["-B"] !== undefined) args.push("-B", String(input["-B"]));
    if (input["-C"] !== undefined) args.push("-C", String(input["-C"]));
    if (input.glob) args.push("--glob", input.glob);
    if (input.type) args.push("--type", input.type);
    if (input.multiline) args.push("-U", "--multiline-dotall");

    // Always ignore common dirs
    args.push("--glob", "!node_modules", "--glob", "!.git");

    args.push("--", input.pattern, searchPath);

    const result = await new Promise<string>((resolve) => {
      const child = execFile(
        "rg",
        args,
        {
          cwd: context.cwd,
          timeout: 30000,
          maxBuffer: 5 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            // rg returns exit code 1 for "no matches"
            if (error.code === 1) {
              resolve("No matches found.");
              return;
            }
            // rg not found — fallback message
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              resolve("Error: ripgrep (rg) not found. Install it with: brew install ripgrep");
              return;
            }
            resolve(`Error: ${stderr || error.message}`);
            return;
          }

          let output = stdout.trim();

          // Apply offset and head_limit
          if (input.offset || input.head_limit) {
            const lines = output.split("\n");
            const start = input.offset ?? 0;
            const end = input.head_limit ? start + input.head_limit : undefined;
            output = lines.slice(start, end).join("\n");
          }

          if (!output) {
            resolve("No matches found.");
            return;
          }

          resolve(output);
        }
      );

      // Wire abort signal to kill the rg process
      if (context.abortSignal) {
        const onAbort = () => {
          child.kill("SIGTERM");
        };
        context.abortSignal.addEventListener("abort", onAbort, { once: true });
      }
    });

    yield { type: "result", content: result };
  },
};
