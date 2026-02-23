import { platform, arch } from "os";
import { loadClaudeMdFiles } from "./claude-md.js";
import { getAgentPrompt } from "./agent-prompts.js";
import { loadMemory, loadAgentMemory } from "../core/memory.js";
import { getStylePrompt } from "../core/output-style.js";
import type { SystemPrompt, SystemPromptSegment } from "../core/types.js";
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
): Promise<SystemPrompt> {
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

  return segments;
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
): Promise<SystemPrompt> {
  const registrations = pluginManager.getPromptSegments();
  const buildCtx = { cwd, toolNames };

  // Group by position
  const groups: Record<PromptSegmentPosition, string[]> = {
    static: [],
    dynamic: [],
    volatile: [],
  };

  for (const reg of registrations) {
    const text = await reg.content(buildCtx);
    if (text) {
      groups[reg.position].push(text);
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

  return segments;
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

  const parts = [envLines.join("\n")];

  const cliTools = await cliToolsSection();
  if (cliTools) {
    parts.push(cliTools);
  }

  return parts.join("\n\n");
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

// ── CLI Tool Definitions ──────────────────────────────────────────────
// Each entry defines: command name, description, and usage examples.
// Written explicitly for lower-grade model tolerance — no ambiguity.

interface CliToolDef {
  command: string;
  description: string;
  examples: string[];
  notes?: string;
}

const CLI_TOOLS: CliToolDef[] = [
  {
    command: "rg",
    description:
      "ripgrep — extremely fast text search across files. Respects .gitignore. Use instead of grep.",
    examples: [
      'rg "TODO" --type ts                    # Find all TODO comments in TypeScript files',
      'rg "function.*export" src/             # Find exported functions in src/',
      'rg -l "import.*React" --type tsx        # List files that import React',
      'rg "class\\s+\\w+Service" -n            # Find service class definitions with line numbers',
      'rg "password" --type-not test           # Search for "password" excluding test files',
    ],
    notes:
      "Prefer rg over grep for speed and .gitignore awareness. Use --type for language filtering. Use -l for file names only.",
  },
  {
    command: "fd",
    description:
      "fd — fast file finder. Respects .gitignore. Use instead of find.",
    examples: [
      "fd .ts src/                             # Find all .ts files under src/",
      'fd -e json                              # Find all JSON files in current directory',
      'fd "test" --type f                      # Find files with "test" in their name',
      'fd -e ts -x wc -l                      # Count lines in each TypeScript file',
      'fd "config" --hidden                    # Find config files including hidden ones',
    ],
    notes:
      "Prefer fd over find for speed and simpler syntax. Use -e for extension filtering. Use --type f for files only, --type d for directories only.",
  },
  {
    command: "fzf",
    description:
      "fzf — fuzzy finder for interactive selection. Pipe any list into it for filtering.",
    examples: [
      "fd -e ts | fzf                          # Interactively pick a TypeScript file",
      "rg -l TODO | fzf                        # Pick from files containing TODOs",
      "git branch | fzf                        # Interactively select a branch",
      'git log --oneline | fzf                 # Pick a commit interactively',
    ],
    notes:
      "fzf is most useful when piping results from other commands. It requires interactive terminal — avoid using it in non-interactive scripts.",
  },
  {
    command: "jq",
    description:
      "jq — JSON processor. Parse, filter, and transform JSON on the command line.",
    examples: [
      "cat package.json | jq '.dependencies'   # Extract dependencies object",
      "jq '.scripts | keys' package.json       # List all script names",
      "jq '.[] | .name' data.json              # Extract name from each array element",
      'jq -r \'.items[] | "\\(.id): \\(.title)"\' response.json  # Format output',
      "curl -s api.example.com | jq '.data'    # Parse API JSON response",
    ],
    notes:
      "Use jq for any JSON manipulation. Use -r for raw (unquoted) string output. Pipe JSON from curl, cat, or any command.",
  },
  {
    command: "yq",
    description:
      "yq — YAML/XML processor. Like jq but for YAML files.",
    examples: [
      "yq '.services' docker-compose.yml       # Extract services from compose file",
      "yq '.spec.containers[0].image' pod.yaml  # Get container image from K8s manifest",
      "yq -i '.version = \"2.0\"' config.yaml    # Edit YAML file in place",
    ],
    notes:
      "Use yq for YAML/XML. Syntax is similar to jq. Use -i for in-place editing.",
  },
  {
    command: "ast-grep",
    description:
      "ast-grep — syntax-aware code search and refactoring. Searches by AST structure, not text patterns. More precise than rg for code patterns.",
    examples: [
      'ast-grep --lang ts --pattern "async function $NAME($$$ARGS)" # Find all async function declarations',
      'ast-grep --lang ts --pattern "console.log($$$)"              # Find all console.log calls',
      'ast-grep --lang tsx --pattern "<$TAG onClick={$$$}>$$$</$TAG>" # Find elements with onClick',
      'ast-grep --lang python --pattern "def $NAME(self, $$$):"     # Find Python instance methods',
      'ast-grep --lang ts --pattern "import { $$$ } from \'react\'"   # Find React imports',
    ],
    notes:
      "WHEN TO USE ast-grep vs rg:\n- Use ast-grep for STRUCTURAL code queries (find async functions, find React components, find class methods) — it understands syntax trees\n- Use rg for PLAIN TEXT searches (find TODOs, find string literals, find comments) — it is faster for simple patterns\n- ast-grep supports: --lang ts, --lang tsx, --lang python, --lang rust, --lang go, --lang java, and more\n- $NAME matches a single identifier, $$$ matches multiple arguments/items",
  },
  {
    command: "bat",
    description:
      "bat — better cat with syntax highlighting and line numbers.",
    examples: [
      "bat src/index.ts                         # Display file with syntax highlighting",
      "bat -r 10:20 src/index.ts                # Show lines 10-20 only",
      "bat --diff file1.ts file2.ts             # Show diff between two files",
      "bat -l json <<< '{\"key\": \"value\"}'       # Highlight piped JSON",
    ],
    notes:
      "Use bat instead of cat when you want syntax-highlighted output. Use -r for line ranges. Use -l to specify language for piped input.",
  },
  {
    command: "git",
    description:
      "git — version control. Required for repository operations.",
    examples: [
      "git status                               # Show working tree status",
      "git diff --staged                        # Show staged changes",
      "git log --oneline -10                    # Show last 10 commits",
      "git blame src/index.ts                   # Show who changed each line",
      "git stash && git pull && git stash pop   # Pull changes safely",
    ],
    notes:
      "Always check git status before making changes. Use git diff to review before committing. Never force-push without explicit user approval.",
  },
  {
    command: "delta",
    description:
      "delta — enhanced git diff viewer with syntax highlighting and side-by-side view.",
    examples: [
      "git diff | delta                         # View diff with enhanced formatting",
      "git log -p | delta                       # View commit diffs with delta",
      "delta file1.ts file2.ts                  # Compare two files directly",
    ],
    notes:
      "If configured as git pager, delta is used automatically with git diff/log. Otherwise pipe git output to delta.",
  },
  {
    command: "gh",
    description:
      "gh — GitHub CLI for interacting with GitHub from the terminal.",
    examples: [
      "gh pr list                               # List open pull requests",
      "gh pr create --title 'Fix bug' --body 'Details...'  # Create PR",
      "gh issue list --label bug                # List bug issues",
      "gh pr view 123                           # View PR #123 details",
      "gh pr checks                             # View CI status for current PR",
      "gh api repos/owner/repo/pulls/123/comments  # Read PR comments via API",
    ],
    notes:
      "Use gh for ALL GitHub operations (PRs, issues, releases, checks). Prefer gh over curl for GitHub API calls. Requires authentication via gh auth login.",
  },
];

/**
 * Detect which CLI tools are installed and generate a system prompt section
 * with descriptions and usage examples for each available tool.
 *
 * This section is designed for maximum clarity — examples are concrete and
 * explicit, so even lower-capability models understand how to use each tool.
 */
async function cliToolsSection(): Promise<string | null> {
  const available: CliToolDef[] = [];

  // Check which tools are installed (in parallel)
  const checks = await Promise.all(
    CLI_TOOLS.map(async (tool) => ({
      tool,
      installed: await isCommandAvailable(tool.command),
    }))
  );

  for (const { tool, installed } of checks) {
    if (installed) {
      available.push(tool);
    }
  }

  if (available.length === 0) return null;

  const lines: string[] = [
    "# Available CLI Tools",
    "",
    "The following CLI tools are installed and available for use via the Bash tool.",
    "Use these tools when they are the right fit — they are faster and more capable than manual alternatives.",
    "",
  ];

  for (const tool of available) {
    lines.push(`## ${tool.command}`);
    lines.push(tool.description);
    lines.push("");
    lines.push("Examples:");
    lines.push("```");
    for (const example of tool.examples) {
      lines.push(example);
    }
    lines.push("```");
    if (tool.notes) {
      lines.push("");
      lines.push(tool.notes);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function isCommandAvailable(command: string): Promise<boolean> {
  const { execFile } = await import("child_process");
  return new Promise((resolve) => {
    execFile("which", [command], (error) => resolve(!error));
  });
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
