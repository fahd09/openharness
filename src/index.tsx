#!/usr/bin/env npx tsx
import "dotenv/config"; // Load .env before anything else
import * as readline from "readline";
import chalk from "chalk";
import React, { createRef } from "react";
import { render } from "ink";
import {
  ToolRegistry,
  type Tool,
  type PermissionRequest,
  type PermissionResult,
} from "./tools/tool-registry.js";
import * as builtinTools from "./tools/all.js";
import { createTaskTool } from "./tools/task.js";
import { agentLoop } from "./core/agent-loop.js";
import { buildSystemPrompt } from "./prompt/system-prompt.js";
import type { ConversationMessage, SystemPrompt } from "./core/types.js";
import { CostTracker, formatCost } from "./core/cost.js";
import { renderMarkdown } from "./core/markdown.js";
import {
  resolvePermissionMode,
  createPermissionWrapper,
  loadProjectPermissions,
  type PermissionMode,
} from "./core/permission-modes.js";
import {
  newSessionId,
  saveSession,
  loadSession,
} from "./core/session.js";
import { loadHooksFromConfig, executeHooks } from "./core/hooks.js";
import {
  loadSkills,
  listSkills,
  getSkill,
  preprocessSkillContent,
  markSkillInvoked,
  isSkillInvokedOnce,
} from "./core/skills.js";
import { loadAgents } from "./core/agents.js";
import { uuid, timestamp } from "./utils.js";
import { createCommandRegistry } from "./commands/index.js";
import type { CommandContext } from "./core/commands.js";
import { FileChangeTracker } from "./core/file-tracker.js";
import { getFileHistory } from "./core/file-history.js";
import { getSuggestions } from "./core/suggestions.js";
import { initializeMcpServers, disconnectMcpServers } from "./core/mcp/index.js";
import { getPluginManager } from "./core/plugins/index.js";
import { isImagePath, loadImageAsBlock, detectImagePaths } from "./core/image.js";
import { readFile } from "fs/promises";
import { App, type AppHandle } from "./ui/components/app.js";
import { EventBridge } from "./ui/event-bridge.js";
import { startCapture, stopCapture } from "./ui/console-capture.js";
import type { TextInputProps } from "./ui/components/text-input.js";
import { icons } from "./ui/theme.js";

// ── CLI Argument Parsing (same as legacy) ──────────────────────────

interface CliOptions {
  model: string;
  maxTurns?: number;
  prompt?: string;
  systemPrompt?: string;
  thinkingBudget?: number;
  permissionMode?: string;
  resume?: string;
  verbose: boolean;
}

