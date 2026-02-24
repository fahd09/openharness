import { platform, arch } from "os";
import { loadClaudeMdFiles } from "./claude-md.js";
import { getAgentPrompt } from "./agent-prompts.js";
import { loadMemory, loadAgentMemory } from "../core/memory.js";
import { getStylePrompt } from "../core/output-style.js";
import type { SystemPrompt, SystemPromptSegment, SystemPromptResult, PromptSegmentDetail } from "../core/types.js";
import type { AgentDefinition } from "../core/agents.js";
import { listSkills } from "../core/skills.js";
import { loadPrompt } from "../core/prompt-loader.js";
import type { PluginManager } from "../core/plugins/index.js";
import type { PromptSegmentPosition } from "../core/plugins/types.js";

/**
 * Assemble the full system prompt from modular sections.
 *
 * Returns an array of segments with cache hints. Stable content (identity,
 * system, tools, guidelines) gets a cache breakpoint at the end so the API
 * caches ~10K tokens across turns. Dynamic content (environment, CLAUDE.md)
 * comes after and varies per session.
 *
 * Cache layout:
 *   [identity | system | tools | task | code] ← cache breakpoint here
 *   [environment | CLAUDE.md]                 ← cache breakpoint here (session-stable)
 */
export async function buildSystemPrompt(
  cwd: string,
  toolNames: string[],
  pluginManager?: PluginManager
): Promise<SystemPromptResult> {
  // ── Plugin-driven path ─────────────────────────────────────
  // When a pluginManager is provided, collect prompt segments from
  // all enabled plugins, group by position, and assemble.
  if (pluginManager) {
    return buildSystemPromptFromPlugins(cwd, toolNames, pluginManager);
  }

  // ── Legacy path (subagent prompts, no pluginManager) ───────
  const segments: SystemPromptSegment[] = [];

  // ── Static segments (stable across all sessions) ──────────
  // These rarely change, so we group them and cache the prefix.

  const staticText = [
    identitySection(),
    systemSection(),
    toolInstructions(toolNames),
    taskGuidelines(),
    codingGuidelines(),
  ]
    .filter(Boolean)
    .join("\n\n");

  segments.push({ text: staticText, cacheHint: true });

  // ── Dynamic segments (stable within a session) ────────────
  // Environment and CLAUDE.md change per project but are stable
  // within a session, so they get a second cache breakpoint.

  const dynamicParts: string[] = [];

  dynamicParts.push(await environmentSection(cwd));

  const claudeMd = await loadClaudeMdFiles(cwd);
  if (claudeMd) {
    dynamicParts.push(claudeMd);
  }

  // Load persistent memory
  const memory = await loadMemory(cwd);
  if (memory) {
    // Truncate to ~200 lines as per memory system design
    const memoryLines = memory.split("\n").slice(0, 200);
    dynamicParts.push(`# Memory\n${memoryLines.join("\n")}`);
  }

  // Add skill descriptions (so the model knows about available skills)
  const skills = listSkills().filter((s) => !s.disableModelInvocation);
  if (skills.length > 0) {
    const skillLines = skills.map((s) => `- ${s.command}: ${s.description}`);
    dynamicParts.push(`# Available Skills\n${skillLines.join("\n")}`);
  }

  if (dynamicParts.length > 0) {
    segments.push({
      text: dynamicParts.join("\n\n"),
      cacheHint: true,
    });
  }

  // Non-cached dynamic segment: output style (changes frequently)
  const stylePrompt = getStylePrompt();
  if (stylePrompt) {
    segments.push({
      text: `\n# Output Style\n${stylePrompt}`,
      cacheHint: false,
    });
  }

  return { segments, details: [] };
}

/**
 * Build system prompt from plugin-registered prompt segments.
 * Groups segments by position (static/dynamic/volatile), calls each
 * content callback, and assembles into SystemPromptSegment[] with
 * appropriate cache hints.
 */
