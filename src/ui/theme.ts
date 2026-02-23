/**
 * Theme — centralized icon/color definitions for Ink components.
 */

import chalk from "chalk";

// ── Icons ──────────────────────────────────────────────────────────

export const icons = {
  tick: "\u2714",           // ✔
  cross: "\u2718",          // ✘
  pointer: "\u276F",        // ❯
  squareSmall: "\u25FB",    // ◻
  squareSmallFilled: "\u25FC", // ◼
  checkboxOn: "\u2612",     // ☒
  checkboxOff: "\u2610",    // ☐
  ellipsis: "\u2026",       // …
  arrowDown: "\u2193",      // ↓
  arrowUp: "\u2191",        // ↑
  toolMarker: "\u23FA",     // ⏺
  resultMarker: "\u23BF",   // ⎿
  thinking: "\uD83D\uDCAD", // 💭
  plan: "\uD83D\uDCCB",     // 📋
  retry: "\u21BB",          // ↻
  compact: "\u27F3",        // ⟳
  star: "\u2733",           // ✳
};

// ── Spinner Frames ─────────────────────────────────────────────────

// Phase 1: Braille spinner (same as legacy)
export const BRAILLE_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

// Phase 2: Star-morph spinner
export const STAR_FRAMES = [".", "\u2722", "\u2733", "\u2736", "\u273B", "\u273D"];

// ── Colors ─────────────────────────────────────────────────────────

export const colors = {
  brand: chalk.hex("#D4A574"),      // Warm gold
  brandDim: chalk.hex("#8B7355"),   // Dimmed brand
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
  dim: chalk.dim,
  toolName: chalk.yellow,
  thinking: chalk.dim,
  resultDim: chalk.dim,
};

// ── Agent Palette ──────────────────────────────────────────────────

const AGENT_COLORS = [
  chalk.cyan,
  chalk.magenta,
  chalk.yellow,
  chalk.green,
  chalk.blue,
  chalk.red,
];

export function agentColor(index: number): typeof chalk {
  return AGENT_COLORS[index % AGENT_COLORS.length] as typeof chalk;
}