function getDefaultModel(): string {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (provider === "openai" || provider === "openai-compat" || provider === "openai_compat") {
    return process.env.OPENAI_MODEL || "gpt-4o";
  }
  return "claude-sonnet-4-20250514";
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    model: getDefaultModel(),
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--model":
      case "-m":
        opts.model = resolveModel(args[++i] ?? "sonnet");
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

function resolveModel(input: string): string {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

  const anthropicAliases: Record<string, string> = {
    opus: "claude-opus-4-20250514",
    sonnet: "claude-sonnet-4-20250514",
    haiku: "claude-haiku-4-5-20251001",
  };

  const openaiAliases: Record<string, string> = {
    "4o": "gpt-4o",
    "4o-mini": "gpt-4o-mini",
    "4-turbo": "gpt-4-turbo",
  };

  if (provider === "openai" || provider === "openai-compat" || provider === "openai_compat") {
    return openaiAliases[input] ?? input;
  }

  return anthropicAliases[input] ?? input;
}

function printHelp(): void {
  console.log(`
${chalk.bold("claude-code-core")} — AI-powered coding assistant with multi-provider support

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

// ── Shared Setup ──────────────────────────────────────────────────

function createToolRegistry(model: string): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of Object.values(builtinTools)) {
    if (tool && typeof tool === "object" && "name" in tool) {
      registry.register(tool as Tool);
    }
  }
  registry.register(createTaskTool(registry, model));
  return registry;
}

function resolveThinkingBudget(cliValue?: number): number | undefined {
  if (cliValue !== undefined && !isNaN(cliValue) && cliValue >= 1024) {
    return cliValue;
  }
  const envVal = process.env.CLAUDE_CODE_THINKING_BUDGET;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 1024) return parsed;
  }
  return undefined;
}

// ── Permission Prompt ────────────────────────────────────────────

/**
 * Creates a permission prompt for pipe/one-shot mode (uses temporary readline).
 */
function createPipePermissionPrompt(): (
  request: PermissionRequest
) => Promise<PermissionResult> {
  const approvedTools = new Set<string>();

  return (request: PermissionRequest): Promise<PermissionResult> => {
    if (approvedTools.has(request.toolName)) {
      return Promise.resolve("allow");
    }

    return new Promise((resolve) => {
      const promptText =
        chalk.dim("  Allow? ") +
        chalk.bold("[y]es / [n]o / allow [t]ool / [a]llow all: ");

      process.stdout.write(promptText);
      const tempRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      tempRl.once("line", (answer) => {
        tempRl.close();
        const a = answer.trim().toLowerCase();
        switch (a) {
          case "y": case "yes": resolve("allow"); break;
          case "t": case "tool": approvedTools.add(request.toolName); resolve("allow"); break;
          case "a": case "allow": case "allow all": resolve("allow_all"); break;
          case "n": case "no": resolve("deny"); break;
          default: resolve("allow"); break;
        }
      });
      tempRl.once("close", () => resolve("deny"));
    });
  };
}

/**
 * Creates a permission prompt for Ink interactive mode.
 * Dispatches REQUEST_PERMISSION into App state; the PermissionPrompt
 * component handles keypress capture via Ink's useInput hook.
 */
function createInkPermissionPrompt(
  getDispatch: () => (action: import("./ui/state.js").AppAction) => void,
): (request: PermissionRequest) => Promise<PermissionResult> {
  const approvedTools = new Set<string>();

  return (request: PermissionRequest): Promise<PermissionResult> => {
    if (approvedTools.has(request.toolName)) {
      return Promise.resolve("allow");
    }

    return new Promise((resolve) => {
      getDispatch()({
        type: "REQUEST_PERMISSION",
        permission: {
          toolName: request.toolName,
          resolve: (key: string) => {
            switch (key) {
              case "y": resolve("allow"); break;
              case "t": approvedTools.add(request.toolName); resolve("allow"); break;
              case "a": resolve("allow_all"); break;
              case "n": resolve("deny"); break;
              default: resolve("allow"); break;
            }
          },
        },
      });
    });
  };
}

// ── Welcome Info Gathering ─────────────────────────────────────────

async function getWelcomeInfo(
  opts: CliOptions,
  permissionMode: PermissionMode,
  cwd: string,
  sessionId: string,
  isResumed: boolean,
) {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

  let version = "0.1.0";
  try {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8"));
    version = pkg.version ?? version;
  } catch {}

  let gitBranch = "";
  try {
    const { execFile: execFileCb } = await import("child_process");
    gitBranch = await new Promise((resolve) => {
      execFileCb("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }, (err, stdout) => {
        resolve(err ? "" : stdout.trim());
      });
    });
  } catch {}

  const suggestions = isResumed ? [] : await getSuggestions(cwd);

  return {
    version,
    model: opts.model,
    provider,
    permissionMode,
    cwd,
    gitBranch,
    sessionId,
    isResumed,
    suggestions,
  };
}

// ── runPrompt (Ink mode) ─────────────────────────────────────────

async function runPromptInk(
  userInput: string,
  messages: ConversationMessage[],
  systemPrompt: SystemPrompt,
  registry: ToolRegistry,
  opts: CliOptions,
  cwd: string,
  signal: AbortSignal,
  requestPermission: ((request: PermissionRequest) => Promise<PermissionResult>) | undefined,
  sessionId: string | undefined,
  costTracker: CostTracker | undefined,
  fileTracker: FileChangeTracker | undefined,
  bridge: EventBridge,
): Promise<string | undefined> {
  // Detect image paths in user input
  const imagePaths = detectImagePaths(userInput);
  let userContent: string | Array<{ type: string; [key: string]: unknown }> = userInput;

  if (imagePaths.length > 0) {
    const contentBlocks: Array<{ type: string; [key: string]: unknown }> = [
      { type: "text", text: userInput },
    ];
    for (const imgPath of imagePaths) {
      try {
        const imageBlock = await loadImageAsBlock(imgPath);
        contentBlocks.push(imageBlock as { type: string; [key: string]: unknown });
      } catch {}
    }
    if (contentBlocks.length > 1) {
      userContent = contentBlocks;
    }
  }

  // Add user message
  const userMsg: ConversationMessage = {
    type: "user",
    role: "user",
    content: typeof userContent === "string" ? userContent : userInput,
    uuid: uuid(),
    timestamp: timestamp(),
  };
  messages.push(userMsg);

  const thinkingBudget = resolveThinkingBudget(opts.thinkingBudget);

  bridge.reset();
  bridge.dispatch({ type: "SET_PHASE", phase: "processing" });
  bridge.dispatch({ type: "CLEAR_STREAMING" });
  bridge.dispatch({ type: "SPINNER_START", label: "Thinking..." });

  // Dynamic plan mode
  let inPlanMode = false;
  const dynamicPermission: typeof requestPermission = requestPermission
    ? async (request) => {
        if (inPlanMode) {
          if (request.toolName === "ExitPlanMode") return "allow";
          return "deny";
        }
        return requestPermission!(request);
      }
    : undefined;

  const fileHistory = getFileHistory();
  let finalResultText: string | undefined;

  try {
    for await (const event of agentLoop({
      messages,
      systemPrompt,
      tools: registry,
      model: opts.model,
      maxTurns: opts.maxTurns,
      thinkingBudgetTokens: thinkingBudget,
      requestPermission: dynamicPermission,
      signal,
      cwd,
      sessionId,
      costTracker,
      onTextDelta: bridge.onTextDelta,
      onThinkingDelta: bridge.onThinkingDelta,
      onToolProgress: bridge.onToolProgress,
    })) {
      // Handle plan mode transitions
      if (event.type === "tool_result") {
        if (event.toolName === "EnterPlanMode" && event.result.includes("[ENTER_PLAN_MODE]")) {
          inPlanMode = true;
        } else if (event.toolName === "ExitPlanMode" && event.result.includes("[EXIT_PLAN_MODE]")) {
          inPlanMode = false;
        }
      }

      // Save file snapshots before Write/Edit
      if (event.type === "tool_use_start" && event.input) {
        if (
          (event.toolName === "Write" || event.toolName === "Edit") &&
          event.input.file_path
        ) {
          const filePath = String(event.input.file_path);
          try {
            const { readFile: rf } = await import("fs/promises");
            const content = await rf(filePath, "utf-8");
            fileHistory.saveSnapshot(filePath, content);
          } catch {}
        }
      }

      // Track file changes
      if (event.type === "tool_result" && fileTracker && !event.isError) {
        if (event.toolName === "Write") {
          fileTracker.recordWrite(event.result, event.result, true);
        }
      }

      // Capture result text
      if (event.type === "result") {
        finalResultText = event.resultText;
      }

      // Delegate to event bridge for display
      bridge.handleEvent(event);

      // Store assistant messages
      if (event.type === "assistant") {
        messages.push(event.message);
      }
    }
  } finally {
    // Reset all transient state so the live region becomes 0-height
    // and TextInput reappears for the next prompt.
    bridge.dispatch({ type: "PROCESSING_COMPLETE" });
  }

  return finalResultText;
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  // Check for API key
  const providerName = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (providerName === "anthropic" || providerName === "claude") {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(chalk.red("Error: ANTHROPIC_API_KEY environment variable is required."));
      process.exit(1);
    }
  } else if (providerName === "openai" || providerName === "openai-compat" || providerName === "openai_compat") {
    const baseUrl = process.env.OPENAI_BASE_URL ?? "";
    const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
    if (!process.env.OPENAI_API_KEY && !isLocal) {
      console.error(chalk.red("Error: OPENAI_API_KEY environment variable is required."));
      process.exit(1);
    }
  }

  const cwd = process.cwd();
  const registry = createToolRegistry(opts.model);

  const permissionMode = resolvePermissionMode(opts.permissionMode);

  await loadHooksFromConfig(cwd);
  await loadSkills(cwd);
  await loadAgents(cwd);

  const pluginManager = getPluginManager();
  await pluginManager.init();
  for (const tool of pluginManager.getTools()) {
    registry.register(tool);
  }

  const mcpTools = await initializeMcpServers(cwd);
  for (const tool of mcpTools) {
    registry.register(tool);
  }

  const sessionId = opts.resume ?? newSessionId();
  await executeHooks({ event: "SessionStart", sessionId, cwd });

  const systemPrompt: SystemPrompt = opts.systemPrompt
    ? [{ text: opts.systemPrompt, cacheHint: false }]
    : await buildSystemPrompt(cwd, registry.getAll().map((t) => t.name));

  const costTracker = new CostTracker();
  const fileTracker = new FileChangeTracker();

  let messages: ConversationMessage[] = [];
  let isResumed = false;
  if (opts.resume) {
    const session = await loadSession(opts.resume, cwd);
    if (session) {
      messages = session.messages;
      isResumed = true;
      const sourceTag = session.metadata.source === "claude-code" ? " [claude-code]" : "";
      console.log(chalk.dim(`Resumed session ${opts.resume}${sourceTag} (${messages.length} messages)`));
    } else {
      console.log(chalk.yellow(`Session ${opts.resume} not found. Starting fresh.`));
    }
  }

  let currentModel = opts.model;

  const abortController = new AbortController();

  let lastCtrlC = 0;
  process.on("SIGINT", () => {
    const now = Date.now();
    if (now - lastCtrlC < 1000) {
      console.log(chalk.dim("\nExiting."));
      disconnectMcpServers().catch(() => {});
      process.exit(0);
    }
    lastCtrlC = now;
    abortController.abort();
    console.log(chalk.dim("\n(Interrupted. Press Ctrl+C again to exit.)"));
  });

  const projectPermissions = await loadProjectPermissions(cwd);
  const isTTY = process.stdin.isTTY && !opts.prompt;

  // For Ink mode, we need a dispatch function that routes to the App.
  // It starts as a no-op and gets wired up when the App is rendered.
  let inkDispatch: (action: import("./ui/state.js").AppAction) => void = () => {};
  const getInkDispatch = () => inkDispatch;

  const basePermissionPrompt = isTTY
    ? createInkPermissionPrompt(getInkDispatch)
    : createPipePermissionPrompt();
  const permissionPrompt = createPermissionWrapper(permissionMode, basePermissionPrompt, projectPermissions);

  const commandRegistry = createCommandRegistry();

  // ── One-shot / pipe mode — use legacy rendering ──────────────────

  if (opts.prompt || !process.stdin.isTTY) {
    // Non-interactive: run prompt with legacy direct stdout writes
    // Import and run the legacy entry point behavior
    const { Spinner } = await import("./lib/spinner.js");
    const { StreamingRenderer } = await import("./core/markdown.js");
    const { isThinkingDisplayEnabled } = await import("./commands/thinking.js");
    const { isFastMode } = await import("./commands/fast.js");

    const userInput = opts.prompt ?? "";
    if (!userInput) {
      console.error(chalk.red("No prompt provided. Use -p to specify a prompt."));
      process.exit(1);
    }

    const imagePaths = detectImagePaths(userInput);
    let userContent: string | Array<{ type: string; [key: string]: unknown }> = userInput;
    if (imagePaths.length > 0) {
      const contentBlocks: Array<{ type: string; [key: string]: unknown }> = [
        { type: "text", text: userInput },
      ];
      for (const imgPath of imagePaths) {
        try {
          const imageBlock = await loadImageAsBlock(imgPath);
          contentBlocks.push(imageBlock as { type: string; [key: string]: unknown });
        } catch {}
      }
      if (contentBlocks.length > 1) {
        userContent = contentBlocks;
      }
    }

    const userMsg: ConversationMessage = {
      type: "user",
      role: "user",
      content: typeof userContent === "string" ? userContent : userInput,
      uuid: uuid(),
      timestamp: timestamp(),
    };
    messages.push(userMsg);

    const thinkingBudget = resolveThinkingBudget(opts.thinkingBudget);
    let textStarted = false;
    let thinkingStarted = false;
    let finalResultText: string | undefined;
    const streamRenderer = new StreamingRenderer((text) => process.stdout.write(text));
    const spinner = new Spinner();
    spinner.start("Thinking...");

    try {
      for await (const event of agentLoop({
        messages,
        systemPrompt,
        tools: registry,
        model: opts.model,
        maxTurns: opts.maxTurns,
        thinkingBudgetTokens: thinkingBudget,
        requestPermission: permissionPrompt,
        signal: abortController.signal,
        cwd,
        sessionId,
        costTracker,
        onTextDelta: (text) => {
          if (spinner.running) spinner.stop();
          if (thinkingStarted) {
            thinkingStarted = false;
            process.stdout.write(chalk.dim("\n\u273B Thinking complete\n"));
          }
          if (!textStarted) {
            textStarted = true;
            process.stdout.write("\n");
          }
          streamRenderer.push(text);
        },
        onThinkingDelta: (thinking) => {
          if (!isThinkingDisplayEnabled()) return;
          if (spinner.running) spinner.stop();
          if (!thinkingStarted) {
            thinkingStarted = true;
            process.stdout.write(chalk.dim("\n\uD83D\uDCAD "));
          }
          process.stdout.write(chalk.dim(thinking));
        },
        onToolProgress: (_toolName, _toolUseId, content) => {
          if (spinner.running) spinner.stop();
          const cols = process.stdout.columns || 80;
          const truncated = content.length > cols - 4 ? content.slice(0, cols - 7) + "..." : content;
          process.stdout.write(`\r\x1b[K${chalk.dim(`  \u22EF ${truncated}`)}`);
        },
      })) {
        if (event.type === "result") {
          finalResultText = event.resultText;
        }
        if (event.type === "assistant") {
          streamRenderer.flush();
          messages.push(event.message);
        }
      }
    } finally {
      if (spinner.running) spinner.stop();
    }

    if (finalResultText) {
      console.log("\n" + renderMarkdown(finalResultText));
    }
    await disconnectMcpServers();
    process.exit(0);
  }

  // ── Interactive TTY mode — Ink rendering ──────────────────────────

  // Print welcome banner directly to stdout (not through Ink).
  {
    const w = await getWelcomeInfo(opts, permissionMode, cwd, sessionId, isResumed);
    console.log();
    console.log(chalk.bold("claude-code-core") + chalk.dim(` v${w.version}`));
    console.log(chalk.dim(`  Model:    ${w.model}`) + chalk.dim(` (${w.provider})`));
    console.log(chalk.dim(`  Mode:     ${w.permissionMode}`));
    console.log(chalk.dim(`  CWD:      ${w.cwd}`));
    if (w.gitBranch) console.log(chalk.dim(`  Branch:   ${w.gitBranch}`));
    console.log(chalk.dim(`  Session:  ${w.sessionId}${w.isResumed ? " (resumed)" : ""}`));
    if (!w.isResumed && w.suggestions.length > 0) {
      console.log();
      console.log(chalk.dim("  Try:"));
      for (const s of w.suggestions) {
        console.log(chalk.dim(`    ${chalk.cyan(">")} ${s}`));
      }
    }
    console.log();
    console.log(chalk.dim("Type your message. /help for commands. Ctrl+C to interrupt.\n"));
  }

  // Create the App ref for imperative dispatch
  const appRef = createRef<AppHandle>();

  // Tab completion function (passed to TextInput via App)
  const completer: TextInputProps["completer"] = (line: string): [string[], string] => {
    if (line.startsWith("/") && line.includes(" ")) {
      const spaceIdx = line.indexOf(" ");
      const cmdName = line.slice(1, spaceIdx).toLowerCase();
      const partialArg = line.slice(spaceIdx + 1);
      const completions = commandRegistry.getCompletions(cmdName);
      if (completions) {
        const prefix = line.slice(0, spaceIdx + 1);
        const hits = completions
          .filter((c) => c.startsWith(partialArg))
          .map((c) => prefix + c);
        return [hits, line];
      }
      return [[], line];
    }
    if (line.startsWith("/")) {
      const names = commandRegistry.getAllNames();
      const skillNames = listSkills()
        .filter((s) => s.userInvocable !== false)
        .map((s) => s.command);
      const all = [...names, ...skillNames];
      const hits = all.filter((n) => n.startsWith(line));
      return [hits.length ? hits : all, line];
    }
    return [[], line];
  };

  // Track whether we're currently processing (to prevent double-submit)
  let isProcessing = false;

  // Current abort controller — set during processing, null otherwise
  let currentAbort: AbortController | null = null;

  // Create the EventBridge wired to App's dispatch
  const getDispatch = () => {
    if (appRef.current) return appRef.current.dispatch;
    return (_action: any) => {};
  };

  // Wire the Ink permission prompt dispatch to the App
  inkDispatch = (action) => getDispatch()(action);

  const bridge = new EventBridge((action) => getDispatch()(action));

  // Start console capture so command output goes through Ink
  startCapture((action) => getDispatch()(action));

  // Shared runPrompt function for commands
  const runPromptForCommand = async (prompt: string): Promise<string | undefined> => {
    return runPromptInk(
      prompt, messages, systemPrompt, registry,
      { ...opts, model: currentModel }, cwd,
      new AbortController().signal,
      permissionPrompt, sessionId, costTracker, fileTracker,
      bridge,
    );
  };

  // Build CommandContext (no readline — rl is undefined in Ink mode)
  const buildCommandContext = (): CommandContext => ({
    messages,
    model: currentModel,
    setModel: (m: string) => { currentModel = m; },
    costTracker,
    fileTracker,
    systemPrompt,
    cwd,
    sessionId,
    toolRegistry: registry,
    permissionMode,
    requestPermission: permissionPrompt,
    runPrompt: runPromptForCommand,
    output: (text: string) => {
      getDispatch()({
        type: "COMMAND_OUTPUT",
        text,
      });
    },
  });

  // ── Input handler — called by TextInput's onSubmit ──────────────

  const handleSubmit = async (userInput: string): Promise<void> => {
    if (isProcessing) return;
    const trimmed = userInput.trim();
    if (!trimmed) return;

    // Freeze the user's input as a visible block above processing output
    getDispatch()({
      type: "FREEZE_BLOCK",
      block: {
        id: `user-${Date.now()}`,
        text: `\n${chalk.bgWhite.black(` ${icons.pointer} ${trimmed} `)}`,
        type: "user",
      },
    });

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      const cmdCtx = buildCommandContext();
      const cmdResult = await commandRegistry.execute(trimmed, cmdCtx);

      if (cmdResult !== null) {
        // Command handled. Phase stays "input" — TextInput re-renders.
        return;
      }

      // Check for skill invocation
      const parts = trimmed.split(/\s+/, 2);
      const skill = getSkill(parts[0]);
      if (skill) {
        if (skill.once && isSkillInvokedOnce(skill.command)) {
          console.log(chalk.yellow(`Skill ${skill.command} can only be invoked once per session.`));
          return;
        }

        if (skill.userInvocable === false) {
          console.log(chalk.yellow(`Skill ${skill.command} cannot be invoked directly.`));
          return;
        }

        const skillArgs = trimmed.slice(parts[0].length).trim();
        let skillPrompt = await preprocessSkillContent(skill.prompt, skillArgs, cwd);

        if (skill.context === "fork") {
          const agentType = skill.agent ?? "general-purpose";
          skillPrompt = `Use the Task tool to delegate the following task to a "${agentType}" subagent. Pass the full prompt below to the subagent.\n\n${skillPrompt}`;
        }

        isProcessing = true;
        const interactionAbort = new AbortController();
        currentAbort = interactionAbort;
        try {
          await runPromptInk(
            skillPrompt, messages, systemPrompt, registry,
            { ...opts, model: currentModel }, cwd,
            interactionAbort.signal, permissionPrompt, sessionId,
            costTracker, fileTracker, bridge,
          );
          await saveSession(sessionId, messages, currentModel, cwd);
          markSkillInvoked(skill.command);
        } catch (err) {
          if (!interactionAbort.signal.aborted) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\nError: ${msg}`));
          }
        } finally {
          currentAbort = null;
          isProcessing = false;
        }
        return;
      }

      console.log(chalk.yellow(`Unknown command: ${parts[0]}. Type /help for available commands.`));
      return;
    }

    // Regular user input
    isProcessing = true;
    const interactionAbort = new AbortController();
    currentAbort = interactionAbort;

    try {
      await executeHooks({ event: "UserPromptSubmit", prompt: trimmed, sessionId, cwd });

      await runPromptInk(
        userInput, messages, systemPrompt, registry,
        { ...opts, model: currentModel }, cwd,
        interactionAbort.signal, permissionPrompt, sessionId,
        costTracker, fileTracker, bridge,
      );

      await saveSession(sessionId, messages, currentModel, cwd);
    } catch (err) {
      if (interactionAbort.signal.aborted) {
        console.log(chalk.dim("\n(Generation interrupted)"));
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\nError: ${msg}`));
      }
    } finally {
      currentAbort = null;
      isProcessing = false;
    }
  };

  // ── Interrupt handler — Ctrl+C during input ──────────────────────

  let lastInterrupt = 0;
  const handleInterrupt = () => {
    const now = Date.now();
    if (now - lastInterrupt < 1500) {
      // Double Ctrl+C — exit immediately
      handleExit();
      return;
    }
    lastInterrupt = now;
    console.log(chalk.dim("\n(Press Ctrl+C again to exit, or Ctrl+D to quit.)"));
  };

  // ── Processing interrupt — Ctrl+C during processing ──────────────

  const handleProcessingInterrupt = () => {
    if (currentAbort) {
      currentAbort.abort();
      console.log(chalk.dim("\n(Interrupted)"));
    }
  };

  // unmount is set after render() — declared here so handleExit can reference it
  let unmount: () => void = () => {};

  // ── Exit handler — Ctrl+D ────────────────────────────────────────

  const handleExit = async () => {
    if (messages.length > 0) {
      await saveSession(sessionId, messages, currentModel, cwd);
      console.log(chalk.dim(`\nSession saved: ${sessionId}`));
    }
    getFileHistory().clear();
    stopCapture();
    unmount();
    await disconnectMcpServers();
    await executeHooks({ event: "SessionEnd", sessionId, cwd });
    console.log(chalk.dim("Goodbye!"));
    process.exit(0);
  };

  // Render the Ink app with input callbacks
  const inkApp = render(
    <App
      ref={appRef}
      onSubmit={handleSubmit}
      onInterrupt={handleInterrupt}
      onProcessingInterrupt={handleProcessingInterrupt}
      onExit={handleExit}
      completer={completer}
    />,
    {
      exitOnCtrlC: false,
    }
  );
  unmount = inkApp.unmount;
}

// ── Entry Point ──────────────────────────────────────────────────

main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
