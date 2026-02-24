/**
 * /agents — Interactive agent management with creation wizard.
 *
 * Main list shows:
 *   [+ Create new agent]
 *   Custom agents (project / user) — selectable
 *   Built-in agents — disabled (for discoverability)
 *
 * Creation wizard follows Claude Code's flow:
 *   Location → Method → (generate or manual steps) → confirm → save
 */

import chalk from "chalk";
import { join } from "path";
import { homedir } from "os";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import { listAgents, writeAgentFile, loadAgents } from "../core/agents.js";
import type { ListItem } from "../ui/components/list-selector.js";
import type { WizardStep } from "../ui/state.js";

// ── Wizard step helper ──────────────────────────────────────────────

function showWizardStep(
  ctx: CommandContext,
  step: WizardStep,
  title: string,
): Promise<string | string[] | null> {
  return new Promise((resolve) => {
    ctx.dispatch!({ type: "WIZARD_STEP", step, title, resolve });
  });
}

// ── List-select helper (reuses existing LIST_SELECT_START) ──────────

function showListSelect(
  ctx: CommandContext,
  items: ListItem[],
  header: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    ctx.dispatch!({ type: "LIST_SELECT_START", items, header, resolve });
  });
}

// ── Built-in agent definitions ──────────────────────────────────────

const BUILT_IN_AGENTS = [
  { name: "Bash", description: "Command execution specialist" },
  { name: "Explore", description: "Codebase exploration (Glob, Grep, Read, Bash)" },
  { name: "general-purpose", description: "General-purpose agent with all tools" },
  { name: "security-review", description: "Security audit with read-only git access" },
];

// ── Tool categories for multiselect ─────────────────────────────────

const TOOL_CATEGORIES = [
  { id: "_all_", label: "All tools" },
  { id: "Read", label: "Read" },
  { id: "Write", label: "Write" },
  { id: "Edit", label: "Edit" },
  { id: "Glob", label: "Glob" },
  { id: "Grep", label: "Grep" },
  { id: "Bash", label: "Bash" },
  { id: "WebFetch", label: "WebFetch" },
  { id: "WebSearch", label: "WebSearch" },
  { id: "Task", label: "Task" },
  { id: "NotebookEdit", label: "NotebookEdit" },
];

// ── Command ─────────────────────────────────────────────────────────

export const agentsCommand: SlashCommand = {
  name: "agents",
  description: "Manage agents — list, create, view",
  category: "tools",

  async execute(_args, ctx) {
    const output = ctx.output ?? console.log;

    // If no dispatch, fall back to static list
    if (!ctx.dispatch) {
      const custom = listAgents();
      output(chalk.bold("\nAgents:"));
      for (const a of BUILT_IN_AGENTS) {
        output(`  ${chalk.cyan(a.name)} — ${a.description}`);
      }
      for (const a of custom) {
        output(`  ${chalk.cyan(a.name)} — ${a.description} ${chalk.dim(`(${a.source})`)}`);
      }
      output();
      return true;
    }

    // ── Main list ─────────────────────────────────────────────────
    await showMainList(ctx, output);
    return true;
  },
};

async function showMainList(ctx: CommandContext, output: (text: string) => void): Promise<void> {
  // Reload agents to pick up any changes
  await loadAgents(ctx.cwd);
  const custom = listAgents();

  const items: ListItem[] = [];

  // Create action
  items.push({
    id: "__create__",
    label: "+ Create new agent",
    description: "Set up a new custom agent",
    group: "Actions",
  });

  // Custom agents — project level
  const projectDir = join(ctx.cwd, ".openharness", "agents");
  const projectAgents = custom.filter((a) => a.source.startsWith(projectDir));
  for (const a of projectAgents) {
    items.push({
      id: `custom:${a.name}`,
      label: a.name,
      description: a.description,
      group: "Project agents",
      badge: a.model,
    });
  }

  // Custom agents — user level
  const userDir = join(homedir(), ".openharness", "agents");
  const userAgents = custom.filter((a) => a.source.startsWith(userDir));
  for (const a of userAgents) {
    items.push({
      id: `custom:${a.name}`,
      label: a.name,
      description: a.description,
      group: "User agents",
      badge: a.model,
    });
  }

  // Built-in (disabled)
  for (const a of BUILT_IN_AGENTS) {
    items.push({
      id: `builtin:${a.name}`,
      label: a.name,
      description: a.description,
      group: "Built-in (always available)",
      disabled: true,
    });
  }

  const selected = await showListSelect(ctx, items, "Agents");

  if (!selected) return; // Esc

  if (selected === "__create__") {
    await runCreateWizard(ctx, output);
    return;
  }

  if (selected.startsWith("custom:")) {
    const name = selected.slice("custom:".length);
    const agent = custom.find((a) => a.name === name);
    if (agent) {
      output(chalk.bold(`\n  Agent: ${chalk.cyan(agent.name)}`));
      output(`  ${chalk.dim("Description:")} ${agent.description}`);
      output(`  ${chalk.dim("Source:")} ${agent.source}`);
      if (agent.model) output(`  ${chalk.dim("Model:")} ${agent.model}`);
      if (agent.tools) output(`  ${chalk.dim("Tools:")} ${agent.tools.join(", ")}`);
      if (agent.memory) output(`  ${chalk.dim("Memory:")} ${agent.memory}`);
      output(`  ${chalk.dim("System prompt:")} ${agent.systemPrompt.slice(0, 120)}${agent.systemPrompt.length > 120 ? "..." : ""}`);
      output("");
    }
  }
}

