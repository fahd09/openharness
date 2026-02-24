/**
 * /init command — Initialize provider-aware context files for the current project.
 *
 * Scans the project directory for common files (package.json, tsconfig.json,
 * Cargo.toml, etc.) and generates a starter context file with project context.
 *
 * Usage:
 *   /init       — Generate context file for the active provider
 *   /init all   — Generate context files for all configured providers
 */

import chalk from "chalk";
import { readFile, writeFile, access, constants } from "fs/promises";
import { join, basename } from "path";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import { getContextFileMap, resolveContextFileName } from "../core/settings.js";

interface ProjectSignals {
  name: string;
  language?: string;
  framework?: string;
  buildCmd?: string;
  testCmd?: string;
  devCmd?: string;
  hasTests: boolean;
  hasLinter: boolean;
}

/** Human-readable labels for providers. */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI-compatible agents",
  gemini: "Gemini",
};

/** Provider-specific description lines for the generated file header. */
const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  anthropic: "This file provides guidance to Claude Code when working with code in this repository.",
  openai: "This file provides guidance to OpenAI-compatible coding agents when working with code in this repository.",
  gemini: "This file provides guidance to Gemini-based coding agents when working with code in this repository.",
};

async function detectProject(cwd: string): Promise<ProjectSignals> {
  const signals: ProjectSignals = {
    name: basename(cwd),
    hasTests: false,
    hasLinter: false,
  };

  // Check package.json
  try {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8"));
    signals.name = pkg.name ?? signals.name;
    signals.language = "TypeScript/JavaScript";

    if (pkg.scripts) {
      if (pkg.scripts.build) signals.buildCmd = `npm run build`;
      if (pkg.scripts.test) {
        signals.testCmd = `npm test`;
        signals.hasTests = true;
      }
      if (pkg.scripts.dev) signals.devCmd = `npm run dev`;
      if (pkg.scripts.start && !signals.devCmd) signals.devCmd = `npm start`;
      if (pkg.scripts.lint) signals.hasLinter = true;
    }

    // Detect framework
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) signals.framework = "Next.js";
    else if (deps.react) signals.framework = "React";
    else if (deps.vue) signals.framework = "Vue";
    else if (deps.svelte) signals.framework = "Svelte";
    else if (deps.express) signals.framework = "Express";
    else if (deps.fastify) signals.framework = "Fastify";
  } catch {}

  // Check for TypeScript
  try {
    await access(join(cwd, "tsconfig.json"), constants.R_OK);
    signals.language = "TypeScript";
  } catch {}

  // Check for Python
  try {
    await access(join(cwd, "pyproject.toml"), constants.R_OK);
    signals.language = "Python";
    signals.testCmd = signals.testCmd ?? "pytest";
    signals.hasTests = true;
  } catch {}

  try {
    await access(join(cwd, "requirements.txt"), constants.R_OK);
    if (!signals.language) signals.language = "Python";
  } catch {}

  // Check for Rust
  try {
    await access(join(cwd, "Cargo.toml"), constants.R_OK);
    signals.language = "Rust";
    signals.buildCmd = "cargo build";
    signals.testCmd = "cargo test";
    signals.hasTests = true;
  } catch {}

  // Check for Go
  try {
    await access(join(cwd, "go.mod"), constants.R_OK);
    signals.language = "Go";
    signals.buildCmd = "go build ./...";
    signals.testCmd = "go test ./...";
    signals.hasTests = true;
  } catch {}

  return signals;
}

