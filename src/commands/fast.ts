/**
 * /fast command — Toggle fast mode (switches to a faster model variant).
 *
 * In Anthropic: switches between opus/sonnet and haiku.
 * In OpenAI: switches between gpt-4o and gpt-4o-mini.
 * The original model is remembered so /fast can toggle back.
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import { FAST_MODELS } from "../core/models.js";

// Store the original model to toggle back
let originalModel: string | null = null;
let fastModeActive = false;

export function isFastMode(): boolean {
  return fastModeActive;
}

export const fastCommand: SlashCommand = {
  name: "fast",
  description: "Toggle fast mode (switches to faster model)",
  category: "model",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    if (fastModeActive && originalModel) {
      // Toggle off: restore original model
      ctx.setModel(originalModel);
      output(chalk.dim(`Fast mode off. Restored model: ${originalModel}`));
      fastModeActive = false;
      originalModel = null;
    } else {
      // Toggle on: switch to fast model
      const fastModel = FAST_MODELS[ctx.model];
      if (!fastModel) {
        // Already on a fast model or unknown model
        output(chalk.dim(`Current model (${ctx.model}) has no faster variant.`));
        return true;
      }
      originalModel = ctx.model;
      ctx.setModel(fastModel);
      fastModeActive = true;
      output(chalk.dim(`Fast mode on. Model: ${ctx.model} → ${fastModel}`));
    }
    return true;
  },
};
