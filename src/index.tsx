#!/usr/bin/env npx tsx
import "dotenv/config"; // Load .env before anything else
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
import { CostTracker } from "./core/cost.js";
import {
  resolvePermissionMode,
  createPermissionWrapper,
  loadProjectPermissions,
} from "./core/permission-modes.js";
import {
  newSessionId,
  saveSession,
  loadSession,
} from "./core/session.js";
import { loadHooksFromConfig, executeHooks } from "./core/hooks.js";
import {
  listSkills,
  getSkill,
  preprocessSkillContent,
  markSkillInvoked,
  isSkillInvokedOnce,
} from "./core/skills.js";
import { loadAgents } from "./core/agents.js";
import { uuid, timestamp } from "./utils.js";
import { CommandRegistry, type CommandContext } from "./core/commands.js";
import { createHelpCommand } from "./commands/help.js";
import { FileChangeTracker } from "./core/file-tracker.js";
import { getFileHistory } from "./core/file-history.js";
import { initializeMcpServers, disconnectMcpServers } from "./core/mcp/index.js";
import { getPluginManager } from "./core/plugins/index.js";
import {
  corePromptPlugin,
  memoryPlugin,
  commandsPlugin,
  skillsPlugin,
  cliRgPlugin,
  cliFdPlugin,
  cliFzfPlugin,
  cliJqPlugin,
  cliYqPlugin,
  cliAstGrepPlugin,
  cliBatPlugin,
  cliGitPlugin,
  cliDeltaPlugin,
  cliGhPlugin,
} from "./plugins/index.js";
import { buildContentWithImages } from "./core/image.js";
import { App, type AppHandle } from "./ui/components/app.js";
import { EventBridge } from "./ui/event-bridge.js";
import type { TextInputProps } from "./ui/components/text-input.js";
import { icons } from "./ui/theme.js";

