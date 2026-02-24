/**
 * /undo command — revert the last file edit.
 */

import chalk from "chalk";
import { writeFile } from "fs/promises";
import { getFileHistory } from "../core/file-history.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const undoCommand: SlashCommand = {
  name: "undo",
  description: "Revert the last file edit",
  category: "tools",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const history = getFileHistory();
    const targetPath = args.trim() || undefined;

    const snapshot = targetPath
      ? history.getLastSnapshot(targetPath)
      : history.getLastSnapshot();

    if (!snapshot) {
      output(chalk.dim("No file edits to undo."));
      return true;
    }

    try {
      await writeFile(snapshot.path, snapshot.content, "utf-8");
      history.removeLastSnapshot(snapshot.path);
      output(chalk.dim(`Reverted: ${snapshot.path}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output(chalk.red(`Failed to revert: ${msg}`));
    }

    return true;
  },
};
