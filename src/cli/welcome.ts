/**
 * Welcome Banner — info gathering and rendering for interactive mode.
 *
 * Features a horse-face ASCII art with harness noseband displayed
 * side-by-side with model/session configuration info.
 */

import chalk from "chalk";
import { readFile } from "fs/promises";
import { getSuggestions } from "../core/suggestions.js";
import { colors } from "../ui/theme.js";
import type { CliOptions } from "./args.js";
import type { PermissionMode } from "../core/permission-modes.js";

export interface WelcomeInfo {
  version: string;
  model: string;
  provider: string;
  permissionMode: PermissionMode;
  cwd: string;
  gitBranch: string;
  sessionId: string;
  isResumed: boolean;
  suggestions: string[];
}

export async function getWelcomeInfo(
  opts: CliOptions,
  permissionMode: PermissionMode,
  cwd: string,
  sessionId: string,
  isResumed: boolean,
): Promise<WelcomeInfo> {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

  let version = "0.1.0";
  try {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8"));
    version = pkg.version ?? version;
  } catch {}

  let gitBranch = "";
  try {
    const { execFile: execFileCb } = await import("child_process");
    gitBranch = await new Promise((resolve) => {
      execFileCb("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }, (err, stdout) => {
        resolve(err ? "" : stdout.trim());
      });
    });
  } catch {}

  const suggestions = isResumed ? [] : await getSuggestions(cwd);

  return {
    version,
    model: opts.model,
    provider,
    permissionMode,
    cwd,
    gitBranch,
    sessionId,
    isResumed,
    suggestions,
  };
}

// ── ASCII Art ────────────────────────────────────────────────────────

/**
 * Horse face with harness noseband — front view.
 *
 *   ╭╮       ╭╮     ← ears
 *   │╰───────╯│     ← forehead
 *   │  ●   ●  │     ← eyes
 *   │         │
 *   ╞═════════╡     ← harness noseband
 *   │  ╲   ╱  │     ← muzzle
 *   ╰────▽────╯     ← chin
 */
const HORSE_ART = [
  "  ╭╮       ╭╮",
  "  │╰───────╯│",
  "  │  ●   ●  │",
  "  │         │",
  "  ╞═════════╡",
  "  │  ╲   ╱  │",
  "  ╰────▽────╯",
];

const ART_WIDTH = 19; // visual width to pad art lines to (13 chars + 6 spacing)

export function printWelcomeBanner(w: WelcomeInfo): void {
  const brand = colors.brand;

  // Build right-side info lines (aligned with art lines)
  const infoLines: string[] = [
    chalk.bold("openharness") + chalk.dim(` v${w.version}`),
    chalk.dim("─".repeat(32)),
    chalk.dim(`Model:    ${w.model}`) + chalk.dim(` (${w.provider})`),
    chalk.dim(`Mode:     ${w.permissionMode}`),
    chalk.dim(`CWD:      ${w.cwd}`),
  ];
  if (w.gitBranch) {
    infoLines.push(chalk.dim(`Branch:   ${w.gitBranch}`));
  }
  infoLines.push(chalk.dim(`Session:  ${w.sessionId}${w.isResumed ? " (resumed)" : ""}`));

  // Zip art and info side-by-side
  const maxLines = Math.max(HORSE_ART.length, infoLines.length);
  console.log();
  for (let i = 0; i < maxLines; i++) {
    const artRaw = HORSE_ART[i] ?? "";
    const artPadded = artRaw.padEnd(ART_WIDTH);
    const info = infoLines[i] ?? "";
    console.log(brand(artPadded) + info);
  }

  // Suggestions
  if (!w.isResumed && w.suggestions.length > 0) {
    console.log();
    console.log(chalk.dim("  Try:"));
    for (const s of w.suggestions) {
      console.log(chalk.dim(`    ${chalk.cyan(">")} ${s}`));
    }
  }

  console.log();
  console.log(chalk.dim("Type your message. /help for commands. Ctrl+C to interrupt.\n"));
}
