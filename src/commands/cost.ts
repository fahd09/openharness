/**
 * /cost command — show session cost breakdown.
 */

import chalk from "chalk";
import { formatCost } from "../core/cost.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const costCommand: SlashCommand = {
  name: "cost",
  description: "Show session cost breakdown",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const breakdown = ctx.costTracker.getModelBreakdown();
    const totalCost = ctx.costTracker.getTotalCost();

    if (breakdown.size === 0) {
      console.log(chalk.dim("No API usage yet this session."));
      return true;
    }

    console.log(chalk.bold("\n  Session Cost Breakdown"));
    console.log(chalk.dim("  " + "─".repeat(50)));

    for (const [model, usage] of breakdown) {
      const shortModel = model.length > 30 ? model.slice(0, 27) + "..." : model;
      console.log(
        `  ${chalk.cyan(shortModel)}`
      );
      console.log(
        chalk.dim(
          `    Input: ${usage.inputTokens.toLocaleString()} tokens` +
            (usage.cacheReadInputTokens
              ? ` (${usage.cacheReadInputTokens.toLocaleString()} cached)`
              : "")
        )
      );
      console.log(
        chalk.dim(`    Output: ${usage.outputTokens.toLocaleString()} tokens`)
      );
      console.log(chalk.dim(`    Cost: ${formatCost(usage.costUsd)}`));
    }

    console.log(chalk.dim("  " + "─".repeat(50)));
    console.log(chalk.bold(`  Total: ${formatCost(totalCost)}`));

    if (ctx.costTracker.hasUnknownModelCost()) {
      console.log(
        chalk.yellow("  ⚠ Costs may be approximate for non-standard models")
      );
    }
    console.log();

    return true;
  },
};
