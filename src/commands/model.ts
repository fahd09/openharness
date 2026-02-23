/**
 * /model command — view or change the active model.
 *
 * Usage:
 *   /model           — Show current model and available models
 *   /model <name>    — Switch to a named model (aliases supported)
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";

/**
 * Resolve a model alias to full model ID.
 * Replicates the logic from index.ts resolveModel().
 */
function resolveModel(input: string): string {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

  const anthropicAliases: Record<string, string> = {
    opus: "claude-opus-4-20250514",
    sonnet: "claude-sonnet-4-20250514",
    haiku: "claude-haiku-4-5-20251001",
  };

  const openaiAliases: Record<string, string> = {
    "4o": "gpt-4o",
    "4o-mini": "gpt-4o-mini",
    "4-turbo": "gpt-4-turbo",
  };

  if (
    provider === "openai" ||
    provider === "openai-compat" ||
    provider === "openai_compat"
  ) {
    return openaiAliases[input] ?? input;
  }

  return anthropicAliases[input] ?? input;
}

/** Available models per provider for the interactive menu. */
const AVAILABLE_MODELS: Record<string, Array<{ alias: string; id: string; description: string }>> = {
  anthropic: [
    { alias: "opus", id: "claude-opus-4-20250514", description: "Most capable, complex tasks" },
    { alias: "sonnet", id: "claude-sonnet-4-20250514", description: "Balanced speed and capability" },
    { alias: "haiku", id: "claude-haiku-4-5-20251001", description: "Fastest, lightweight tasks" },
  ],
  openai: [
    { alias: "4o", id: "gpt-4o", description: "Most capable GPT model" },
    { alias: "4o-mini", id: "gpt-4o-mini", description: "Fast and affordable" },
    { alias: "4-turbo", id: "gpt-4-turbo", description: "GPT-4 Turbo" },
  ],
};

export const modelCommand: SlashCommand = {
  name: "model",
  description: "View or change model (e.g., /model sonnet)",
  category: "model",
  aliases: ["m"],
  completions: ["opus", "sonnet", "haiku", "4o", "4o-mini", "4-turbo"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    if (!args) {
      // Interactive model menu
      const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
      const normalizedProvider = provider === "openai-compat" || provider === "openai_compat"
        ? "openai"
        : provider;
      const models = AVAILABLE_MODELS[normalizedProvider] ?? AVAILABLE_MODELS["anthropic"];

      console.log(chalk.bold("\n  Available Models"));
      console.log(chalk.dim("  " + "─".repeat(40)));
      for (const model of models) {
        const current = ctx.model === model.id ? chalk.green(" ●") : "  ";
        console.log(
          `${current} ${chalk.bold(model.alias.padEnd(10))} ${chalk.dim(model.description)}`
        );
        console.log(chalk.dim(`     ${model.id}`));
      }
      console.log();
      console.log(
        chalk.dim("  Usage: /model <name>  (e.g., /model opus)")
      );
      console.log(chalk.dim("  Or use a full model ID: /model claude-opus-4-20250514"));
      console.log();
      return true;
    }

    const newModel = resolveModel(args.trim());

    // Validate — check if the model is a known alias
    const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
    const normalizedProvider = provider === "openai-compat" || provider === "openai_compat"
      ? "openai"
      : provider;
    const models = AVAILABLE_MODELS[normalizedProvider] ?? AVAILABLE_MODELS["anthropic"];
    const isKnown = models.some((m) => m.id === newModel || m.alias === args.trim());

    ctx.setModel(newModel);

    if (isKnown) {
      console.log(chalk.dim(`Model changed to: ${newModel}`));
    } else {
      // Model not in our known list — warn but allow (could be a custom model)
      console.log(chalk.dim(`Model changed to: ${newModel}`));
      console.log(chalk.yellow("  Note: This model is not in the known models list. It may not be available."));
    }
    return true;
  },
};