async function buildSystemPromptFromPlugins(
  cwd: string,
  toolNames: string[],
  pluginManager: PluginManager
): Promise<SystemPromptResult> {
  const registrations = pluginManager.getPromptSegments();
  const buildCtx = { cwd, toolNames };

  // Group by position, track per-segment details
  const groups: Record<PromptSegmentPosition, string[]> = {
    static: [],
    dynamic: [],
    volatile: [],
  };
  const details: PromptSegmentDetail[] = [];

  for (const reg of registrations) {
    const text = await reg.content(buildCtx);
    if (text) {
      groups[reg.position].push(text);
      details.push({
        id: reg.id,
        position: reg.position,
        charCount: text.length,
      });
    }
  }

  const segments: SystemPromptSegment[] = [];

  if (groups.static.length > 0) {
    segments.push({
      text: groups.static.join("\n\n"),
      cacheHint: true,
    });
  }

  if (groups.dynamic.length > 0) {
    segments.push({
      text: groups.dynamic.join("\n\n"),
      cacheHint: true,
    });
  }

  if (groups.volatile.length > 0) {
    segments.push({
      text: groups.volatile.join("\n\n"),
      cacheHint: false,
    });
  }

  return { segments, details };
}

/**
 * Convert system prompt segments to a single string.
 * Used for token estimation and legacy compatibility.
 */
export function systemPromptToString(prompt: SystemPrompt): string {
  return prompt.map((s) => s.text).join("\n\n");
}

export function identitySection(): string {
  return loadPrompt("system-identity");
}

export function systemSection(): string {
  return loadPrompt("system-rules");
}

export function toolInstructions(toolNames: string[]): string {
  const instructions = [
    "# Using tools",
    "Use dedicated tools instead of Bash when possible:",
  ];

  if (toolNames.includes("Read"))
    instructions.push("- Read files with Read, not cat/head/tail");
  if (toolNames.includes("Write"))
    instructions.push("- Create files with Write, not echo/cat heredoc");
  if (toolNames.includes("Edit"))
    instructions.push("- Edit files with Edit, not sed/awk");
  if (toolNames.includes("Glob"))
    instructions.push("- Find files with Glob, not find/ls");
  if (toolNames.includes("Grep"))
    instructions.push("- Search content with Grep, not grep/rg");
  if (toolNames.includes("Bash"))
    instructions.push(
      "- Use Bash for git, npm, running scripts, and other terminal operations"
    );
  if (toolNames.includes("Task"))
    instructions.push(
      "- Use Task to spawn subagents for complex multi-step research tasks"
    );

  instructions.push("");
  instructions.push("# Efficient tool use");
  instructions.push(
    `- IMPORTANT: Batch multiple operations into a single Bash call whenever possible. Never make 10+ separate tool calls when one script can do the same work.
- Use inline python3 or bash scripts to gather data, transform output, or perform multi-step operations in a single tool call.
- Examples of batching:
  - Instead of running wc -l on 40 files separately: \`find src -name "*.ts" | xargs wc -l\` or \`fd -e ts -x wc -l | awk '{s+=$1} END {print s}'\`
  - Instead of multiple greps: \`rg -c "pattern" src/ | sort -t: -k2 -rn\`
  - For complex data gathering: \`python3 -c "import os; ..."\` with a short inline script
- Use pipes, xargs, and shell features (loops, subshells, process substitution) to combine work.
- When you need to check multiple things about the system or codebase, write a single script that collects everything at once.`
  );

  return instructions.join("\n");
}

export function taskGuidelines(): string {
  return loadPrompt("system-tasks");
}

export function codingGuidelines(): string {
  return loadPrompt("system-coding");
}

export async function environmentSection(cwd: string): Promise<string> {
  const isGit = await checkIsGitRepo(cwd);

  const envLines = [
    `# Environment`,
    `- Working directory: ${cwd}`,
    `- Platform: ${platform()} (${arch()})`,
    `- Git repo: ${isGit ? "yes" : "no"}`,
  ];

  if (isGit) {
    const gitInfo = await getGitStatusInfo(cwd);
    if (gitInfo) {
      envLines.push(gitInfo);
    }
  }

  return envLines.join("\n");
}

/**
 * Get a compact git status summary for the system prompt.
 */