// ── Creation Wizard ─────────────────────────────────────────────────

async function runCreateWizard(ctx: CommandContext, output: (text: string) => void): Promise<void> {
  const TITLE = "Create new agent";

  // Step 1: Location
  const location = await showWizardStep(ctx, {
    type: "select",
    header: "Where should this agent be saved?",
    items: [
      { id: "project", label: "Project", description: `.openharness/agents/ (${ctx.cwd})` },
      { id: "user", label: "Personal", description: `~/.openharness/agents/` },
    ],
  }, TITLE);

  if (!location || typeof location !== "string") return;

  const dir = location === "project"
    ? join(ctx.cwd, ".openharness", "agents")
    : join(homedir(), ".openharness", "agents");

  // Step 2: Method
  const method = await showWizardStep(ctx, {
    type: "select",
    header: "How do you want to create this agent?",
    items: [
      { id: "generate", label: "Generate with Claude", description: "Describe what it should do" },
      { id: "manual", label: "Manual configuration", description: "Step-by-step setup" },
    ],
  }, TITLE);

  if (!method || typeof method !== "string") return;

  if (method === "generate") {
    await runGeneratePath(ctx, dir, output);
  } else {
    await runManualPath(ctx, dir, output);
  }
}

// ── Generate Path ───────────────────────────────────────────────────

async function runGeneratePath(ctx: CommandContext, dir: string, output: (text: string) => void): Promise<void> {
  const TITLE = "Create new agent \u2014 Generate";

  const description = await showWizardStep(ctx, {
    type: "text",
    header: "Describe what this agent should do",
    subtitle: "Be specific about its role, tools it needs, and constraints.",
    placeholder: "e.g. A database query agent that only runs SELECT statements...",
  }, TITLE);

  if (!description || typeof description !== "string") return;

  output(chalk.dim("\n  Generating agent with Claude...\n"));

  const prompt = `Create an agent definition for the following description. Output ONLY the markdown file content with YAML frontmatter, nothing else. The format is:

---
name: <kebab-case identifier>
description: <one-line description of when to use this agent>
tools: [<list of tool names like "Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit">]
model: <sonnet or haiku or opus>
memory: <user or project or local, if needed>
---

<system prompt text — detailed instructions for the agent>

Description: ${description}`;

  try {
    const result = await ctx.runPrompt(prompt);
    if (result) {
      // Extract the markdown block if wrapped in code fences
      let content = result;
      const fenceMatch = content.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
      if (fenceMatch) content = fenceMatch[1];

      // Parse to validate and extract name
      const { parseAgentFile } = await import("../core/agents.js");
      const parsed = parseAgentFile(content.trim(), "");
      if (parsed) {
        const filePath = await writeAgentFile(dir, {
          name: parsed.name,
          description: parsed.description,
          systemPrompt: parsed.systemPrompt,
          tools: parsed.tools,
          model: parsed.model,
          memory: parsed.memory,
        });
        output(chalk.green(`\n  Agent "${parsed.name}" saved to ${filePath}\n`));
      } else {
        output(chalk.red("\n  Failed to parse generated agent. Please try manual creation.\n"));
      }
    }
  } catch (err) {
    output(chalk.red(`\n  Generation failed: ${err}\n`));
  }
}

