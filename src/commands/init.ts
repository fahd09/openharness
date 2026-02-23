/**
 * /init command — Initialize CLAUDE.md for the current project.
 *
 * Scans the project directory for common files (package.json, tsconfig.json,
 * Cargo.toml, etc.) and generates a starter CLAUDE.md with project context.
 */

import chalk from "chalk";
import { readFile, writeFile, access, constants } from "fs/promises";
import { join, basename } from "path";
import type { SlashCommand, CommandContext } from "../core/commands.js";

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

function generateClaudeMd(signals: ProjectSignals): string {
  const sections: string[] = [];

  sections.push(`# CLAUDE.md`);
  sections.push("");
  sections.push(`This file provides guidance to Claude Code when working with code in this repository.`);
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

export const initCommand: SlashCommand = {
  name: "init",
  description: "Initialize CLAUDE.md for current project",
  category: "other",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const claudeMdPath = join(ctx.cwd, "CLAUDE.md");

    // Check if CLAUDE.md already exists
    try {
      await access(claudeMdPath, constants.R_OK);
      console.log(chalk.yellow("CLAUDE.md already exists in this directory."));
      console.log(chalk.dim("  Use your editor to modify it, or delete it first to regenerate."));
      return true;
    } catch {
      // File doesn't exist — good, we'll create it
    }

    const signals = await detectProject(ctx.cwd);
    const content = generateClaudeMd(signals);

    await writeFile(claudeMdPath, content, "utf-8");
    console.log(chalk.green("Created CLAUDE.md"));
    console.log(chalk.dim(`  Detected: ${signals.language ?? "unknown language"}${signals.framework ? ` / ${signals.framework}` : ""}`));
    console.log(chalk.dim("  Edit the file to add project-specific instructions for Claude."));

    return true;
  },
};
