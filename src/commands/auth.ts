/**
 * /login and /logout commands — authentication management.
 */

import chalk from "chalk";
import { login, logout, getAuthStatus } from "../core/auth.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const loginCommand: SlashCommand = {
  name: "login",
  description: "Authenticate with a provider",
  category: "session",
  completions: ["anthropic", "openai"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const provider = args.trim() || "anthropic";
    output(chalk.dim(`Authenticating with ${provider}...`));

    try {
      await login(provider);
      output(chalk.green(`Authenticated with ${provider}.`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output(chalk.red(`Authentication failed: ${msg}`));
    }

    return true;
  },
};

export const logoutCommand: SlashCommand = {
  name: "logout",
  description: "Remove saved authentication",
  category: "session",
  completions: ["anthropic", "openai"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const provider = args.trim() || "anthropic";

    try {
      await logout(provider);
      output(chalk.dim(`Logged out from ${provider}.`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output(chalk.red(`Logout failed: ${msg}`));
    }

    return true;
  },
};
