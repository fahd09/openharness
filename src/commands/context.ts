/**
 * /context command — visualize context window usage.
 */

import chalk from "chalk";
import { estimateConversationTokens, getContextWindow } from "../core/context.js";
import { systemPromptToString } from "../prompt/system-prompt.js";
import { estimateTokens } from "../utils.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const contextCommand: SlashCommand = {
  name: "context",
  description: "Show context window usage",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const systemStr = systemPromptToString(ctx.systemPrompt);
    const totalTokens = estimateConversationTokens(ctx.messages, systemStr);
    const maxTokens = getContextWindow(ctx.model);
    const pct = Math.min(100, (totalTokens / maxTokens) * 100);

    // Visual bar
    const barWidth = 30;
    const filled = Math.round((pct / 100) * barWidth);
    const empty = barWidth - filled;
    const barColor = pct > 80 ? chalk.red : pct > 60 ? chalk.yellow : chalk.green;
    const bar = barColor("█".repeat(filled)) + chalk.dim("░".repeat(empty));

    output(chalk.bold("\n  Context Window"));
    output(chalk.dim("  " + "─".repeat(50)));
    output(`  [${bar}] ${pct.toFixed(1)}%`);
    output(`  ${chalk.dim("Used:")} ~${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`);

    // Message breakdown
    let userMessages = 0;
    let assistantMessages = 0;
    let toolUseBlocks = 0;
    let toolResultBlocks = 0;
    let userTokens = 0;
    let assistantTokens = 0;

    for (const msg of ctx.messages) {
      if (msg.type === "user") {
        userMessages++;
        if (typeof msg.content === "string") {
          userTokens += estimateTokens(msg.content);
        } else {
          for (const block of msg.content) {
            if (typeof block.content === "string") {
              userTokens += estimateTokens(block.content);
              if ("type" in block && block.type === "tool_result") toolResultBlocks++;
            }
          }
        }
      } else {
        assistantMessages++;
        for (const block of msg.content) {
          if (block.type === "text") {
            assistantTokens += estimateTokens(block.text);
          } else if (block.type === "tool_use") {
            toolUseBlocks++;
            assistantTokens += estimateTokens(JSON.stringify(block.input));
          }
        }
      }
    }

    const systemTokens = estimateTokens(systemStr);

    output("");
    output(chalk.bold("  Breakdown"));
    output(`  ${chalk.dim("System prompt:")}  ~${systemTokens.toLocaleString()} tokens`);
    output(`  ${chalk.dim("User messages:")}  ${userMessages} (~${userTokens.toLocaleString()} tokens)`);
    output(`  ${chalk.dim("Assistant msgs:")} ${assistantMessages} (~${assistantTokens.toLocaleString()} tokens)`);
    output(`  ${chalk.dim("Tool calls:")}     ${toolUseBlocks}`);
    output(`  ${chalk.dim("Tool results:")}   ${toolResultBlocks}`);

    // System prompt segment breakdown
    if (ctx.promptSegmentDetails.length > 0) {
      output("");
      output(chalk.bold("  System Prompt Segments"));
      for (const seg of ctx.promptSegmentDetails) {
        const segTokens = Math.round(seg.charCount / 4); // rough estimate
        const posLabel =
          seg.position === "static" ? chalk.blue("static") :
          seg.position === "dynamic" ? chalk.yellow("dynamic") :
          chalk.red("volatile");
        output(`  ${chalk.dim("•")} ${seg.id} ${posLabel} ~${segTokens.toLocaleString()} tokens`);
      }
    }

    // Cache stats
    const breakdown = ctx.costTracker.getModelBreakdown();
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    for (const usage of breakdown.values()) {
      totalCacheRead += usage.cacheReadInputTokens;
      totalCacheWrite += usage.cacheCreationInputTokens;
    }
    if (totalCacheRead > 0 || totalCacheWrite > 0) {
      output("");
      output(chalk.bold("  Cache"));
      output(`  ${chalk.dim("Cache reads:")}  ${totalCacheRead.toLocaleString()} tokens`);
      output(`  ${chalk.dim("Cache writes:")} ${totalCacheWrite.toLocaleString()} tokens`);
    }

    output("");
    return true;
  },
};
