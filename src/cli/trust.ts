/**
 * Project Trust Prompt — first-run trust check for new projects.
 *
 * On first run in a directory, asks the user whether they trust the files.
 * Trust state is stored per-user in ~/.claude/projects/<encoded-path>/trust.json,
 * so it's never committed to version control.
 */

import * as readline from "readline";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import { getClaudeProjectDir } from "../core/claude-compat.js";

export interface TrustState {
  trusted: boolean;
  timestamp?: number;
}

function getTrustPath(cwd: string): string {
  return join(getClaudeProjectDir(cwd), "trust.json");
}

/**
 * Check if the current directory has been trusted.
 */
export async function isProjectTrusted(cwd: string): Promise<boolean> {
  try {
    const content = await readFile(getTrustPath(cwd), "utf-8");
    const state = JSON.parse(content) as TrustState;
    return state.trusted === true;
  } catch {
    return false;
  }
}

/**
 * Mark the current directory as trusted.
 */
export async function trustProject(cwd: string): Promise<void> {
  const trustPath = getTrustPath(cwd);
  const dir = join(trustPath, "..");
  await mkdir(dir, { recursive: true });

  const state: TrustState = {
    trusted: true,
    timestamp: Date.now(),
  };
  await writeFile(trustPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/**
 * Show interactive trust prompt. Returns true if user trusts.
 *
 * Uses readline (not Ink) since this runs before Ink mounts.
 */
export async function promptProjectTrust(cwd: string): Promise<boolean> {
  const boxWidth = 46;
  const inner = boxWidth - 4; // content width inside borders

  const pad = (text: string, width: number): string => {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
    const padding = Math.max(0, width - visible.length);
    return text + " ".repeat(padding);
  };

  const line1 = "Do you trust the files in this folder?";
  const line2 = cwd.length > inner ? "..." + cwd.slice(-(inner - 3)) : cwd;
  const line3 = "Tools may read/modify files and run";
  const line4 = "commands in this directory.";
  const line5 = chalk.green("[y]") + "es, trust this folder";
  const line6 = chalk.red("[n]") + "o, run in read-only (plan) mode";

  console.log();
  console.log(chalk.dim(`  ${"╭" + "─".repeat(boxWidth - 2) + "╮"}`));
  console.log(chalk.dim(`  │  ${pad(chalk.bold(line1), inner)}│`));
  console.log(chalk.dim(`  │  ${pad("", inner)}│`));
  console.log(chalk.dim(`  │  ${pad(chalk.cyan(line2), inner)}│`));
  console.log(chalk.dim(`  │  ${pad("", inner)}│`));
  console.log(chalk.dim(`  │  ${pad(line3, inner)}│`));
  console.log(chalk.dim(`  │  ${pad(line4, inner)}│`));
  console.log(chalk.dim(`  │  ${pad("", inner)}│`));
  console.log(chalk.dim(`  │  ${pad(line5, inner)}│`));
  console.log(chalk.dim(`  │  ${pad(line6, inner)}│`));
  console.log(chalk.dim(`  ${"╰" + "─".repeat(boxWidth - 2) + "╯"}`));
  console.log();

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.dim("  Trust? "), (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}
