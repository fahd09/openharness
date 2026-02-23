/**
 * /plan command — enter plan mode with optional description.
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const planCommand: SlashCommand = {
  name: "plan",
  description: "Enter plan mode (read-only exploration)",
  category: "tools",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const description = args.trim();
    const prompt = description
      ? `Please analyze and create a plan for the following task. Use read-only tools to explore the codebase and understand the current state before proposing changes.\n\nTask: ${description}`
      : "Please enter plan mode. Explore the codebase using read-only tools and help me understand the current state before we make any changes.";

    console.log(chalk.magenta("📋 Starting plan mode..."));
    await ctx.runPrompt(prompt);
    return true;
  },
};