function generateContextFile(fileName: string, provider: string, signals: ProjectSignals): string {
  const sections: string[] = [];

  // Use the filename (without .md) as the header
  const headerName = fileName.replace(/\.md$/i, "");
  sections.push(`# ${headerName}`);
  sections.push("");
  sections.push(PROVIDER_DESCRIPTIONS[provider] ?? `This file provides guidance to coding agents when working with code in this repository.`);
  sections.push("");

  // Project overview
  sections.push(`## Project Overview`);
  sections.push("");
  sections.push(`${signals.name}${signals.language ? ` — a ${signals.language} project` : ""}${signals.framework ? ` using ${signals.framework}` : ""}.`);
  sections.push("");

  // Commands
  sections.push(`## Commands`);
  sections.push("");
  sections.push("```bash");
  if (signals.buildCmd) sections.push(`${signals.buildCmd}    # Build the project`);
  if (signals.testCmd) sections.push(`${signals.testCmd}    # Run tests`);
  if (signals.devCmd) sections.push(`${signals.devCmd}    # Start development server`);
  if (!signals.buildCmd && !signals.testCmd && !signals.devCmd) {
    sections.push("# Add your common commands here");
  }
  sections.push("```");
  sections.push("");

  // Architecture
  sections.push(`## Architecture`);
  sections.push("");
  sections.push(`<!-- Describe the key directories and files in your project -->`);
  sections.push("");

  // Conventions
  sections.push(`## Conventions`);
  sections.push("");
  sections.push(`<!-- Describe coding conventions, patterns, and preferences -->`);
  sections.push("");

  return sections.join("\n");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a context file for a single provider.
 * Returns true if the file was created, false if it already existed.
 */
async function generateForProvider(
  provider: string,
  fileName: string,
  cwd: string,
  signals: ProjectSignals,
  output: (text: string) => void
): Promise<boolean> {
  const filePath = join(cwd, fileName);

  if (await fileExists(filePath)) {
    output(chalk.yellow(`  ${fileName} already exists — skipped`));
    return false;
  }

  const content = generateContextFile(fileName, provider, signals);
  await writeFile(filePath, content, "utf-8");

  const label = PROVIDER_LABELS[provider] ?? provider;
  output(chalk.green(`  Created ${fileName}`) + chalk.dim(` (${label})`));
  return true;
}

export const initCommand: SlashCommand = {
  name: "init",
  description: "Initialize context file(s) for current project",
  category: "other",
  completions: ["all"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const signals = await detectProject(ctx.cwd);
    const generateAll = args.trim().toLowerCase() === "all";

    if (generateAll) {
      // Generate context files for all configured providers
      const contextFileMap = await getContextFileMap(ctx.cwd);

      // Deduplicate by filename (multiple providers may map to the same file)
      const seen = new Set<string>();
      const entries: Array<{ provider: string; fileName: string }> = [];
      for (const [provider, fileName] of Object.entries(contextFileMap)) {
        if (!seen.has(fileName)) {
          seen.add(fileName);
          entries.push({ provider, fileName });
        }
      }

      output(chalk.bold("\n  Initializing context files for all providers"));
      output(chalk.dim("  " + "─".repeat(40)));

      let created = 0;
      for (const { provider, fileName } of entries) {
        if (await generateForProvider(provider, fileName, ctx.cwd, signals, output)) {
          created++;
        }
      }

      output("");
      if (created === 0) {
        output(chalk.dim("  All context files already exist. Delete them first to regenerate."));
      } else {
        output(chalk.dim(`  Detected: ${signals.language ?? "unknown language"}${signals.framework ? ` / ${signals.framework}` : ""}`));
        output(chalk.dim("  Edit these files to add project-specific instructions for each provider."));
      }
    } else {
      // Generate for current provider only
      const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
      const fileName = await resolveContextFileName(provider, ctx.cwd);
      const filePath = join(ctx.cwd, fileName);

      if (await fileExists(filePath)) {
        output(chalk.yellow(`${fileName} already exists in this directory.`));
        output(chalk.dim("  Use your editor to modify it, or delete it first to regenerate."));
        output(chalk.dim("  Tip: Use /init all to generate context files for all providers."));
        return true;
      }

      const content = generateContextFile(fileName, provider, signals);
      await writeFile(filePath, content, "utf-8");

      const label = PROVIDER_LABELS[provider] ?? provider;
      output(chalk.green(`Created ${fileName}`) + chalk.dim(` (${label})`));
      output(chalk.dim(`  Detected: ${signals.language ?? "unknown language"}${signals.framework ? ` / ${signals.framework}` : ""}`));
      output(chalk.dim("  Edit the file to add project-specific instructions."));
      output(chalk.dim("  Tip: Use /init all to generate context files for all providers."));
    }

    output("");
    return true;
  },
};
