/**
 * /memory command — view and manage persistent memory.
 *
 * Usage:
 *   /memory           — Show MEMORY.md contents
 *   /memory topics    — List all topic memory files
 *   /memory <topic>   — Show a specific topic file
 *   /memory compact   — Compact memory if too large
 */

import chalk from "chalk";
import { loadMemory, getMemoryDir, loadTopicMemory, listMemoryFiles, compactMemory } from "../core/memory.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const memoryCommand: SlashCommand = {
  name: "memory",
  description: "View persistent memory (/memory [topics|compact|<topic>])",
  category: "info",
  completions: ["topics", "compact"],
  async execute(args: string, _ctx: CommandContext): Promise<boolean> {
    const memDir = getMemoryDir();

    if (args === "topics") {
      const files = await listMemoryFiles();
      if (files.length === 0) {
        console.log(chalk.dim("No memory files found."));
      } else {
        console.log(chalk.bold("\n  Memory Files"));
        console.log(chalk.dim("  " + "─".repeat(40)));
        for (const file of files) {
          const icon = file === "MEMORY" ? chalk.green("●") : chalk.dim("○");
          console.log(`  ${icon} ${chalk.dim(file + ".md")}`);
        }
      }
      console.log(chalk.dim(`\n  Directory: ${memDir}`));
      console.log();
      return true;
    }

    if (args === "compact") {
      const compacted = await compactMemory();
      if (compacted) {
        console.log(chalk.green("Memory compacted successfully."));
      } else {
        console.log(chalk.dim("Memory is already within limits (< 200 lines)."));
      }
      return true;
    }

    if (args && args !== "topics" && args !== "compact") {
      // Show specific topic file
      const content = await loadTopicMemory(args);
      if (!content) {
        console.log(chalk.dim(`No memory file found for topic "${args}".`));
        console.log(chalk.dim("Use /memory topics to list available files."));
      } else {
        console.log(chalk.bold(`\n  ${args}.md`));
        console.log(chalk.dim("  " + "─".repeat(40)));
        const lines = content.split("\n");
        for (const line of lines.slice(0, 30)) {
          console.log(chalk.dim(`  ${line}`));
        }
        if (lines.length > 30) {
          console.log(chalk.dim(`  ... (${lines.length - 30} more lines)`));
        }
      }
      console.log();
      return true;
    }

    // Default: show MEMORY.md
    const memory = await loadMemory();

    if (!memory) {
      console.log(chalk.dim("No memory saved yet."));
      console.log(chalk.dim(`Memory directory: ${memDir}`));
      console.log(
        chalk.dim("Ask me to remember something and I'll save it to MEMORY.md.")
      );
    } else {
      console.log(chalk.bold("\n  MEMORY.md"));
      console.log(chalk.dim("  " + "─".repeat(40)));
      const lines = memory.split("\n");
      const display = lines.slice(0, 20);
      for (const line of display) {
        console.log(chalk.dim(`  ${line}`));
      }
      if (lines.length > 20) {
        console.log(chalk.dim(`  ... (${lines.length - 20} more lines)`));
      }
      console.log(chalk.dim(`\n  Path: ${memDir}/MEMORY.md`));
    }
    console.log();
    return true;
  },
};
