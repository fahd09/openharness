/**
 * /compact command — manually trigger conversation compaction.
 *
 * Usage:
 *   /compact                    — Compact with default settings
 *   /compact <instructions>     — Compact with custom preservation instructions
 */

import chalk from "chalk";
import type Anthropic from "@anthropic-ai/sdk";
import { compactConversation, estimateApiTokens } from "../core/context.js";
import { messagesToApi } from "../core/agent-loop.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const compactCommand: SlashCommand = {
  name: "compact",
  description: "Manually compact conversation context (/compact [instructions])",
  category: "session",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    if (ctx.messages.length < 4) {
      output(chalk.dim("Not enough messages to compact."));
      return true;
    }

    const apiMessages = messagesToApi(ctx.messages);
    const preTokens = estimateApiTokens(apiMessages, ctx.systemPrompt);

    const preserveInstructions = args.trim() || undefined;
    if (preserveInstructions) {
      output(chalk.dim(`Compacting with custom instructions: "${preserveInstructions}"`));
    }

    output(chalk.dim(`Compacting ${ctx.messages.length} messages (${preTokens} est. tokens)...`));

    const result = await compactConversation(
      apiMessages,
      ctx.systemPrompt,
      ctx.model,
      preserveInstructions
    );

    // Rebuild conversation messages from compacted API messages
    // Keep the compacted summary as a simple user/assistant exchange
    // then preserve the last few original messages
    const keepCount = Math.min(4, ctx.messages.length);
    const keptMessages = ctx.messages.slice(ctx.messages.length - keepCount);
    ctx.messages.length = 0;

    // Add a synthetic summary message
    ctx.messages.push({
      type: "user",
      role: "user",
      content: "[Conversation manually compacted]",
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    ctx.messages.push({
      type: "assistant",
      role: "assistant",
      content: [{ type: "text", text: "Understood. I have the context from the compacted summary.", citations: [] } as import("../core/types.js").ApiContentBlock],
      model: ctx.model,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });

    // Re-add the kept messages
    for (const msg of keptMessages) {
      ctx.messages.push(msg);
    }

    output(
      chalk.magenta(
        `⟳ Compacted: ${result.preTokens} → ${result.postTokens} tokens`
      )
    );

    return true;
  },
};
