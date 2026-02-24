import { z } from "zod";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Tool, ToolContext } from "./tool-registry.js";
import { ToolRegistry } from "./tool-registry.js";
import { agentLoop, type AgentLoopParams } from "../core/agent-loop.js";
import { buildAgentSystemPrompt, buildCustomAgentSystemPrompt } from "../prompt/system-prompt.js";
import { getAgent, type AgentDefinition } from "../core/agents.js";
import type { ConversationMessage } from "../core/types.js";
import {
  executeHooks,
  registerScopedHooks,
  unregisterScopedHooks,
  type HookHandler,
} from "../core/hooks.js";
import { uuid, timestamp } from "../utils.js";
import { registerBackgroundAgent, markAgentFinished } from "./background-task-registry.js";

const inputSchema = z.object({
  prompt: z.string().describe("The task for the subagent to perform"),
  description: z
    .string()
    .describe("Short (3-5 word) description of the task"),
  subagent_type: z
    .string()
    .describe("Agent type: built-in (Bash, Explore, general-purpose, security-review) or any custom agent name"),
  model: z
    .enum(["sonnet", "opus", "haiku"])
    .optional()
    .describe("Model to use (defaults to parent model)"),
  max_turns: z
    .number()
    .optional()
    .describe("Maximum agentic turns before stopping"),
  run_in_background: z
    .boolean()
    .optional()
    .describe("Run in background, returning output file path"),
  resume: z
    .string()
    .optional()
    .describe("Agent ID to resume from previous invocation"),
});

// ── Agent Type Configurations ────────────────────────────────────────
// Each agent type specifies which tools it can access, whether it inherits
// parent conversation context (forkContext), and its default model.

interface AgentConfig {
  /**
   * Explicit list of allowed tools. Supports patterns like "Bash(git*)"
   * which restricts bash to commands starting with "git".
   * Use ["*"] to allow all tools (except Task, which is always excluded).
   */
  allowedTools: string[];
  /** If true, subagent receives parent conversation history. Default: false. */
  forkContext: boolean;
  /** Default model alias when none specified by caller. */
  defaultModel?: string;
}

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  Bash: {
    allowedTools: ["Bash"],
    forkContext: false,
  },
  Explore: {
    allowedTools: ["Glob", "Grep", "Read", "Bash"],
    forkContext: false,
    defaultModel: "haiku",
  },
  "general-purpose": {
    allowedTools: ["*"],
    forkContext: true,
  },
  "security-review": {
    allowedTools: [
      "Bash(git diff)",
      "Bash(git status)",
      "Bash(git log)",
      "Bash(git show)",
      "Bash(git remote)",
      "Read",
      "Glob",
      "Grep",
    ],
    forkContext: false,
  },
};

// Track running/completed agents for resume
const agentTranscripts = new Map<string, ConversationMessage[]>();

import { ANTHROPIC_ALIASES as MODEL_MAP } from "../core/models.js";

// ── Tool Pattern Matching ────────────────────────────────────────────
// Supports patterns like "Bash(git*)" to restrict tool inputs.
// Pattern format: "ToolName(prefix)" where prefix is matched against
// the tool's primary input (the `command` field for Bash).

interface ParsedToolSpec {
  toolName: string;
  pattern?: string; // If present, tool input must start with this prefix
}

function parseToolSpec(spec: string): ParsedToolSpec {
  const match = spec.match(/^(\w+)\((.+)\)$/);
  if (!match) return { toolName: spec };
  // Strip trailing wildcards/colons: "git diff:*" → "git diff", "git*" → "git"
  const rawPattern = match[2];
  const pattern = rawPattern.replace(/[:*]+$/, "").trim();
  return { toolName: match[1], pattern };
}

function commandMatchesPattern(command: string, pattern: string): boolean {
  return command.trimStart().startsWith(pattern);
}

/**
 * Create a filtered wrapper around a tool that validates input against a pattern.
 * Used for restrictions like "Bash(git diff)" — only commands starting with "git diff".
 */
