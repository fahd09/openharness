/**
 * ExitPlanMode tool — signals that the agent has finished planning
 * and is ready for user approval to proceed with implementation.
 *
 * In plan mode, the agent can only use read-only tools. Once the
 * plan is complete, it calls ExitPlanMode to:
 * 1. Write the plan to .claude-code-core/plan.md
 * 2. Signal the REPL to prompt the user for approval
 * 3. If approved, the REPL switches to default permission mode
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const PLAN_FILENAME = "plan.md";

const inputSchema = z.object({
  plan_summary: z
    .string()
    .optional()
    .describe("Optional summary of the plan for the user to review"),
});

export const exitPlanModeTool: Tool = {
  name: "ExitPlanMode",
  description:
    "Signal that planning is complete and request user approval to proceed with implementation. Use this when you have finished designing your approach and are ready for the user to review.",
  inputSchema,
  maxResultSizeChars: 10000,
  isConcurrencySafe: () => false,
  // ExitPlanMode is NOT read-only — it's a state transition that needs approval
  isReadOnly: () => false,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);

    // Write plan to file
    if (input.plan_summary) {
      try {
        const planDir = join(context.cwd, ".claude-code-core");
        await mkdir(planDir, { recursive: true });
        const planPath = join(planDir, PLAN_FILENAME);
        await writeFile(planPath, input.plan_summary, "utf-8");
      } catch {
        // Non-fatal — plan display still works without file
      }
    }

    const parts: string[] = ["[EXIT_PLAN_MODE]"];
    if (input.plan_summary) {
      parts.push(input.plan_summary);
    }
    parts.push("[/EXIT_PLAN_MODE]");

    yield { type: "result", content: parts.join("\n") };
  },
};
