/**
 * /fast command — Toggle fast mode (switches to a faster model variant).
 *
 * In Anthropic: switches between opus/sonnet and haiku.
 * In OpenAI: switches between gpt-4o and gpt-4o-mini.
 * The original model is remembered so /fast can toggle back.
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";

// Store the original model to toggle back
let originalModel: string | null = null;
let fastModeActive = false;

const FAST_MODELS: Record<string, string> = {
  // Anthropic: any non-haiku model → haiku
  "claude-opus-4-20250514": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-20250514": "claude-haiku-4-5-20251001",
  // OpenAI: full model → mini
  "gpt-4o": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4o-mini",
};

export function isFastMode(): boolean {
  return fastModeActive;
}

export const fastCommand: SlashCommand = {
  name: "fast",
  description: "Toggle fast mode (switches to faster model)",
  category: "model",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    if (fastModeActive && originalModel) {
      // Toggle off: restore original model
      ctx.setModel(originalModel);
      console.log(chalk.dim(`Fast mode off. Restored model: ${originalModel}`));
      fastModeActive = false;
      originalModel = null;
    } else {
      // Toggle on: switch to fast model
      const fastModel = FAST_MODELS[ctx.model];
      if (!fastModel) {
        // Already on a fast model or unknown model
        console.log(chalk.dim(`Current model (${ctx.model}) has no faster variant.`));
        return true;
      }
      originalModel = ctx.model;
      ctx.setModel(fastModel);
      fastModeActive = true;
      console.log(chalk.dim(`Fast mode on. Model: ${ctx.model} → ${fastModel}`));
    }
    return true;
  },
};
