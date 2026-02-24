/**
 * Prompt Loader — loads prompt files with user/project override support.
 *
 * Prompts are plain markdown files. The filename (without extension) is the
 * prompt name. Override hierarchy (highest priority first):
 *
 *   1. .openharness/prompts/{name}.md  (project-level)
 *   2. ~/.openharness/prompts/{name}.md (user-level)
 *   3. src/prompts/{name}.md                (built-in default)
 *
 * This mirrors the existing skills/agents two-tier override pattern.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

// ── Cache ────────────────────────────────────────────────────────────

const promptCache = new Map<string, string>();

// ── Path resolution ──────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Built-in prompts directory: src/prompts/ (sibling to src/core/) */
const BUILTIN_DIR = join(__dirname, "..", "prompts");

/** User-level override directory */
const USER_DIR = join(homedir(), ".openharness", "prompts");

/** Project-level override directory (relative to cwd) */
function projectDir(): string {
  return join(process.cwd(), ".openharness", "prompts");
}

// ── Helpers ──────────────────────────────────────────────────────────

function tryReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load a prompt by name. Checks project → user → built-in directories.
 * Results are cached for the lifetime of the process.
 *
 * @throws if the prompt file is not found in any location
 */
export function loadPrompt(name: string): string {
  const cached = promptCache.get(name);
  if (cached !== undefined) return cached;

  const filename = `${name}.md`;

  // 1. Project-level override
  const projectContent = tryReadFile(join(projectDir(), filename));
  if (projectContent !== null) {
    promptCache.set(name, projectContent);
    return projectContent;
  }

  // 2. User-level override
  const userContent = tryReadFile(join(USER_DIR, filename));
  if (userContent !== null) {
    promptCache.set(name, userContent);
    return userContent;
  }

  // 3. Built-in default
  const builtinContent = tryReadFile(join(BUILTIN_DIR, filename));
  if (builtinContent !== null) {
    promptCache.set(name, builtinContent);
    return builtinContent;
  }

  throw new Error(
    `Prompt "${name}" not found. Searched:\n` +
      `  - ${join(projectDir(), filename)}\n` +
      `  - ${join(USER_DIR, filename)}\n` +
      `  - ${join(BUILTIN_DIR, filename)}`
  );
}

/**
 * Load a prompt by name, returning null if not found.
 */
export function loadPromptIfExists(name: string): string | null {
  try {
    return loadPrompt(name);
  } catch {
    return null;
  }
}

/**
 * Clear the prompt cache. Call after config reload or when
 * prompt files may have changed.
 */
export function clearPromptCache(): void {
  promptCache.clear();
}
