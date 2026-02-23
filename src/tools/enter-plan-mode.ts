/**
 * EnterPlanMode tool — signals that the agent is entering plan mode.
 *
 * In plan mode, only read-only tools are permitted. The agent explores
 * the codebase, designs an approach, then calls ExitPlanMode to present
 * the plan and request user approval to proceed with implementation.
 *
 * The REPL detects the [ENTER_PLAN_MODE] marker and dynamically switches
 * the permission callback to block non-read-only tools.
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({});

export const enterPlanModeTool: Tool = {
  name: "EnterPlanMode",
  description:
    "Enter plan mode to explore the codebase and design an implementation approach before writing code. In plan mode, only read-only tools (Read, Glob, Grep, WebFetch, WebSearch) are available. Use ExitPlanMode when your plan is ready for user review.",
  inputSchema,
  maxResultSizeChars: 10000,
  isConcurrencySafe: () => false,
  // EnterPlanMode is read-only — it's just a state signal, no permission prompt needed
  isReadOnly: () => true,

  async *call(_rawInput: unknown, _context: ToolContext) {
    yield {
      type: "result",
      content: "[ENTER_PLAN_MODE]\nPlan mode activated. You can now use read-only tools (Read, Glob, Grep, WebFetch, WebSearch) to explore the codebase. When your plan is ready, call ExitPlanMode to present it for user approval.\n[/ENTER_PLAN_MODE]",
    };
  },
};
