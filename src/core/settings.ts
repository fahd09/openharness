/**
 * Settings — loads and merges settings from global and project config.
 *
 * Global: ~/.openharness/settings.json
 * Project: .openharness/settings.json (relative to cwd)
 *
 * Project settings override global settings.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".openharness");

/** Default context file mapping per provider. */
export const DEFAULT_CONTEXT_FILES: Record<string, string> = {
  anthropic: "CLAUDE.md",
  openai: "AGENTS.md",
  gemini: "GEMINI.md",
};

export interface Settings {
  contextFiles?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Load and merge settings from global and project config files.
 * Project settings override global settings (shallow merge per top-level key,
 * deep merge for contextFiles).
 */
export async function loadSettings(cwd: string): Promise<Settings> {
  const globalPath = join(CONFIG_DIR, "settings.json");
  const projectPath = join(cwd, ".openharness", "settings.json");

  const [globalSettings, projectSettings] = await Promise.all([
    readJsonSafe<Settings>(globalPath),
    readJsonSafe<Settings>(projectPath),
  ]);

  // Merge: project overrides global
  const merged: Settings = { ...globalSettings, ...projectSettings };

  // Deep merge contextFiles specifically
  if (globalSettings.contextFiles || projectSettings.contextFiles) {
    merged.contextFiles = {
      ...globalSettings.contextFiles,
      ...projectSettings.contextFiles,
    };
  }

  return merged;
}

/**
 * Get the context file map, merging user settings over defaults.
 */
export async function getContextFileMap(cwd: string): Promise<Record<string, string>> {
  const settings = await loadSettings(cwd);
  return {
    ...DEFAULT_CONTEXT_FILES,
    ...settings.contextFiles,
  };
}

/**
 * Resolve the context filename for a given provider.
 * Checks user settings first, then falls back to defaults.
 */
export async function resolveContextFileName(provider: string, cwd: string): Promise<string> {
  const map = await getContextFileMap(cwd);
  return map[provider] ?? DEFAULT_CONTEXT_FILES.anthropic;
}

async function readJsonSafe<T>(path: string): Promise<T> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return {} as T;
  }
}