function createFilteredTool(tool: Tool, pattern: string): Tool {
  return {
    ...tool,
    async *call(rawInput: unknown, context: ToolContext) {
      const input = tool.inputSchema.parse(rawInput);
      const command = (input as Record<string, unknown>).command;
      if (typeof command === "string" && !commandMatchesPattern(command, pattern)) {
        yield {
          type: "result",
          content: `Error: Command not allowed. Only commands starting with "${pattern}" are permitted for this agent.`,
        };
        return;
      }
      yield* tool.call(rawInput, context);
    },
  };
}

// ── Tool Registry Builder ────────────────────────────────────────────

function buildChildRegistry(
  parentRegistry: ToolRegistry,
  config: AgentConfig
): ToolRegistry {
  const childRegistry = new ToolRegistry();
  const isWildcard = config.allowedTools.includes("*");

  if (isWildcard) {
    // Allow all tools except Task (subagents can't spawn sub-subagents)
    for (const tool of parentRegistry.getAll()) {
      if (tool.name === "Task") continue;
      childRegistry.register(tool);
    }
    return childRegistry;
  }

  // Parse each allowed tool spec and register accordingly
  const parsedSpecs = config.allowedTools.map(parseToolSpec);

  // Group patterns by tool name (a tool may have multiple allowed patterns)
  const toolPatterns = new Map<string, string[]>();
  const plainTools = new Set<string>();

  for (const spec of parsedSpecs) {
    if (spec.pattern) {
      const existing = toolPatterns.get(spec.toolName) ?? [];
      existing.push(spec.pattern);
      toolPatterns.set(spec.toolName, existing);
    } else {
      plainTools.add(spec.toolName);
    }
  }

  // Register plain tools (no pattern restriction)
  for (const toolName of plainTools) {
    if (toolName === "Task") continue;
    const tool = parentRegistry.get(toolName);
    if (tool) childRegistry.register(tool);
  }

  // Register pattern-restricted tools
  for (const [toolName, patterns] of toolPatterns) {
    if (toolName === "Task") continue;
    const tool = parentRegistry.get(toolName);
    if (!tool) continue;

    // Create a wrapper that accepts any of the allowed patterns
    const filteredTool: Tool = {
      ...tool,
      async *call(rawInput: unknown, context: ToolContext) {
        const input = tool.inputSchema.parse(rawInput);
        const command = (input as Record<string, unknown>).command;
        if (typeof command === "string") {
          const allowed = patterns.some((p) => commandMatchesPattern(command, p));
          if (!allowed) {
            const allowed_prefixes = patterns.map((p) => `"${p}"`).join(", ");
            yield {
              type: "result",
              content: `Error: Command not allowed. Only commands starting with ${allowed_prefixes} are permitted for this agent.`,
            };
            return;
          }
        }
        yield* tool.call(rawInput, context);
      },
    };
    childRegistry.register(filteredTool);
  }

  return childRegistry;
}

// ── Task Tool ────────────────────────────────────────────────────────

