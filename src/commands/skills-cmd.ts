/**
 * /skills command — list loaded skills.
 */

import chalk from "chalk";
import { listSkills } from "../core/skills.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const skillsCommand: SlashCommand = {
  name: "skills",
  description: "List loaded skills",
  category: "tools",
  async execute(_args: string, _ctx: CommandContext): Promise<boolean> {
    const loaded = listSkills();
    if (loaded.length === 0) {
      console.log(
        chalk.dim("No skills loaded. Add SKILL.md files to .claude-code-core/skills/")
      );
    } else {
      console.log(chalk.dim("\nLoaded skills:"));
      for (const s of loaded) {
        console.log(chalk.dim(`  ${s.command}  ${s.description}`));
      }
      console.log();
    }
    return true;
  },
};
