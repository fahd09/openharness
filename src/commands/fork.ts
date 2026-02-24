/**
 * /fork command — clone conversation to a new session.
 */

import chalk from "chalk";
import { newSessionId, saveSession, renameSession } from "../core/session.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import type { ConversationMessage } from "../core/types.js";

function deepCloneMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return JSON.parse(JSON.stringify(messages));
}

export const forkCommand: SlashCommand = {
  name: "fork",
  description: "Fork conversation into a new session",
  category: "session",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const oldId = ctx.sessionId;
    const newId = newSessionId();

    // Deep clone messages
    const clonedMessages = deepCloneMessages(ctx.messages);

    // Save the new session
    await saveSession(newId, clonedMessages, ctx.model, ctx.cwd);

    // Apply custom title if provided
    if (args.trim()) {
      await renameSession(newId, args.trim());
    }

    // Replace messages in-place so the current session uses the clone
    ctx.messages.length = 0;
    for (const msg of clonedMessages) {
      ctx.messages.push(msg);
    }

    // Switch to the new session
    if (ctx.setSessionId) {
      ctx.setSessionId(newId);
    }

    // Show divider
    if (ctx.dispatch) {
      ctx.dispatch({
        type: "FREEZE_BLOCK",
        block: {
          id: `fork-${Date.now()}`,
          text: chalk.dim(`\n${"─".repeat(50)}\n`) +
            chalk.cyan(`  Forked from ${oldId} → ${newId}`) +
            (args.trim() ? chalk.dim(` "${args.trim()}"`) : "") +
            chalk.dim(`\n${"─".repeat(50)}`),
          type: "system",
        },
      });
    } else {
      output(chalk.cyan(`Forked session ${oldId} → ${newId}`));
    }

    return true;
  },
};
