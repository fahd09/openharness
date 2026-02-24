/**
 * /rename and /tag commands — session organization.
 */

import chalk from "chalk";
import { renameSession, tagSession } from "../core/session.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const renameCommand: SlashCommand = {
  name: "rename",
  description: "Rename current session",
  category: "session",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const name = args.trim();
    if (!name) {
      output(chalk.dim("Usage: /rename <name>"));
      return true;
    }

    await renameSession(ctx.sessionId, name);
    output(chalk.dim(`Session renamed to: ${name}`));
    return true;
  },
};

export const tagCommand: SlashCommand = {
  name: "tag",
  description: "Add a tag to current session",
  category: "session",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const tag = args.trim();
    if (!tag) {
      output(chalk.dim("Usage: /tag <tag>"));
      return true;
    }

    await tagSession(ctx.sessionId, tag);
    output(chalk.dim(`Tag added: ${tag}`));
    return true;
  },
};