// Extracted CLI modules
import { parseArgs, type CliOptions } from "./cli/args.js";
import {
  createPipePermissionPrompt,
  createInkPermissionPrompt,
  createInkUserInputPrompt,
  createPipeUserInputPrompt,
} from "./cli/permissions.js";
import { getWelcomeInfo, printWelcomeBanner } from "./cli/welcome.js";
import { runPipeMode } from "./cli/pipe-mode.js";
import { isProjectTrusted, promptProjectTrust, trustProject } from "./cli/trust.js";

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
  requestUserInput: ((questions: import("./tools/tool-registry.js").UserQuestion[]) => Promise<Record<string, string>>) | undefined,
  sessionId: string | undefined,
  costTracker: CostTracker | undefined,
  fileTracker: FileChangeTracker | undefined,
  bridge: EventBridge,
): Promise<string | undefined> {
  const userContent = await buildContentWithImages(userInput);

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
      requestUserInput,
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

  let permissionMode = resolvePermissionMode(opts.permissionMode);

  // ── Trust check (first-run only) ─────────────────────────────────
  const isTTY = process.stdin.isTTY && !opts.prompt;
  if (isTTY && permissionMode === "default") {
    const trusted = await isProjectTrusted(cwd);
    if (!trusted) {
      const userTrusts = await promptProjectTrust(cwd);
      if (userTrusts) {
        await trustProject(cwd);
      } else {
        permissionMode = "plan"; // read-only mode
      }
    }
  }

  // ── Plugin initialization ────────────────────────────────────────
  const pluginManager = getPluginManager();
  pluginManager.setCwd(cwd);

  pluginManager.registerBuiltin(corePromptPlugin);
  pluginManager.registerBuiltin(memoryPlugin);
  pluginManager.registerBuiltin(commandsPlugin);
  pluginManager.registerBuiltin(skillsPlugin);

  // CLI tool plugins — git/gh essential (enabled), rest opt-in (disabled)
  pluginManager.registerBuiltin(cliGitPlugin);
  pluginManager.registerBuiltin(cliGhPlugin);
  pluginManager.registerBuiltin(cliRgPlugin, false);
  pluginManager.registerBuiltin(cliFdPlugin, false);
  pluginManager.registerBuiltin(cliFzfPlugin, false);
  pluginManager.registerBuiltin(cliJqPlugin, false);
  pluginManager.registerBuiltin(cliYqPlugin, false);
  pluginManager.registerBuiltin(cliAstGrepPlugin, false);
  pluginManager.registerBuiltin(cliBatPlugin, false);
  pluginManager.registerBuiltin(cliDeltaPlugin, false);

  await pluginManager.discoverExternal();
  await loadHooksFromConfig(cwd);
  await loadAgents(cwd);
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

  const currentProvider = () => (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

  const promptResult = opts.systemPrompt
    ? { segments: [{ text: opts.systemPrompt, cacheHint: false }], details: [] }
    : await buildSystemPrompt(cwd, registry.getAll().map((t) => t.name), pluginManager, currentProvider());
  let systemPrompt: SystemPrompt = promptResult.segments;
  let promptSegmentDetails = promptResult.details;

  /** Rebuild system prompt (called when provider changes via /model). */
  const rebuildSystemPrompt = async (): Promise<void> => {
    if (opts.systemPrompt) return; // user-provided prompt is immutable
    const result = await buildSystemPrompt(
      cwd, registry.getAll().map((t) => t.name), pluginManager, currentProvider()
    );
    systemPrompt = result.segments;
    promptSegmentDetails = result.details;
  };

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

  // For Ink mode, we need a dispatch function that routes to the App.
  let inkDispatch: (action: import("./ui/state.js").AppAction) => void = () => {};
  const getInkDispatch = () => inkDispatch;

  const basePermissionPrompt = isTTY
    ? createInkPermissionPrompt(getInkDispatch, cwd)
    : createPipePermissionPrompt(cwd);
  const permissionPrompt = createPermissionWrapper(permissionMode, basePermissionPrompt, projectPermissions);

  const userInputPrompt = isTTY
    ? createInkUserInputPrompt(getInkDispatch)
    : createPipeUserInputPrompt();

  // Build command registry from plugin-provided commands + help
  const commandRegistry = new CommandRegistry();
  for (const cmd of pluginManager.getCommands()) {
    commandRegistry.register(cmd);
  }
  commandRegistry.register(createHelpCommand(commandRegistry));

  // ── One-shot / pipe mode ────────────────────────────────────────

  if (opts.prompt || !process.stdin.isTTY) {
    await runPipeMode(
      opts, messages, systemPrompt, registry,
      abortController.signal, cwd, sessionId, costTracker, permissionPrompt,
    );
    return;
  }

  // ── Interactive TTY mode — Ink rendering ──────────────────────────

  const welcomeInfo = await getWelcomeInfo(opts, permissionMode, cwd, sessionId, isResumed);
  printWelcomeBanner(welcomeInfo);

  const appRef = createRef<AppHandle>();

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

  let isProcessing = false;
  let currentAbort: AbortController | null = null;

  const getDispatch = () => {
    if (appRef.current) return appRef.current.dispatch;
    return (_action: any) => {};
  };

  inkDispatch = (action) => getDispatch()(action);

  const bridge = new EventBridge((action) => getDispatch()(action));

  const runPromptForCommand = async (prompt: string): Promise<string | undefined> => {
    return runPromptInk(
      prompt, messages, systemPrompt, registry,
      { ...opts, model: currentModel }, cwd,
      new AbortController().signal,
      permissionPrompt, userInputPrompt, currentSessionId, costTracker, fileTracker,
      bridge,
    );
  };

  let currentSessionId = sessionId;

  const buildCommandContext = (): CommandContext => ({
    messages,
    model: currentModel,
    setModel: (m: string) => { currentModel = m; },
    costTracker,
    fileTracker,
    systemPrompt,
    promptSegmentDetails,
    cwd,
    sessionId: currentSessionId,
    setSessionId: (id: string) => { currentSessionId = id; },
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
    dispatch: (action) => getDispatch()(action),
    rebuildSystemPrompt,
  });

  // ── Input handler ──────────────────────────────────────────────

  const handleSubmit = async (userInput: string, mentions?: string[]): Promise<void> => {
    if (isProcessing) return;
    const trimmed = userInput.trim();
    if (!trimmed) return;

    // If there are file mentions, read their contents and append to the prompt
    let fullInput = userInput;
    if (mentions && mentions.length > 0) {
      const { readFile } = await import("fs/promises");
      const { join, isAbsolute } = await import("path");
      const fileBlocks: string[] = [];
      for (const filePath of mentions) {
        try {
          const absPath = isAbsolute(filePath) ? filePath : join(cwd, filePath);
          const content = await readFile(absPath, "utf-8");
          const maxChars = 100_000;
          const truncated = content.length > maxChars
            ? content.slice(0, maxChars) + "\n\n... (truncated)"
            : content;
          fileBlocks.push(`<file path="${filePath}">\n${truncated}\n</file>`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fileBlocks.push(`<file path="${filePath}">\nError reading file: ${msg}\n</file>`);
        }
      }
      fullInput = userInput + "\n\n" + fileBlocks.join("\n\n");
    }

    getDispatch()({
      type: "FREEZE_BLOCK",
      block: {
        id: `user-${Date.now()}`,
        text: `\n${trimmed.split("\n").map((line, i) => chalk.bgWhite.black(i === 0 ? ` ${icons.pointer} ${line} ` : `   ${line} `)).join("\n")}`,
        type: "user",
      },
    });

    await new Promise((r) => setTimeout(r, 0));

    if (trimmed.startsWith("/")) {
      const cmdCtx = buildCommandContext();
      const cmdResult = await commandRegistry.execute(trimmed, cmdCtx);

      if (cmdResult !== null) return;

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
            interactionAbort.signal, permissionPrompt, userInputPrompt, currentSessionId,
            costTracker, fileTracker, bridge,
          );
          await saveSession(currentSessionId, messages, currentModel, cwd);
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
      await executeHooks({ event: "UserPromptSubmit", prompt: trimmed, sessionId: currentSessionId, cwd });

      await runPromptInk(
        fullInput, messages, systemPrompt, registry,
        { ...opts, model: currentModel }, cwd,
        interactionAbort.signal, permissionPrompt, userInputPrompt, currentSessionId,
        costTracker, fileTracker, bridge,
      );

      await saveSession(currentSessionId, messages, currentModel, cwd);
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

  let lastInterrupt = 0;
  const handleInterrupt = () => {
    const now = Date.now();
    if (now - lastInterrupt < 1500) {
      handleExit();
      return;
    }
    lastInterrupt = now;
    getDispatch()({ type: "SHOW_INTERRUPT_HINT", text: "Press Ctrl+C again to exit." });
  };

  const handleProcessingInterrupt = () => {
    if (currentAbort) {
      currentAbort.abort();
      console.log(chalk.dim("\n(Interrupted)"));
    }
  };

  const handleFileMention = () => {
    if (isProcessing) return;
    getDispatch()({ type: "FILE_SELECT_START", cwd });
  };

  let unmount: () => void = () => {};

  const handleExit = async () => {
    if (messages.length > 0) {
      await saveSession(currentSessionId, messages, currentModel, cwd);
      console.log(chalk.dim(`\nSession saved: ${currentSessionId}`));
    }
    getFileHistory().clear();
    unmount();
    await disconnectMcpServers();
    await executeHooks({ event: "SessionEnd", sessionId: currentSessionId, cwd });
    console.log(chalk.dim("Goodbye!"));
    process.exit(0);
  };

  const inkApp = render(
    <App
      ref={appRef}
      onSubmit={handleSubmit}
      onInterrupt={handleInterrupt}
      onProcessingInterrupt={handleProcessingInterrupt}
      onExit={handleExit}
      completer={completer}
      onFileMention={handleFileMention}
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