// ── Manual Path ─────────────────────────────────────────────────────

async function runManualPath(ctx: CommandContext, dir: string, output: (text: string) => void): Promise<void> {
  const TITLE = "Create new agent \u2014 Manual";

  // Step 3b: Name
  const name = await showWizardStep(ctx, {
    type: "text",
    header: "Agent name",
    subtitle: "Unique kebab-case identifier (e.g. db-reader, code-reviewer)",
    placeholder: "my-agent",
  }, TITLE);

  if (!name || typeof name !== "string") return;

  // Step 4: System prompt
  const systemPrompt = await showWizardStep(ctx, {
    type: "text",
    header: "System prompt",
    subtitle: "Instructions that define this agent's behavior",
    placeholder: "You are a specialist that...",
    multiline: true,
  }, TITLE);

  if (!systemPrompt || typeof systemPrompt !== "string") return;

  // Step 5: Description
  const description = await showWizardStep(ctx, {
    type: "text",
    header: "Description",
    subtitle: "When should Claude use this agent? (shown in agent picker)",
    placeholder: "Use for database queries and schema exploration",
  }, TITLE);

  if (!description || typeof description !== "string") return;

  // Step 6: Tools
  const toolsResult = await showWizardStep(ctx, {
    type: "multiselect",
    header: "Select tools this agent can use",
    subtitle: "Space to toggle, Enter to continue (empty = all tools)",
    items: TOOL_CATEGORIES.map((t) => ({ id: t.id, label: t.label })),
  }, TITLE);

  if (toolsResult === null) return;

  let tools: string[] | undefined;
  const selectedTools = toolsResult as string[];
  if (selectedTools.length > 0 && !selectedTools.includes("_all_")) {
    tools = selectedTools;
  }

  // Step 7: Model
  const model = await showWizardStep(ctx, {
    type: "select",
    header: "Model",
    items: [
      { id: "sonnet", label: "Sonnet", description: "Fast, capable (default)" },
      { id: "opus", label: "Opus", description: "Most capable" },
      { id: "haiku", label: "Haiku", description: "Fastest, lightest" },
      { id: "", label: "Inherit from parent", description: "Use whatever model the user has set" },
    ],
  }, TITLE);

  if (model === null) return;

  // Step 8: Memory
  const memory = await showWizardStep(ctx, {
    type: "select",
    header: "Memory scope",
    subtitle: "Where should this agent store persistent notes?",
    items: [
      { id: "", label: "None", description: "No persistent memory" },
      { id: "user", label: "User", description: "Shared across all projects" },
      { id: "project", label: "Project", description: "Scoped to this project" },
      { id: "local", label: "Local", description: "Scoped to this checkout" },
    ],
  }, TITLE);

  if (memory === null) return;

  // Step 9: Confirmation
  const summaryLines = [
    `${chalk.dim("Name:")}         ${chalk.cyan(name as string)}`,
    `${chalk.dim("Description:")}  ${description as string}`,
    `${chalk.dim("Tools:")}        ${tools ? tools.join(", ") : chalk.dim("all")}`,
    `${chalk.dim("Model:")}        ${(model as string) || chalk.dim("inherit")}`,
    `${chalk.dim("Memory:")}       ${(memory as string) || chalk.dim("none")}`,
    `${chalk.dim("Location:")}     ${dir}`,
    "",
    `${chalk.dim("System prompt:")}`,
    `  ${(systemPrompt as string).slice(0, 200)}${(systemPrompt as string).length > 200 ? "..." : ""}`,
  ];

  const action = await showWizardStep(ctx, {
    type: "confirm",
    header: "Review agent configuration",
    lines: summaryLines,
    actions: [
      { key: "s", label: "save" },
      { key: "Enter", label: "save" },
    ],
  }, TITLE);

  if (!action) return; // Esc = cancel

  // Save
  try {
    const filePath = await writeAgentFile(dir, {
      name: name as string,
      description: description as string,
      systemPrompt: systemPrompt as string,
      tools,
      model: (model as string) || undefined,
      memory: (memory as string) || undefined,
    });

    output(chalk.green(`\n  Agent "${name}" saved to ${filePath}\n`));
  } catch (err) {
    output(chalk.red(`\n  Failed to save agent: ${err}\n`));
  }
}
