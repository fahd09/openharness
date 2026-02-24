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
    const output = ctx.output ?? console.log;
    const totalCost = ctx.costTracker.getTotalCost();
    const systemStr = systemPromptToString(ctx.systemPrompt);
    const contextUsed = estimateConversationTokens(ctx.messages, systemStr);
    const contextWindow = getContextWindow(ctx.model);
    const contextPct = ((contextUsed / contextWindow) * 100).toFixed(1);
    const filesSummary = ctx.fileTracker.getSummary();

    output(chalk.bold("\n  Session Status"));
    output(chalk.dim("  " + "─".repeat(40)));
    output(`  ${chalk.dim("Session:")}  ${ctx.sessionId}`);
    output(`  ${chalk.dim("Model:")}    ${ctx.model}`);
    output(`  ${chalk.dim("Provider:")} ${(process.env.LLM_PROVIDER || "anthropic").toLowerCase()}`);
    output(`  ${chalk.dim("Mode:")}     ${ctx.permissionMode}`);
    output(`  ${chalk.dim("CWD:")}      ${ctx.cwd}`);
    output(
      `  ${chalk.dim("Messages:")} ${ctx.messages.length}`
    );
    output(
      `  ${chalk.dim("Context:")}  ~${contextUsed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${contextPct}%)`
    );
    output(`  ${chalk.dim("Cost:")}     ${formatCost(totalCost)}`);

    if (filesSummary.filesChanged > 0) {
      output(
        `  ${chalk.dim("Files:")}    ${filesSummary.filesChanged} changed` +
          ` (${chalk.green(`+${filesSummary.totalAdded}`)} ${chalk.red(`-${filesSummary.totalRemoved}`)})`
      );
    }

    output("");
    return true;
  },
};
