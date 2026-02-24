import { spawn } from "child_process";
import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";
import { spawnBackgroundShell } from "./shell-registry.js";

const inputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  timeout: z
    .number()
    .optional()
    .describe("Timeout in milliseconds (max 600000, default 120000)"),
  description: z
    .string()
    .optional()
    .describe("Short description of what this command does"),
  run_in_background: z
    .boolean()
    .optional()
    .describe("Run in background and return shell ID immediately"),
});

/** Grace period before SIGKILL after SIGTERM (ms). */
const SIGKILL_GRACE_MS = 5000;

export const bashTool: Tool = {
  name: "Bash",
  description:
    "Execute a bash command. Use for git, npm, running scripts, and terminal operations.",
  inputSchema,
  maxResultSizeChars: 150000, // Allow full output for bash-analyzer to process
  isConcurrencySafe: () => false,
  isReadOnly: () => false,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);
    const timeout = Math.min(input.timeout ?? 120000, 600000);

    // Pre-check: if already aborted, don't spawn
    if (context.abortSignal?.aborted) {
      yield { type: "result", content: "Tool execution was aborted." };
      return;
    }

    // Background mode: spawn and return immediately
    if (input.run_in_background) {
      const entry = spawnBackgroundShell(input.command, context.cwd, timeout);
      yield {
        type: "result",
        content: `Background shell started.\ntask_id: ${entry.id}\ncommand: ${input.command}\nUse TaskOutput with task_id "${entry.id}" to read output.`,
      };
      return;
    }

    const result = await new Promise<string>((resolve) => {
      let stdout = "";
      let stderr = "";

      const child = spawn("/bin/bash", ["-c", input.command], {
        cwd: context.cwd,
        env: { ...process.env, TERM: "dumb" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Timeout handling
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, SIGKILL_GRACE_MS);
      }, timeout);
      timer.unref();

      child.on("close", () => {
        clearTimeout(timer);
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n" : "") + stderr;
        if (!output) output = "(no output)";
        resolve(output);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(err.message);
      });

      // Wire abort signal: SIGTERM immediately, SIGKILL after grace period
      if (context.abortSignal) {
        const onAbort = () => {
          child.kill("SIGTERM");
          const killTimer = setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, SIGKILL_GRACE_MS);
          killTimer.unref();
        };
        context.abortSignal.addEventListener("abort", onAbort, { once: true });
      }
    });

    yield { type: "result", content: result };
  },
};
