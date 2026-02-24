/**
 * Custom Agent System — domain-specific agents defined via markdown files.
 *
 * Agent files use YAML frontmatter with a markdown body for the system prompt:
 * ```
 * ---
 * name: db-reader
 * description: Safe database query agent
 * tools: ["Read", "Bash", "Grep"]
 * model: haiku
 * maxTurns: 10
 * ---
 *
 * You are a database query specialist. Only run SELECT queries...
 * ```
 *
 * Agents are loaded from:
 * - ~/.openharness/agents/ (user-level)
 * - <cwd>/.openharness/agents/ (project-level, overrides user)
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { HookHandler } from "./hooks.js";

// ── Types ────────────────────────────────────────────────────────────

export interface AgentDefinition {
  name: string;
  description: string;
  /** Explicit list of allowed tools. */
  tools?: string[];
  /** Tools to remove even if they'd normally be available. */
  disallowedTools?: string[];
  /** Model alias (opus, sonnet, haiku) or full model ID. */
  model?: string;
  /** Permission mode for the agent. */
  permissionMode?: string;
  /** Maximum agentic turns. */
  maxTurns?: number;
  /** Whether the agent gets parent conversation context. */
  forkContext?: boolean;
  /** The markdown body used as the agent's system prompt. */
  systemPrompt: string;
  /** File path where the agent was loaded from. */
  source: string;
  /** Agent-scoped lifecycle hooks. */
  hooks?: HookHandler[];
  /** Skills available to this agent. */
  skills?: string[];
  /** Memory scope: "user", "project", or "local". */
  memory?: "user" | "project" | "local";
}

// ── Registry ─────────────────────────────────────────────────────────

const agents = new Map<string, AgentDefinition>();

/**
 * Parse a simple YAML value — handles strings, numbers, booleans, and JSON arrays.
 */
function parseYamlValue(value: string): string | number | boolean | string[] {
  const trimmed = value.trim();

  // JSON array: ["Read", "Bash"]
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Fall through to string
    }
  }

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;

  // String — strip optional quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Parse a markdown agent file with YAML frontmatter.
 */
export function parseAgentFile(content: string, filePath: string): AgentDefinition | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const systemPrompt = fmMatch[2].trim();

  // Line-by-line YAML parse
  const meta: Record<string, unknown> = {};
  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    meta[key] = parseYamlValue(rawValue);
  }

  if (!meta.name || typeof meta.name !== "string") return null;

  // Parse hooks from frontmatter (JSON array on single line)
  let hooks: HookHandler[] | undefined;
  if (meta.hooks) {
    if (typeof meta.hooks === "string") {
      try {
        const parsed = JSON.parse(meta.hooks);
        if (Array.isArray(parsed)) hooks = parsed;
      } catch { /* ignore invalid hooks */ }
    }
  }

  return {
    name: meta.name as string,
    description: (meta.description as string) ?? "",
    tools: Array.isArray(meta.tools) ? meta.tools as string[] : undefined,
    disallowedTools: Array.isArray(meta.disallowedTools) ? meta.disallowedTools as string[] : undefined,
    model: meta.model as string | undefined,
    permissionMode: meta.permissionMode as string | undefined,
    maxTurns: typeof meta.maxTurns === "number" ? meta.maxTurns : undefined,
    forkContext: typeof meta.forkContext === "boolean" ? meta.forkContext : undefined,
    systemPrompt,
    source: filePath,
    hooks,
    skills: Array.isArray(meta.skills) ? meta.skills as string[] : undefined,
    memory: (["user", "project", "local"].includes(meta.memory as string))
      ? meta.memory as "user" | "project" | "local"
      : undefined,
  };
}

/**
 * Load agent definitions from a directory.
 */
async function loadAgentsFromDir(dir: string): Promise<void> {
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const filePath = join(dir, file);
        const content = await readFile(filePath, "utf-8");
        const agent = parseAgentFile(content, filePath);
        if (agent) {
          agents.set(agent.name, agent);
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
}

/**
 * Load all agents from user and project directories.
 * Project agents override user agents with the same name.
 */
export async function loadAgents(cwd: string): Promise<void> {
  agents.clear();

  const dirs = [
    join(homedir(), ".openharness", "agents"),
    join(cwd, ".openharness", "agents"),
  ];

  for (const dir of dirs) {
    await loadAgentsFromDir(dir);
  }
}

/**
 * Get an agent definition by name.
 */
export function getAgent(name: string): AgentDefinition | undefined {
  return agents.get(name);
}

/**
 * List all loaded agents.
 */
export function listAgents(): AgentDefinition[] {
  return Array.from(agents.values());
}
