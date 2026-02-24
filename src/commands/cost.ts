/**
 * /cost command — show session cost breakdown with token source analysis.
 */

import chalk from "chalk";
import { formatCost } from "../core/cost.js";
import { estimateTokens } from "../utils.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const costCommand: SlashCommand = {
  name: "cost",
  description: "Show session cost breakdown",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const breakdown = ctx.costTracker.getModelBreakdown();
    const totalCost = ctx.costTracker.getTotalCost();

    if (breakdown.size === 0) {
      output(chalk.dim("No API usage yet this session."));
      return true;
    }

    output(chalk.bold("\n  Session Cost Breakdown"));
    output(chalk.dim("  " + "─".repeat(50)));

    for (const [model, usage] of breakdown) {
      const shortModel = model.length > 30 ? model.slice(0, 27) + "..." : model;
      output(
        `  ${chalk.cyan(shortModel)}`
      );
      output(
        chalk.dim(
          `    Input: ${usage.inputTokens.toLocaleString()} tokens` +
            (usage.cacheReadInputTokens
              ? ` (${usage.cacheReadInputTokens.toLocaleString()} cached)`
              : "")
        )
      );
      if (usage.cacheCreationInputTokens > 0) {
        output(
          chalk.dim(`    Cache write: ${usage.cacheCreationInputTokens.toLocaleString()} tokens`)
        );
      }
      output(
        chalk.dim(`    Output: ${usage.outputTokens.toLocaleString()} tokens`)
      );
      output(chalk.dim(`    Cost: ${formatCost(usage.costUsd)}`));
    }

    output(chalk.dim("  " + "─".repeat(50)));
    output(chalk.bold(`  Total: ${formatCost(totalCost)}`));

    if (ctx.costTracker.hasUnknownModelCost()) {
      output(
        chalk.yellow("  Warning: costs may be approximate for non-standard models")
      );
    }

    // ── Prompt Token Breakdown ────────────────────────────────────
    // Show where input tokens come from (system prompt vs conversation)

    output("");
    output(chalk.bold("  Input Token Sources (estimated)"));
    output(chalk.dim("  " + "─".repeat(50)));

    // Use per-plugin segment details if available, otherwise fall back to cache groups
    const details = ctx.promptSegmentDetails;
    let totalSystemTokens = 0;
    const segmentSizes: Array<{ label: string; tokens: number }> = [];

    if (details.length > 0) {
      for (const detail of details) {
        const tokens = Math.round(detail.charCount / 4);
        totalSystemTokens += tokens;
        const label = detail.id.length > 20 ? detail.id.slice(0, 18) + ".." : detail.id;
        segmentSizes.push({ label, tokens });
      }
    } else {
      // Fallback: show cache groups
      for (const seg of ctx.systemPrompt) {
        const tokens = estimateTokens(seg.text);
        totalSystemTokens += tokens;
        const label = extractSegmentLabel(seg.text);
        segmentSizes.push({ label, tokens });
      }
    }

    // System prompt segments
    for (const { label, tokens } of segmentSizes) {
      const pct = totalSystemTokens > 0 ? Math.round((tokens / totalSystemTokens) * 100) : 0;
      const bar = makeBar(pct);
      output(
        `  ${chalk.dim(label.padEnd(22))} ${chalk.cyan(tokens.toLocaleString().padStart(6))} ${chalk.dim("tok")} ${bar} ${chalk.dim(`${pct}%`)}`
      );
    }

    output(chalk.dim("  " + "·".repeat(50)));
    output(
      `  ${chalk.dim("System prompt total".padEnd(22))} ${chalk.cyan(totalSystemTokens.toLocaleString().padStart(6))} ${chalk.dim("tok")}`
    );

    // Conversation messages estimate
    let conversationTokens = 0;
    for (const msg of ctx.messages) {
      if (msg.type === "user") {
        if (typeof msg.content === "string") {
          conversationTokens += estimateTokens(msg.content);
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block.content === "string") {
              conversationTokens += estimateTokens(block.content);
            }
          }
        }
      } else {
        for (const block of msg.content) {
          if (block.type === "text") {
            conversationTokens += estimateTokens(block.text);
          } else if (block.type === "tool_use") {
            conversationTokens += estimateTokens(JSON.stringify(block.input));
          }
        }
      }
    }

    output(
      `  ${chalk.dim("Conversation".padEnd(22))} ${chalk.cyan(conversationTokens.toLocaleString().padStart(6))} ${chalk.dim("tok")} ${chalk.dim(`(${ctx.messages.length} messages)`)}`
    );

    output(chalk.dim("  " + "─".repeat(50)));
    output(
      `  ${chalk.dim("Est. total per turn".padEnd(22))} ${chalk.cyan((totalSystemTokens + conversationTokens).toLocaleString().padStart(6))} ${chalk.dim("tok")}`
    );

    output(chalk.dim("\n  Note: estimates use ~4 chars/token. Actual API counts may differ."));
    output("");

    return true;
  },
};

/**
 * Extract a short label from a system prompt segment by looking for
 * the first markdown heading or first line of content.
 */
function extractSegmentLabel(text: string): string {
  const lines = text.split("\n");
  for (const line of lines) {
    const heading = line.match(/^#+\s+(.+)/);
    if (heading) {
      const h = heading[1].trim();
      return h.length > 20 ? h.slice(0, 18) + ".." : h;
    }
  }
  // Fallback: first non-empty line, truncated
  const first = lines.find((l) => l.trim().length > 0) ?? "segment";
  return first.trim().slice(0, 20);
}

/**
 * Render a tiny bar chart (max 10 chars) for a percentage.
 */
function makeBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return chalk.cyan("█".repeat(filled)) + chalk.dim("░".repeat(10 - filled));
}
