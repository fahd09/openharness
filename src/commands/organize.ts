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
    const name = args.trim();
    if (!name) {
      console.log(chalk.dim("Usage: /rename <name>"));
      return true;
    }

    await renameSession(ctx.sessionId, name);
    console.log(chalk.dim(`Session renamed to: ${name}`));
    return true;
  },
};

export const tagCommand: SlashCommand = {
  name: "tag",
  description: "Add a tag to current session",
  category: "session",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const tag = args.trim();
    if (!tag) {
      console.log(chalk.dim("Usage: /tag <tag>"));
      return true;
    }

    await tagSession(ctx.sessionId, tag);
    console.log(chalk.dim(`Tag added: ${tag}`));
    return true;
  },
};
