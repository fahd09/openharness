/**
 * Context File Loader — provider-aware project context file discovery.
 *
 * Loads provider-appropriate context files (CLAUDE.md for Anthropic,
 * AGENTS.md for OpenAI, GEMINI.md for Gemini, etc.).
 *
 * Load order:
 *   1. Provider-specific file (e.g. AGENTS.md) at standard locations
 *   2. Fallback to CLAUDE.md at same locations
 *   3. Empty string if nothing found
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { resolveContextFileName, DEFAULT_CONTEXT_FILES } from "../core/settings.js";

interface ContextFileSource {
  label: string;
  path: string;
  content: string;
}

/**
 * Discover and load context files for the active provider.
 *
 * @param cwd - Current working directory
 * @param provider - Provider name (e.g. "anthropic", "openai", "gemini")
 */
export async function loadContextFiles(cwd: string, provider?: string): Promise<string> {
  const effectiveProvider = provider ?? "anthropic";
  const fileName = await resolveContextFileName(effectiveProvider, cwd);

  // Try provider-specific file first
  let loaded = await loadFilesNamed(fileName, cwd);

  // If no provider-specific file found and the filename isn't already CLAUDE.md,
  // fall back to CLAUDE.md
  const fallback = DEFAULT_CONTEXT_FILES.anthropic; // "CLAUDE.md"
  if (loaded.length === 0 && fileName !== fallback) {
    loaded = await loadFilesNamed(fallback, cwd);
  }

  if (loaded.length === 0) return "";

  // Use the resolved filename for the header (shows which file was actually loaded)
  return loaded
    .map(
      (source) =>
        `# ${source.label} (${source.path})\n\n${source.content}`
    )
    .join("\n\n---\n\n");
}

/**
 * Load files with a given name from standard locations.
 */
async function loadFilesNamed(fileName: string, cwd: string): Promise<ContextFileSource[]> {
  const candidates = [
    { label: `${fileName} (User)`, path: join(homedir(), ".claude", fileName) },
    { label: `${fileName} (Project)`, path: join(cwd, fileName) },
    { label: `${fileName} (Project)`, path: join(cwd, ".claude", fileName) },
  ];

  // Also look upward for project root (git root)
  const gitRoot = await findGitRoot(cwd);
  if (gitRoot && gitRoot !== cwd) {
    candidates.push(
      { label: `${fileName} (Project root)`, path: join(gitRoot, fileName) },
      { label: `${fileName} (Project root)`, path: join(gitRoot, ".claude", fileName) }
    );
  }

  const loaded: ContextFileSource[] = [];

  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate.path, "utf-8");
      if (content.trim()) {
        // Avoid duplicates
        if (!loaded.some((s) => s.path === candidate.path)) {
          loaded.push({ ...candidate, content: content.trim() });
        }
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  return loaded;
}

async function findGitRoot(dir: string): Promise<string | null> {
  const { execFile } = await import("child_process");
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: dir },
      (error, stdout) => {
        if (error) resolve(null);
        else resolve(stdout.trim());
      }
    );
  });
}
