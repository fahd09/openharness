/**
 * Memory System — persistent notes across sessions.
 *
 * Stores project-scoped memory in ~/.claude-code-core/projects/{hash}/memory/.
 * MEMORY.md is loaded into the system prompt as a dynamic section.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { getClaudeProjectDir } from "./claude-compat.js";

/**
 * Get the memory directory for the current project.
 * Uses a hash of the cwd to scope memory per project.
 */
export function getMemoryDir(cwd?: string): string {
  const projectPath = cwd ?? process.cwd();
  const hash = createHash("md5").update(projectPath).digest("hex").slice(0, 12);
  return join(homedir(), ".claude-code-core", "projects", hash, "memory");
}

/**
 * Ensure the memory directory exists.
 */
async function ensureMemoryDir(cwd?: string): Promise<string> {
  const dir = getMemoryDir(cwd);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Load MEMORY.md contents. Returns null if not found.
 *
 * Checks our native path first, then falls back to Claude Code's
 * project memory path (~/.claude/projects/{dirName}/memory/MEMORY.md).
 */
export async function loadMemory(cwd?: string): Promise<string | null> {
  // 1. Check native path
  try {
    const dir = getMemoryDir(cwd);
    const content = await readFile(join(dir, "MEMORY.md"), "utf-8");
    if (content.trim()) return content.trim();
  } catch {
    // Not found — try fallback
  }

  // 2. Fallback to Claude Code memory path
  try {
    const projectPath = cwd ?? process.cwd();
    const claudeMemoryPath = join(
      getClaudeProjectDir(projectPath),
      "memory",
      "MEMORY.md"
    );
    const content = await readFile(claudeMemoryPath, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Save content to MEMORY.md (overwrites).
 */
export async function saveMemory(content: string, cwd?: string): Promise<void> {
  const dir = await ensureMemoryDir(cwd);
  await writeFile(join(dir, "MEMORY.md"), content, "utf-8");
}

/**
 * Append a line to MEMORY.md.
 */
export async function appendMemory(line: string, cwd?: string): Promise<void> {
  const existing = await loadMemory(cwd);
  const content = existing ? `${existing}\n${line}` : line;
  await saveMemory(content, cwd);
}

/**
 * Load a topic-specific memory file (e.g., "debugging.md", "patterns.md").
 */
export async function loadTopicMemory(topic: string, cwd?: string): Promise<string | null> {
  try {
    const dir = getMemoryDir(cwd);
    const content = await readFile(join(dir, `${topic}.md`), "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Save content to a topic-specific memory file.
 */
export async function saveTopicMemory(topic: string, content: string, cwd?: string): Promise<void> {
  const dir = await ensureMemoryDir(cwd);
  await writeFile(join(dir, `${topic}.md`), content, "utf-8");
}

/**
 * List all memory files in the memory directory.
 */
export async function listMemoryFiles(cwd?: string): Promise<string[]> {
  try {
    const { readdir } = await import("fs/promises");
    const dir = getMemoryDir(cwd);
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

// ── Agent Memory ──────────────────────────────────────────────────────

/**
 * Get the memory directory for a named agent.
 *
 * Scope determines where memory is stored:
 * - "user" → ~/.claude-code-core/agent-memory/{name}/
 * - "project" → <cwd>/.claude-code-core/agent-memory/{name}/
 * - "local" → <cwd>/.claude-code-core/agent-memory-local/{name}/
 */
export function getAgentMemoryDir(agentName: string, scope: "user" | "project" | "local", cwd?: string): string {
  const projectPath = cwd ?? process.cwd();
  switch (scope) {
    case "user":
      return join(homedir(), ".claude-code-core", "agent-memory", agentName);
    case "project":
      return join(projectPath, ".claude-code-core", "agent-memory", agentName);
    case "local":
      return join(projectPath, ".claude-code-core", "agent-memory-local", agentName);
  }
}

/**
 * Load MEMORY.md for a named agent. Returns null if not found.
 */
export async function loadAgentMemory(
  agentName: string,
  scope: "user" | "project" | "local",
  cwd?: string
): Promise<string | null> {
  try {
    const dir = getAgentMemoryDir(agentName, scope, cwd);
    const content = await readFile(join(dir, "MEMORY.md"), "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Save MEMORY.md for a named agent.
 */
export async function saveAgentMemory(
  agentName: string,
  scope: "user" | "project" | "local",
  content: string,
  cwd?: string
): Promise<void> {
  const dir = getAgentMemoryDir(agentName, scope, cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "MEMORY.md"), content, "utf-8");
}

/**
 * Compact memory if it exceeds maxLines by summarizing older entries.
 * Keeps the most recent entries and summarizes the rest into a header.
 */
export async function compactMemory(maxLines: number = 200, cwd?: string): Promise<boolean> {
  const content = await loadMemory(cwd);
  if (!content) return false;

  const lines = content.split("\n");
  if (lines.length <= maxLines) return false;

  // Keep the last 2/3 of lines, summarize the first 1/3 into a compact header
  const keepCount = Math.floor(maxLines * 0.67);
  const keptLines = lines.slice(lines.length - keepCount);

  const compacted = [
    "<!-- Memory compacted — older entries summarized -->",
    "",
    ...keptLines,
  ].join("\n");

  await saveMemory(compacted, cwd);
  return true;
}
