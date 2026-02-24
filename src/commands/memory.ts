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
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const memDir = getMemoryDir();

    if (args === "topics") {
      const files = await listMemoryFiles();
      if (files.length === 0) {
        output(chalk.dim("No memory files found."));
      } else {
        output(chalk.bold("\n  Memory Files"));
        output(chalk.dim("  " + "─".repeat(40)));
        for (const file of files) {
          const icon = file === "MEMORY" ? chalk.green("●") : chalk.dim("○");
          output(`  ${icon} ${chalk.dim(file + ".md")}`);
        }
      }
      output(chalk.dim(`\n  Directory: ${memDir}`));
      output();
      return true;
    }

    if (args === "compact") {
      const compacted = await compactMemory();
      if (compacted) {
        output(chalk.green("Memory compacted successfully."));
      } else {
        output(chalk.dim("Memory is already within limits (< 200 lines)."));
      }
      return true;
    }

    if (args && args !== "topics" && args !== "compact") {
      // Show specific topic file
      const content = await loadTopicMemory(args);
      if (!content) {
        output(chalk.dim(`No memory file found for topic "${args}".`));
        output(chalk.dim("Use /memory topics to list available files."));
      } else {
        output(chalk.bold(`\n  ${args}.md`));
        output(chalk.dim("  " + "─".repeat(40)));
        const lines = content.split("\n");
        for (const line of lines.slice(0, 30)) {
          output(chalk.dim(`  ${line}`));
        }
        if (lines.length > 30) {
          output(chalk.dim(`  ... (${lines.length - 30} more lines)`));
        }
      }
      output();
      return true;
    }

    // Default: show MEMORY.md
    const memory = await loadMemory();

    if (!memory) {
      output(chalk.dim("No memory saved yet."));
      output(chalk.dim(`Memory directory: ${memDir}`));
      output(
        chalk.dim("Ask me to remember something and I'll save it to MEMORY.md.")
      );
    } else {
      output(chalk.bold("\n  MEMORY.md"));
      output(chalk.dim("  " + "─".repeat(40)));
      const lines = memory.split("\n");
      const display = lines.slice(0, 20);
      for (const line of display) {
        output(chalk.dim(`  ${line}`));
      }
      if (lines.length > 20) {
        output(chalk.dim(`  ... (${lines.length - 20} more lines)`));
      }
      output(chalk.dim(`\n  Path: ${memDir}/MEMORY.md`));
    }
    output();
    return true;
  },
};