async function getGitStatusInfo(cwd: string): Promise<string | null> {
  const { execFile: execFileCb } = await import("child_process");

  const run = (args: string[]): Promise<string> =>
    new Promise((resolve) => {
      execFileCb("git", args, { cwd, timeout: 3000 }, (error, stdout) => {
        resolve(error ? "" : stdout.trim());
      });
    });

  try {
    const branch = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
    const status = await run(["status", "--porcelain"]);

    if (!branch) return null;

    const lines = status ? status.split("\n") : [];
    const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).length;
    const untracked = lines.filter((l) => l.startsWith("??")).length;
    const staged = lines.filter(
      (l) => l.startsWith("A ") || l.startsWith("M ") || l.startsWith("D ") || l.startsWith("R ")
    ).length;

    const parts = [`- Git branch: ${branch}`];
    if (modified + untracked + staged > 0) {
      const statusParts: string[] = [];
      if (modified) statusParts.push(`${modified} modified`);
      if (staged) statusParts.push(`${staged} staged`);
      if (untracked) statusParts.push(`${untracked} untracked`);
      parts.push(`- Git status: ${statusParts.join(", ")}`);
    }

    return parts.join("\n");
  } catch {
    return null;
  }
}

/**
 * Build a system prompt for a subagent.
 *
 * Uses agent-type-specific prompts instead of the generic identity.
 * Isolated agents (forkContext: false) get a leaner prompt without CLAUDE.md.
 * Forked agents (forkContext: true) get the full prompt since they share context.
 */
export async function buildAgentSystemPrompt(
  agentType: string,
  cwd: string,
  toolNames: string[],
  forkContext: boolean
): Promise<SystemPrompt> {
  const segments: SystemPromptSegment[] = [];

  // Agent-specific prompt (identity + role + guidelines)
  const agentPrompt = getAgentPrompt(agentType, toolNames);

  // Static section: agent identity + tool instructions
  const staticText = [
    agentPrompt,
    toolInstructions(toolNames),
  ]
    .filter(Boolean)
    .join("\n\n");

  segments.push({ text: staticText, cacheHint: true });

  // Dynamic section: environment info
  // Forked agents also get CLAUDE.md since they operate in project context
  const dynamicParts: string[] = [];
  dynamicParts.push(await environmentSection(cwd));

  if (forkContext) {
    const claudeMd = await loadClaudeMdFiles(cwd);
    if (claudeMd) {
      dynamicParts.push(claudeMd);
    }
  }

  if (dynamicParts.length > 0) {
    segments.push({
      text: dynamicParts.join("\n\n"),
      cacheHint: true,
    });
  }

  return segments;
}

/**
 * Build a system prompt for a custom agent defined via markdown.
 *
 * Uses the agent's markdown body as the identity/role section,
 * plus tool instructions and (optionally) environment/CLAUDE.md context.
 */
export async function buildCustomAgentSystemPrompt(
  agent: AgentDefinition,
  cwd: string,
  toolNames: string[]
): Promise<SystemPrompt> {
  const segments: SystemPromptSegment[] = [];

  // Segment 1 (cached): agent's markdown body + tool instructions
  const staticText = [
    agent.systemPrompt,
    toolInstructions(toolNames),
  ]
    .filter(Boolean)
    .join("\n\n");

  segments.push({ text: staticText, cacheHint: true });

  // Segment 2 (cached): environment + CLAUDE.md (if forkContext)
  const dynamicParts: string[] = [];
  dynamicParts.push(await environmentSection(cwd));

  if (agent.forkContext !== false) {
    const claudeMd = await loadClaudeMdFiles(cwd);
    if (claudeMd) {
      dynamicParts.push(claudeMd);
    }
  }

  // Inject agent persistent memory if configured
  if (agent.memory) {
    const memoryContent = await loadAgentMemory(agent.name, agent.memory, cwd);
    if (memoryContent) {
      const memoryLines = memoryContent.split("\n").slice(0, 200);
      dynamicParts.push(`# Agent Memory\n${memoryLines.join("\n")}`);
    }
    // Add memory management instructions
    const { getAgentMemoryDir } = await import("../core/memory.js");
    const memDir = getAgentMemoryDir(agent.name, agent.memory, cwd);
    dynamicParts.push(
      `# Memory Management\nYou have persistent memory at ${memDir}. ` +
      `Save important findings to MEMORY.md using Write. Keep it under 200 lines. ` +
      `Your MEMORY.md is loaded at the start of each session.`
    );
  }

  if (dynamicParts.length > 0) {
    segments.push({
      text: dynamicParts.join("\n\n"),
      cacheHint: true,
    });
  }

  return segments;
}


async function checkIsGitRepo(cwd: string): Promise<boolean> {
  const { execFile } = await import("child_process");
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd },
      (error) => resolve(!error)
    );
  });
}
