/**
 * /status command — show current session status.
 */

import chalk from "chalk";
import { formatCost } from "../core/cost.js";
import { estimateConversationTokens } from "../core/context.js";
import { getContextWindow } from "../core/context.js";
import { systemPromptToString } from "../prompt/system-prompt.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const statusCommand: SlashCommand = {
  name: "status",
  description: "Show session status (model, cost, context usage)",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const totalCost = ctx.costTracker.getTotalCost();
    const systemStr = systemPromptToString(ctx.systemPrompt);
    const contextUsed = estimateConversationTokens(ctx.messages, systemStr);
    const contextWindow = getContextWindow(ctx.model);
    const contextPct = ((contextUsed / contextWindow) * 100).toFixed(1);
    const filesSummary = ctx.fileTracker.getSummary();

    console.log(chalk.bold("\n  Session Status"));
    console.log(chalk.dim("  " + "─".repeat(40)));
    console.log(`  ${chalk.dim("Session:")}  ${ctx.sessionId}`);
    console.log(`  ${chalk.dim("Model:")}    ${ctx.model}`);
    console.log(`  ${chalk.dim("Provider:")} ${(process.env.LLM_PROVIDER || "anthropic").toLowerCase()}`);
    console.log(`  ${chalk.dim("Mode:")}     ${ctx.permissionMode}`);
    console.log(`  ${chalk.dim("CWD:")}      ${ctx.cwd}`);
    console.log(
      `  ${chalk.dim("Messages:")} ${ctx.messages.length}`
    );
    console.log(
      `  ${chalk.dim("Context:")}  ~${contextUsed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${contextPct}%)`
    );
    console.log(`  ${chalk.dim("Cost:")}     ${formatCost(totalCost)}`);

    if (filesSummary.filesChanged > 0) {
      console.log(
        `  ${chalk.dim("Files:")}    ${filesSummary.filesChanged} changed` +
          ` (${chalk.green(`+${filesSummary.totalAdded}`)} ${chalk.red(`-${filesSummary.totalRemoved}`)})`
      );
    }

    console.log();
    return true;
  },
};
