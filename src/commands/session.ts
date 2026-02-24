/**
 * Session commands — /exit, /quit, /clear, /sessions
 */

import chalk from "chalk";
import { saveSession } from "../core/session.js";
import { executeHooks } from "../core/hooks.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const exitCommand: SlashCommand = {
  name: "exit",
  description: "Save session and exit",
  category: "session",
  aliases: ["quit"],
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    await saveSession(ctx.sessionId, ctx.messages, ctx.model, ctx.cwd);
    await executeHooks({ event: "SessionEnd", sessionId: ctx.sessionId, cwd: ctx.cwd });
    output(chalk.dim(`Session saved: ${ctx.sessionId}`));
    process.exit(0);
  },
};

export const clearCommand: SlashCommand = {
  name: "clear",
  description: "Clear conversation history",
  category: "session",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    ctx.messages.length = 0;
    output(chalk.dim("Conversation cleared."));
    return true;
  },
};

