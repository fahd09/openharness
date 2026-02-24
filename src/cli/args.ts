/**
 * CLI Argument Parsing — options, model resolution, and help text.
 */

import chalk from "chalk";
import { resolveModelAlias } from "../core/models.js";

export interface CliOptions {
  model: string;
  maxTurns?: number;
  prompt?: string;
  systemPrompt?: string;
  thinkingBudget?: number;
  permissionMode?: string;
  resume?: string;
  verbose: boolean;
}

export function getDefaultModel(): string {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (provider === "openai" || provider === "openai-compat" || provider === "openai_compat") {
    return process.env.OPENAI_MODEL || "gpt-4o";
  } else if (provider === "gemini") {
    return process.env.GEMINI_MODEL || "gemini-2.0-flash";
  }
  return "claude-sonnet-4-20250514";
}

export { resolveModelAlias as resolveModel } from "../core/models.js";

export function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    model: getDefaultModel(),
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--model":
      case "-m":
        opts.model = resolveModelAlias(args[++i] ?? "sonnet");
        break;
      case "--max-turns":
        opts.maxTurns = parseInt(args[++i], 10);
        break;
      case "-p":
      case "--prompt":
        opts.prompt = args[++i];
        break;
      case "--system-prompt":
        opts.systemPrompt = args[++i];
        break;
      case "--thinking-budget":
        opts.thinkingBudget = parseInt(args[++i], 10);
        break;
      case "--permission-mode":
        opts.permissionMode = args[++i];
        break;
      case "--resume":
      case "-r":
        opts.resume = args[++i];
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

export function printHelp(): void {
  console.log(`
${chalk.bold("openharness")} — AI-powered coding assistant with multi-provider support

${chalk.dim("Usage:")}
  npx tsx src/index.tsx [options]
  npx tsx src/index.tsx -p "your prompt here"

${chalk.dim("Options:")}
  -m, --model <model>        Model to use (opus/sonnet/haiku or full ID like gpt-4o)
  -p, --prompt <text>        One-shot mode: run prompt and exit
  --max-turns <n>            Max agentic turns per interaction
  --thinking-budget <n>      Extended thinking budget in tokens (min 1024)
  --permission-mode <mode>   Permission mode: default/acceptEdits/bypassPermissions/plan
  -r, --resume <id>          Resume a previous session by ID
  --system-prompt <text>     Custom system prompt override
  -v, --verbose              Verbose output
  -h, --help                 Show this help

${chalk.dim("Provider Selection (via environment):")}
  LLM_PROVIDER=anthropic     Use Anthropic Claude (default)
  LLM_PROVIDER=openai        Use OpenAI GPT models
  LLM_PROVIDER=openai-compat Use any OpenAI-compatible API
`);
}
