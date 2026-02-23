/**
 * Session commands — /exit, /quit, /clear, /sessions
 */

import chalk from "chalk";
import {
  saveSession,
  listSessions,
  searchSessions,
} from "../core/session.js";
import { executeHooks } from "../core/hooks.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const exitCommand: SlashCommand = {
  name: "exit",
  description: "Save session and exit",
  category: "session",
  aliases: ["quit"],
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    await saveSession(ctx.sessionId, ctx.messages, ctx.model, ctx.cwd);
    await executeHooks({ event: "SessionEnd", sessionId: ctx.sessionId, cwd: ctx.cwd });
    console.log(chalk.dim(`Session saved: ${ctx.sessionId}`));
    process.exit(0);
  },
};

export const clearCommand: SlashCommand = {
  name: "clear",
  description: "Clear conversation history",
  category: "session",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    ctx.messages.length = 0;
    console.log(chalk.dim("Conversation cleared."));
    return true;
  },
};

export const sessionsCommand: SlashCommand = {
  name: "sessions",
  description: "List or search saved sessions (/sessions [query])",
  category: "session",
  aliases: ["history"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const sessions = args
      ? await searchSessions(args, ctx.cwd)
      : await listSessions(ctx.cwd);

    if (sessions.length === 0) {
      if (args) {
        console.log(chalk.dim(`No sessions matching "${args}".`));
      } else {
        console.log(chalk.dim("No saved sessions."));
      }
    } else {
      const label = args ? `Sessions matching "${args}"` : "Saved sessions";
      console.log(chalk.dim(`\n${label}:`));
      for (const s of sessions.slice(0, 20)) {
        const title = s.customTitle ?? s.title;
        const tags = s.tags && s.tags.length > 0
          ? chalk.cyan(` [${s.tags.join(", ")}]`)
          : "";
        const sourceTag = s.source === "claude-code" ? chalk.magenta("[cc] ") : "";
        console.log(
          chalk.dim("  ") + sourceTag + chalk.dim(
            `${s.id}  ${s.updatedAt.slice(0, 16)}  ${s.messageCount} msgs  ${title}`
          ) + tags
        );
      }
      if (sessions.length > 20) {
        console.log(chalk.dim(`  ... and ${sessions.length - 20} more`));
      }
      console.log();
    }
    return true;
  },
};