export function createTaskTool(
  parentRegistry: ToolRegistry,
  parentModel: string
): Tool {
  return {
    name: "Task",
    description: "Launch a subagent to handle a complex, multi-step task autonomously.",
    inputSchema,
    maxResultSizeChars: 100000,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,

    async *call(rawInput: unknown, context: ToolContext) {
      const input = inputSchema.parse(rawInput);
      const config = AGENT_CONFIGS[input.subagent_type];
      const customAgent = !config ? getAgent(input.subagent_type) : undefined;

      if (!config && !customAgent) {
        yield { type: "result", content: `Error: Unknown subagent type "${input.subagent_type}". Built-in types: Bash, Explore, general-purpose, security-review.` };
        return;
      }

      // Build filtered tool registry for the subagent
      let childRegistry: ToolRegistry;
      let childToolNames: string[];
      let forkContext: boolean;
      let modelName: string;
      let systemPrompt;

      if (config) {
        // Built-in agent
        childRegistry = buildChildRegistry(parentRegistry, config);
        childToolNames = childRegistry.getAll().map((t) => t.name);
        forkContext = config.forkContext;
        modelName = input.model
          ? MODEL_MAP[input.model] ?? parentModel
          : config.defaultModel
            ? MODEL_MAP[config.defaultModel] ?? parentModel
            : parentModel;
        const activeProvider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
        systemPrompt = await buildAgentSystemPrompt(
          input.subagent_type, context.cwd, childToolNames, config.forkContext, activeProvider
        );
      } else {
        // Custom agent from markdown definition
        const agent = customAgent!;
        const agentConfig: AgentConfig = {
          allowedTools: agent.tools ?? ["*"],
          forkContext: agent.forkContext ?? false,
          defaultModel: agent.model,
        };
        childRegistry = buildChildRegistry(parentRegistry, agentConfig);

        // Remove disallowed tools
        if (agent.disallowedTools) {
          for (const toolName of agent.disallowedTools) {
            childRegistry.remove(toolName);
          }
        }

        // Ensure file tools for agents with memory
        if (agent.memory) {
          for (const toolName of ["Read", "Write", "Edit"]) {
            if (!childRegistry.get(toolName)) {
              const tool = parentRegistry.get(toolName);
              if (tool) childRegistry.register(tool);
            }
          }
        }

        childToolNames = childRegistry.getAll().map((t) => t.name);
        forkContext = agent.forkContext ?? false;
        modelName = input.model
          ? MODEL_MAP[input.model] ?? parentModel
          : agent.model
            ? MODEL_MAP[agent.model] ?? agent.model
            : parentModel;
        const activeProviderCustom = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
        systemPrompt = await buildCustomAgentSystemPrompt(
          agent, context.cwd, childToolNames, activeProviderCustom
        );
      }

      // Handle resume
      const agentId = input.resume ?? randomUUID().slice(0, 7);
      const existingMessages = input.resume
        ? agentTranscripts.get(input.resume) ?? []
        : [];

      // Build initial messages
      // forkContext: true → prepend parent conversation for context awareness
      // forkContext: false → start fresh (isolated, token-efficient)
      const parentMsgs: ConversationMessage[] =
        forkContext && !input.resume
          ? (context.parentMessages ?? [])
          : [];

      const messages: ConversationMessage[] = [
        ...existingMessages,
        ...parentMsgs,
        {
          type: "user",
          role: "user",
          content: input.prompt,
          uuid: uuid(),
          timestamp: timestamp(),
        },
      ];

      // Create an isolated AbortController for this subagent.
      // Links to parent signal so parent abort propagates, but subagent's
      // streaming listeners accumulate on the child signal — not the parent.
      // This prevents MaxListenersExceededWarning when running multiple subagents.
      const childAbort = new AbortController();
      if (context.abortSignal) {
        if (context.abortSignal.aborted) {
          childAbort.abort();
        } else {
          context.abortSignal.addEventListener(
            "abort",
            () => childAbort.abort(),
            { once: true }
          );
        }
      }

      const loopParams: AgentLoopParams = {
        messages,
        systemPrompt,
        tools: childRegistry,
        model: modelName,
        maxTurns: input.max_turns ?? 30,
        signal: childAbort.signal,
        cwd: context.cwd,
        agentId,
      };

      // Register agent-scoped hooks (if custom agent has hooks defined)
      if (customAgent?.hooks && customAgent.hooks.length > 0) {
        // Convert agent Stop hooks to SubagentStop (they apply to this agent, not the parent)
        const agentHooks: HookHandler[] = customAgent.hooks.map((h) => ({
          ...h,
          event: h.event === "Stop" ? "SubagentStop" as const : h.event,
        }));
        registerScopedHooks(agentId, agentHooks);
      }

      // Background mode: write output to file
      if (input.run_in_background) {
        const outputDir = join(tmpdir(), "openharness", "tasks");
        await mkdir(outputDir, { recursive: true });
        const outputFile = join(outputDir, `${agentId}.output`);

        // Register in background task registry for TaskOutput/TaskStop
        registerBackgroundAgent(agentId, outputFile, childAbort, input.description);

        // Launch in background (don't await) — scoped hooks cleaned up in runInBackground
        runInBackground(loopParams, outputFile, agentId).then(() => {
          markAgentFinished(agentId);
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          markAgentFinished(agentId, msg);
          writeFile(
            outputFile,
            `\nAgent error: ${msg}`,
            { flag: "a" }
          ).catch(() => {});
        }).finally(() => unregisterScopedHooks(agentId));

        yield {
          type: "result",
          content: `Agent launched in background.\ntask_id: ${agentId}\noutput_file: ${outputFile}\nUse TaskOutput with task_id "${agentId}" to read output.`,
        };
        return;
      }

      // Foreground mode: run and collect output
      yield { type: "progress", content: `Subagent (${input.subagent_type}) running...` };

      let resultText = "";
      let errorText = "";
      let toolUseCount = 0;
      let totalTokens = 0;
      const subagentStart = Date.now();
      const transcript: ConversationMessage[] = [...messages];

      try {
        for await (const event of agentLoop(loopParams)) {
          if (event.type === "assistant") {
            transcript.push(event.message);
            const text = event.message.content
              .filter((b) => b.type === "text")
              .map((b) => "text" in b ? b.text : "")
              .join("\n");
            if (text) resultText = text; // Keep latest text as result
          }
          if (event.type === "tool_result") {
            toolUseCount++;
            yield { type: "progress", content: `[${event.toolName}] ${event.result.slice(0, 60)}` };
          }
          if (event.type === "result") {
            if (event.resultText) resultText = event.resultText;
            totalTokens = event.totalUsage.input_tokens + event.totalUsage.output_tokens;
            if (event.subtype !== "success") {
              errorText = `Agent error (${event.subtype}): ${event.resultText}`;
            }
          }
        }
      } finally {
        // Clean up agent-scoped hooks
        unregisterScopedHooks(agentId);
      }

      // Store transcript for potential resume
      agentTranscripts.set(agentId, transcript);

      // Fire SubagentStop hook
      await executeHooks({
        event: "SubagentStop",
        agentId,
        cwd: context.cwd,
        lastAssistantMessage: resultText,
        stopReason: errorText ? "error" : "success",
      }).catch(() => {});

      if (errorText) {
        yield { type: "result", content: errorText };
        return;
      }

      // Format completion summary with metrics
      const elapsed = Date.now() - subagentStart;
      const elapsedStr = elapsed < 60000
        ? `${(elapsed / 1000).toFixed(0)}s`
        : `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;
      const tokenStr = totalTokens > 1000
        ? `${(totalTokens / 1000).toFixed(1)}k tokens`
        : `${totalTokens} tokens`;

      yield {
        type: "result",
        content: `Done (${toolUseCount} tool uses · ${tokenStr} · ${elapsedStr})\n\n${resultText || "(Subagent produced no text output)"}`,
      };
    },
  };
}

async function runInBackground(
  params: AgentLoopParams,
  outputFile: string,
  agentId: string
): Promise<void> {
  const transcript: ConversationMessage[] = [...params.messages];

  for await (const event of agentLoop(params)) {
    if (event.type === "assistant") {
      transcript.push(event.message);
      const text = event.message.content
        .filter((b) => b.type === "text")
        .map((b) => "text" in b ? b.text : "")
        .join("\n");
      if (text) {
        await writeFile(outputFile, text + "\n", { flag: "a" });
      }
    }
    if (event.type === "tool_result") {
      await writeFile(
        outputFile,
        `[${event.toolName}]: ${event.result.slice(0, 200)}\n`,
        { flag: "a" }
      );
    }
    if (event.type === "result") {
      // Write error details if present
      if (event.subtype !== "success" && event.resultText) {
        await writeFile(
          outputFile,
          `ERROR: ${event.resultText}\n`,
          { flag: "a" }
        );
      }
      await writeFile(
        outputFile,
        `\n--- Agent ${agentId} finished (${event.subtype}) ---\n`,
        { flag: "a" }
      );
    }
  }

  agentTranscripts.set(agentId, transcript);

  // Fire SubagentStop hook for background agent
  await executeHooks({
    event: "SubagentStop",
    agentId,
    cwd: params.cwd,
    stopReason: "background_complete",
  }).catch(() => {});

  // Fire Notification hook so the user knows the background agent finished
  await executeHooks({
    event: "Notification",
    cwd: params.cwd,
    prompt: `Background agent ${agentId} finished`,
  }).catch(() => {});
}
