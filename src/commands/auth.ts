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
  async execute(args: string, _ctx: CommandContext): Promise<boolean> {
    const provider = args.trim() || "anthropic";
    console.log(chalk.dim(`Authenticating with ${provider}...`));

    try {
      await login(provider);
      console.log(chalk.green(`Authenticated with ${provider}.`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`Authentication failed: ${msg}`));
    }

    return true;
  },
};

export const logoutCommand: SlashCommand = {
  name: "logout",
  description: "Remove saved authentication",
  category: "session",
  completions: ["anthropic", "openai"],
  async execute(args: string, _ctx: CommandContext): Promise<boolean> {
    const provider = args.trim() || "anthropic";

    try {
      await logout(provider);
      console.log(chalk.dim(`Logged out from ${provider}.`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`Logout failed: ${msg}`));
    }

    return true;
  },
};
