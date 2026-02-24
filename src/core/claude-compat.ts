/**
 * Claude Code Compatibility — read-only import layer.
 *
 * Shared utilities for discovering and loading data from the official
 * Claude Code CLI directories (~/.claude/ and .claude/).
 * All reads are read-only — we never write to .claude/ directories.
 */

import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createReadStream } from "fs";
import { createInterface } from "readline";

// ── Constants ────────────────────────────────────────────────────────

/** Claude Code home directory: ~/.claude */
export const CLAUDE_HOME = join(homedir(), ".claude");

/** Claude Code project index directory: ~/.claude/projects */
export const CLAUDE_PROJECT_DIR = join(CLAUDE_HOME, "projects");

// ── Path Resolution ──────────────────────────────────────────────────

/**
 * Convert a cwd to Claude Code's project directory name.
 * Formula: replace all `/` with `-` (leading slash becomes leading dash).
 *
 * Example: "/Users/fahd/projects/banan" → "-Users-fahd-projects-banan"
 */
export function cwdToProjectDirName(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/**
 * Get the Claude Code project directory for a given cwd.
 * Returns "~/.claude/projects/-Users-fahd-projects-banan"
 */
export function getClaudeProjectDir(cwd: string): string {
  return join(CLAUDE_PROJECT_DIR, cwdToProjectDirName(cwd));
}

/**
 * Get the project-level settings.local.json path for a given cwd.
 * Returns "<cwd>/.claude/settings.local.json"
 */
export function getClaudeProjectSettingsPath(cwd: string): string {
  return join(cwd, ".claude", "settings.local.json");
}

// ── JSONL Parsing ────────────────────────────────────────────────────

/**
 * Stream-parse a JSONL file line by line, yielding parsed objects.
 * Skips blank lines and lines that fail to parse.
 */
export async function* parseJsonlFile(
  filePath: string
): AsyncGenerator<Record<string, unknown>> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Skip malformed lines
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

// ── Settings Loading ─────────────────────────────────────────────────

/**
 * Load and parse a Claude Code settings.local.json file.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function loadClaudeSettings(
  settingsPath: string
): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save (merge) data into a Claude Code settings JSON file.
 *
 * - Reads the existing file (or starts with {})
 * - Shallow-merges `updates` into it
 * - Writes atomically via tmp + rename
 * - Creates parent directories as needed
 */
export async function saveClaudeSettings(
  settingsPath: string,
  updates: Record<string, unknown>
): Promise<void> {
  const existing = (await loadClaudeSettings(settingsPath)) ?? {};
  const merged = { ...existing, ...updates };

  const dir = join(settingsPath, "..");
  await mkdir(dir, { recursive: true });

  const tmpPath = settingsPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  await rename(tmpPath, settingsPath);
}
