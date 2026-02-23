/**
 * /thinking command — Toggle extended thinking display on/off.
 *
 * Controls whether thinking deltas from the model are displayed
 * in the terminal. Does not affect whether thinking is actually
 * enabled (that's controlled by --thinking-budget or env var).
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";

/**
 * Module-level state for thinking display toggle.
 * Exported so index.ts can check it during streaming.
 */
let thinkingDisplayEnabled = true;

export function isThinkingDisplayEnabled(): boolean {
  return thinkingDisplayEnabled;
}

export function setThinkingDisplayEnabled(enabled: boolean): void {
  thinkingDisplayEnabled = enabled;
}

export const thinkingCommand: SlashCommand = {
  name: "thinking",
  description: "Toggle extended thinking display on/off",
  category: "model",
  completions: ["on", "off"],
  async execute(args: string, _ctx: CommandContext): Promise<boolean> {
    if (args === "on") {
      thinkingDisplayEnabled = true;
    } else if (args === "off") {
      thinkingDisplayEnabled = false;
    } else {
      // Toggle
      thinkingDisplayEnabled = !thinkingDisplayEnabled;
    }

    const status = thinkingDisplayEnabled ? "on" : "off";
    console.log(chalk.dim(`Thinking display: ${status}`));
    if (!thinkingDisplayEnabled) {
      console.log(chalk.dim("  Thinking still runs, but output is hidden. Use /thinking to re-enable."));
    }
    return true;
  },
};
