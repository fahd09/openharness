/**
 * Skill System — loadable capabilities via SKILL.md files.
 *
 * Skills are defined as markdown files with YAML frontmatter:
 * ```
 * ---
 * name: commit
 * description: Create a git commit
 * command: /commit
 * ---
 *
 * <prompt content that gets injected when the skill is invoked>
 * ```
 *
 * Skills are loaded from:
 * - ~/.openharness/skills/ (user-level)
 * - .openharness/skills/ (project-level)
 *
 * Invoked via slash commands in the REPL: /commit, /review-pr, etc.
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";

// ── Types ────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  description: string;
  command: string; // e.g., "/commit"
  prompt: string; // The full prompt template
  source: string; // File path where it was loaded from
  /** "inline" (default) runs in main context; "fork" delegates to a subagent. */
  context?: "inline" | "fork";
  /** Agent type to use when context is "fork" (default: "general-purpose"). */
  agent?: string;
  /** If true, the model cannot auto-invoke this skill — only the user can. */
  disableModelInvocation?: boolean;
  /** Whether the user can invoke this skill (default: true). */
  userInvocable?: boolean;
  /** Restrict tools available during skill execution. */
  allowedTools?: string[];
  /** If true, the skill can only be invoked once per session. */
  once?: boolean;
}

// ── Skill Registry ───────────────────────────────────────────────────

const skills = new Map<string, Skill>();

/**
 * Parse a SKILL.md file into a Skill object.
 * Expects YAML frontmatter between --- delimiters.
 */
function parseSkillFile(content: string, filePath: string): Skill | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const prompt = fmMatch[2].trim();

  // Simple YAML parser for key: value pairs
  const meta: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    meta[key] = value;
  }

  if (!meta.name || !meta.command) return null;

  return {
    name: meta.name,
    description: meta.description ?? "",
    command: meta.command.startsWith("/") ? meta.command : `/${meta.command}`,
    prompt,
    source: filePath,
    context: meta.context === "fork" ? "fork" : "inline",
    agent: meta.agent || undefined,
    disableModelInvocation: meta["disable-model-invocation"] === "true" || meta.disableModelInvocation === "true",
    userInvocable: meta["user-invocable"] !== "false" && meta.userInvocable !== "false",
    allowedTools: meta["allowed-tools"] ? meta["allowed-tools"].split(",").map((s: string) => s.trim()) : undefined,
    once: meta.once === "true",
  };
}

/**
 * Load skills from a directory.
 */
async function loadSkillsFromDir(dir: string): Promise<void> {
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const filePath = join(dir, file);
        const content = await readFile(filePath, "utf-8");
        const skill = parseSkillFile(content, filePath);
        if (skill) {
          skills.set(skill.command, skill);
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
 * Load Claude Code commands from a .claude/commands/ directory.
 *
 * These files use a simpler format: filename becomes the command name,
 * entire file content is the prompt. If the file starts with --- it's
 * parsed with frontmatter normally (compatible with both formats).
 */
async function loadClaudeCommandsFromDir(dir: string): Promise<void> {
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const filePath = join(dir, file);
        const content = await readFile(filePath, "utf-8");

        // If file has frontmatter, parse it normally
        if (content.startsWith("---\n")) {
          const skill = parseSkillFile(content, filePath);
          if (skill) {
            skills.set(skill.command, skill);
            continue;
          }
        }

        // Otherwise, use filename as command name, content as prompt
        const name = file.replace(/\.md$/, "");
        const command = `/${name}`;

        // Don't overwrite native skills with the same command
        if (skills.has(command)) continue;

        skills.set(command, {
          name,
          description: `Claude Code command: ${name}`,
          command,
          prompt: content.trim(),
          source: filePath,
          context: "inline",
          userInvocable: true,
        });
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
}

/**
 * Load all skills from user and project directories.
 *
 * Scans native skill directories first, then Claude Code command directories.
 * Native skills take precedence over Claude Code commands with the same name.
 */
export async function loadSkills(cwd: string): Promise<void> {
  skills.clear();

  // Native skill directories
  const dirs = [
    join(homedir(), ".openharness", "skills"),
    join(cwd, ".openharness", "skills"),
  ];

  for (const dir of dirs) {
    await loadSkillsFromDir(dir);
  }

  // Claude Code command directories (lower precedence — won't overwrite native skills)
  await loadClaudeCommandsFromDir(join(cwd, ".claude", "commands"));
}

/**
 * Get a skill by its slash command.
 */
export function getSkill(command: string): Skill | undefined {
  const normalizedCommand = command.startsWith("/") ? command : `/${command}`;
  return skills.get(normalizedCommand);
}

/**
 * List all loaded skills.
 */
export function listSkills(): Skill[] {
  return Array.from(skills.values());
}

/**
 * Register a skill programmatically.
 */
export function registerSkill(skill: Skill): void {
  skills.set(skill.command, skill);
}

// ── $ARGUMENTS Substitution ──────────────────────────────────────────

/**
 * Replace `$ARGUMENTS` and `$ARGUMENTS[N]` in skill content.
 *
 * - `$ARGUMENTS[0]`, `$ARGUMENTS[1]` etc. → positional args
 * - `$ARGUMENTS` → full args string
 * - If neither placeholder is present and args is non-empty, appends as `\n\nARGUMENTS: {args}`
 */
export function substituteSkillArgs(content: string, args: string): string {
  if (!args) return content;

  let substituted = false;
  const positionalArgs = args.split(/\s+/);

  // Replace positional $ARGUMENTS[N]
  let result = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, indexStr) => {
    substituted = true;
    const idx = parseInt(indexStr, 10);
    return positionalArgs[idx] ?? "";
  });

  // Replace $ARGUMENTS with full args string
  if (result.includes("$ARGUMENTS")) {
    result = result.replace(/\$ARGUMENTS/g, args);
    substituted = true;
  }

  // If no placeholder was found, append args
  if (!substituted) {
    result += `\n\nARGUMENTS: ${args}`;
  }

  return result;
}

// ── Once Tracking ────────────────────────────────────────────────────

const invokedOnceSkills = new Set<string>();

export function markSkillInvoked(command: string): void {
  invokedOnceSkills.add(command);
}

export function isSkillInvokedOnce(command: string): boolean {
  return invokedOnceSkills.has(command);
}

export function resetOnceSkills(): void {
  invokedOnceSkills.clear();
}

// ── Skill Preprocessing ──────────────────────────────────────────────

/**
 * Execute a shell command and return its stdout.
 * Used for `!`command`` substitution in skill content.
 */
function execCommand(command: string, cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "/bin/bash",
      ["-c", command],
      { cwd, timeout: 10000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(`(command failed: ${error.message})`);
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

/**
 * Preprocess skill content:
 * 1. Replace `!`command`` with shell command output
 * 2. Apply $ARGUMENTS substitution
 *
 * The `!`...`` syntax allows skills to inject dynamic data before the model sees the prompt.
 */
export async function preprocessSkillContent(
  content: string,
  args: string,
  cwd?: string
): Promise<string> {
  // First apply $ARGUMENTS substitution (also applies inside !`...` commands)
  let result = substituteSkillArgs(content, args);

  // Replace !`command` with shell command output
  const backtickPattern = /!\`([^`]+)\`/g;
  const matches = [...result.matchAll(backtickPattern)];

  for (const match of matches) {
    const command = match[1];
    const output = await execCommand(command, cwd);
    result = result.replace(match[0], output);
  }

  return result;
}
