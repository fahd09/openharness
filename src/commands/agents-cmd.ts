import chalk from "chalk";
import type { SlashCommand } from "../core/commands.js";
import { listAgents } from "../core/agents.js";

export const agentsCommand: SlashCommand = {
  name: "agents",
  description: "List available agents (built-in and custom)",
  category: "info",

  async execute(_args, ctx) {
    const output = ctx.output ?? console.log;
    // Built-in agents
    const builtIn = [
      { name: "Bash", description: "Command execution specialist" },
      { name: "Explore", description: "Codebase exploration (Glob, Grep, Read, Bash)" },
      { name: "general-purpose", description: "General-purpose agent with all tools" },
      { name: "security-review", description: "Security audit with read-only git access" },
    ];

    output(chalk.bold("\nBuilt-in Agents:"));
    for (const agent of builtIn) {
      output(`  ${chalk.cyan(agent.name)} — ${agent.description}`);
    }

    // Custom agents
    const custom = listAgents();
    if (custom.length > 0) {
      output(chalk.bold("\nCustom Agents:"));
      for (const agent of custom) {
        const meta: string[] = [];
        if (agent.model) meta.push(`model: ${agent.model}`);
        if (agent.tools) meta.push(`tools: ${agent.tools.join(", ")}`);
        if (agent.memory) meta.push(`memory: ${agent.memory}`);
        const metaStr = meta.length > 0 ? chalk.dim(` (${meta.join(", ")})`) : "";
        output(`  ${chalk.cyan(agent.name)} — ${agent.description}${metaStr}`);
        output(chalk.dim(`    source: ${agent.source}`));
      }
    } else {
      output(chalk.dim("\nNo custom agents loaded. Create .openharness/agents/*.md to add custom agents."));
    }

    output();
    return true;
  },
};
