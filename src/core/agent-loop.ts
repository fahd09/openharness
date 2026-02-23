import type Anthropic from "@anthropic-ai/sdk";
import type {
  ConversationMessage,
  LoopEvent,
  Usage,
  AssistantMessage,
  ApiToolResultBlockParam,
  SystemPrompt,
} from "./types.js";
import { streamMessage, type StreamParams } from "./streaming.js";
import {
  ToolRegistry,
  executeToolUseBlocks,
  type ToolContext,
  type PermissionCallback,
} from "../tools/tool-registry.js";
import { needsCompaction, compactConversation } from "./context.js";
import {
  getMaxRetries,
  isContextOverflowError,
  categorizeApiError,
} from "./retry.js";
import { CostTracker, formatCost } from "./cost.js";
import { analyzeBashOutput, needsBashAnalysis } from "./bash-analyzer.js";
import { executeHooks, isStopHookActive, setStopHookActive } from "./hooks.js";
import { setMaxListeners } from "events";
import { uuid, timestamp } from "../utils.js";

// ── Constants matching original ─────────────────────────────────────
const DEFAULT_MAX_TOKENS = 16384;
const FLOOR_OUTPUT_TOKENS = 3000;
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 2;

function resolveMaxTokens(paramValue?: number): number {
  const envVal = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= FLOOR_OUTPUT_TOKENS) return parsed;
  }
  return paramValue ?? DEFAULT_MAX_TOKENS;
}

export interface AgentLoopParams {
  messages: ConversationMessage[];
  systemPrompt: SystemPrompt;
  tools: ToolRegistry;
  model: string;
  maxTokens?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  signal?: AbortSignal;
  cwd: string;
  agentId?: string;
  sessionId?: string;
  /** Shared cost tracker (for subagents sharing a budget with parent). */
  costTracker?: CostTracker;
  /**
   * Extended thinking budget in tokens. Must be >= 1024.
   * When set, enables extended thinking — the model will produce thinking
   * blocks before its response. Set via CLAUDE_CODE_THINKING_BUDGET or --thinking-budget.
   */
  thinkingBudgetTokens?: number;
  /**
   * Permission callback for non-read-only tools.
   * If undefined, all tools auto-approve (e.g., subagent context).
   * The agent loop manages "allow_all" state: when the callback returns
   * "allow_all", the loop nullifies the callback for remaining turns.
   */
  requestPermission?: PermissionCallback;
  onTextDelta?: (text: string) => void;
  onThinkingDelta?: (thinking: string) => void;
  /** Called when a tool yields a progress update during execution. */
  onToolProgress?: (toolName: string, toolUseId: string, content: string) => void;
}

/**
 * The core agentic loop.
 *
 * Cycle: user message → API call → if tool_use → execute tools → inject results → loop
 * Continues until end_turn, max_turns, budget exhausted, or abort.
 */
export async function* agentLoop(
  params: AgentLoopParams
): AsyncGenerator<LoopEvent> {
  const {
    messages,
    systemPrompt,
    tools,
    model,
    maxTurns,
    maxBudgetUsd,
    signal,
    cwd,
    agentId,
    sessionId,
    thinkingBudgetTokens,
    onTextDelta,
    onThinkingDelta,
    onToolProgress,
  } = params;

  // Permission callback with "allow_all" state management.
  // When the user selects "allow_all", we wrap the callback to auto-approve.
  let permissionAllowAll = false;
  const permissionCallback: PermissionCallback | undefined =
    params.requestPermission
      ? async (req) => {
          if (permissionAllowAll) return "allow";
          const result = await params.requestPermission!(req);
          if (result === "allow_all") {
            permissionAllowAll = true;
            return "allow";
          }
          return result;
        }
      : undefined;

  const startTime = Date.now();
  let turnCount = 0;
  let currentMaxTokens = resolveMaxTokens(params.maxTokens);
  let maxTokensRecoveryCount = 0;
  const totalUsage: Usage = { input_tokens: 0, output_tokens: 0 };
  const costTracker = params.costTracker ?? new CostTracker();

  // Session-scoped set of files that have been read (for read-before-write enforcement)
  const readFiles = new Set<string>();

  let apiMessages: Anthropic.MessageParam[] = messagesToApi(messages);

  /** Helper to build a result event with cost included. */
  function makeResult(
    subtype: LoopEvent & { type: "result" } extends { subtype: infer S }
      ? S
      : never,
    extra: {
      stopReason: AssistantMessage["stop_reason"];
      resultText: string;
    }
  ): LoopEvent & { type: "result" } {
    return {
      type: "result",
      subtype,
      numTurns: turnCount,
      totalUsage,
      totalCostUsd: costTracker.getTotalCost(),
      durationMs: Date.now() - startTime,
      stopReason: extra.stopReason,
      resultText: extra.resultText,
    };
  }

  while (true) {
    if (signal?.aborted) return;

    // ── Max turns check ───────────────────────────────────────
    turnCount++;
    if (maxTurns && turnCount > maxTurns) {
      await executeHooks({ event: "Stop", stopReason: "max_turns", sessionId, agentId, cwd }).catch(() => {});
      yield makeResult("error_max_turns", {
        stopReason: null,
        resultText: `Reached max turns (${maxTurns})`,
      });
      return;
    }

    // ── Budget check ──────────────────────────────────────────
    if (maxBudgetUsd !== undefined && costTracker.getTotalCost() >= maxBudgetUsd) {
      await executeHooks({ event: "Stop", stopReason: "budget_exhausted", sessionId, agentId, cwd }).catch(() => {});
      yield makeResult("error_max_budget_usd", {
        stopReason: null,
        resultText: `Budget exhausted: ${formatCost(costTracker.getTotalCost())} spent of ${formatCost(maxBudgetUsd)} limit`,
      });
      return;
    }

    // ── Auto-compact check ──────────────────────────────────────
    if (needsCompaction(apiMessages, systemPrompt, model)) {
      await executeHooks({ event: "PreCompact", sessionId, agentId, cwd });
      const result = await compactConversation(
        apiMessages,
        systemPrompt,
        model
      );
      apiMessages = result.messages;

      yield {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: {
          trigger: "auto",
          pre_tokens: result.preTokens,
          post_tokens: result.postTokens,
        },
      };
    }

    // ── Budget context injection ────────────────────────────────
    // When a budget is set, append a transient (non-cached) segment so the
    // model knows how much budget remains and can self-regulate.
    let effectiveSystemPrompt = systemPrompt;
    if (maxBudgetUsd !== undefined) {
      const spent = costTracker.getTotalCost();
      const remaining = Math.max(0, maxBudgetUsd - spent);
      const pct = maxBudgetUsd > 0 ? ((spent / maxBudgetUsd) * 100).toFixed(0) : "0";
      effectiveSystemPrompt = [
        ...systemPrompt,
        {
          text: `\n[Budget: ${formatCost(remaining)} remaining of ${formatCost(maxBudgetUsd)} (${pct}% used). Be efficient with tool calls.]`,
          cacheHint: false, // Dynamic — don't cache
        },
      ];
    }

    // ── API call with retry ─────────────────────────────────────
    const toolSchemas = tools.getToolSchemas();
    const streamParams: StreamParams = {
      messages: apiMessages,
      system: effectiveSystemPrompt,
      tools: toolSchemas as Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
      model,
      maxTokens: currentMaxTokens,
      signal,
      thinkingBudgetTokens,
    };

    let assistantMessage: AssistantMessage | null = null;
    const maxRetries = getMaxRetries();

    try {
      for await (const event of streamMessage(streamParams)) {
        switch (event.type) {
          case "text_delta":
            onTextDelta?.(event.text);
            yield { type: "text_delta", text: event.text };
            break;
          case "thinking_delta":
            onThinkingDelta?.(event.thinking);
            yield { type: "thinking_delta", thinking: event.thinking };
            break;
          case "tool_use_start":
            yield {
              type: "tool_use_start",
              toolName: event.toolName,
              toolUseId: event.toolUseId,
            };
            break;
          case "retry":
            yield {
              type: "retry",
              attempt: event.attempt,
              maxRetries,
              delayMs: event.delayMs,
              error: event.error,
            };
            break;
          case "message_complete":
            assistantMessage = event.message;
            break;
        }
      }
    } catch (error) {
      // User abort — return immediately without error
      if (signal?.aborted) {
        yield makeResult("success", {
          stopReason: null,
          resultText: assistantMessage ? extractText(assistantMessage) : "",
        });
        return;
      }

      if (isContextOverflowError(error)) {
        const result = await compactConversation(
          apiMessages,
          systemPrompt,
          model
        );
        apiMessages = result.messages;

        yield {
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: {
            trigger: "auto",
            pre_tokens: result.preTokens,
            post_tokens: result.postTokens,
          },
        };

        turnCount--;
        continue;
      }

      const { category, message } = categorizeApiError(error);
      yield makeResult("error_during_execution", {
        stopReason: null,
        resultText: `API error (${category}): ${message}`,
      });
      return;
    }

    if (!assistantMessage) {
      yield makeResult("error_during_execution", {
        stopReason: null,
        resultText: "Error: No response from API",
      });
      return;
    }

    // ── Track usage + cost ──────────────────────────────────────
    totalUsage.input_tokens += assistantMessage.usage.input_tokens;
    totalUsage.output_tokens += assistantMessage.usage.output_tokens;
    totalUsage.cache_creation_input_tokens =
      (totalUsage.cache_creation_input_tokens ?? 0) +
      (assistantMessage.usage.cache_creation_input_tokens ?? 0);
    totalUsage.cache_read_input_tokens =
      (totalUsage.cache_read_input_tokens ?? 0) +
      (assistantMessage.usage.cache_read_input_tokens ?? 0);

    // Calculate and accumulate USD cost
    costTracker.addUsage(assistantMessage.usage, assistantMessage.model);

    // Yield the assistant message
    yield { type: "assistant", message: assistantMessage };

    apiMessages.push({
      role: "assistant",
      content: assistantMessage.content as Anthropic.ContentBlockParam[],
    });

    // ── Stop reason handling ────────────────────────────────────

    if (
      assistantMessage.stop_reason === "end_turn" ||
      assistantMessage.stop_reason === "stop_sequence"
    ) {
      // Fire blockable Stop hook (unless already inside a stop-hook continuation)
      if (!isStopHookActive()) {
        setStopHookActive(true);
        try {
          const stopResult = await executeHooks({
            event: "Stop",
            lastAssistantMessage: extractText(assistantMessage),
            stopReason: assistantMessage.stop_reason,
            sessionId,
            agentId,
            cwd,
          });
          if (stopResult.action === "block") {
            // Hook blocked the stop — inject a continuation message and loop
            const continueMsg = stopResult.message || "The stop was blocked by a hook. Please continue.";
            apiMessages.push({ role: "user", content: continueMsg });
            messages.push({
              type: "user",
              role: "user",
              content: continueMsg,
              uuid: uuid(),
              timestamp: timestamp(),
            });
            continue;
          }
        } finally {
          setStopHookActive(false);
        }
      }

      yield makeResult("success", {
        stopReason: assistantMessage.stop_reason,
        resultText: extractText(assistantMessage),
      });
      return;
    }

    if (assistantMessage.stop_reason === "max_tokens") {
      if (maxTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
        maxTokensRecoveryCount++;
        currentMaxTokens = Math.min(currentMaxTokens * 2, 128000);
        apiMessages.pop();
        turnCount--;
        continue;
      }

      await executeHooks({ event: "Stop", stopReason: "max_tokens", sessionId, agentId, cwd }).catch(() => {});
      yield makeResult("error_max_tokens", {
        stopReason: "max_tokens",
        resultText: `Response exceeded max output tokens after ${maxTokensRecoveryCount} recovery attempts (limit: ${currentMaxTokens}). Set CLAUDE_CODE_MAX_OUTPUT_TOKENS to configure.`,
      });
      return;
    }

    if (assistantMessage.stop_reason === "model_context_window_exceeded") {
      apiMessages.pop();

      const result = await compactConversation(
        apiMessages,
        systemPrompt,
        model
      );
      apiMessages = result.messages;

      yield {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: {
          trigger: "auto",
          pre_tokens: result.preTokens,
          post_tokens: result.postTokens,
        },
      };

      turnCount--;
      continue;
    }

    if (
      assistantMessage.stop_reason === "content_filtered" ||
      assistantMessage.stop_reason === "guardrail_intervened"
    ) {
      yield makeResult("error_during_execution", {
        stopReason: assistantMessage.stop_reason,
        resultText: `Response blocked: ${assistantMessage.stop_reason}`,
      });
      return;
    }

    // ── Tool execution ──────────────────────────────────────────
    const toolUseBlocks = assistantMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      yield makeResult("success", {
        stopReason: assistantMessage.stop_reason,
        resultText: extractText(assistantMessage),
      });
      return;
    }

    maxTokensRecoveryCount = 0;

    // Check abort before tool execution
    if (signal?.aborted) {
      yield makeResult("success", {
        stopReason: null,
        resultText: extractText(assistantMessage),
      });
      return;
    }

    // Yield detailed tool_use events with full input (for display)
    for (const block of toolUseBlocks) {
      yield {
        type: "tool_use_start",
        toolName: block.name,
        toolUseId: block.id,
        input: block.input as Record<string, unknown>,
      };
    }

    // Raise listener limit for concurrent tool execution (each tool adds
    // an abort listener; default limit of 10 triggers a warning with many
    // parallel tools).
    if (signal) {
      try { setMaxListeners(Math.max(toolUseBlocks.length + 10, 50), signal); } catch {}
    }

    // Collect additionalContext from PostToolUse hooks across all tool executions
    const collectedAdditionalContext: string[] = [];

    const toolContext: ToolContext = {
      cwd,
      abortSignal: signal,
      agentId,
      requestPermission: permissionCallback,
      parentMessages: messages,
      readFiles,
      onPreToolUse: async (toolName, input) => {
        const result = await executeHooks({
          event: "PreToolUse",
          toolName,
          toolInput: input,
          sessionId,
          agentId,
          cwd,
        });
        if (result.action === "block") {
          return { action: "block", message: result.message! };
        }
        return { action: "continue", updatedInput: result.updatedInput };
      },
      onPostToolUse: async (toolName, input, toolResult, isError) => {
        const result = await executeHooks({
          event: "PostToolUse",
          toolName,
          toolInput: input,
          toolResult,
          sessionId,
          agentId,
          cwd,
        });
        if (result.additionalContext) {
          collectedAdditionalContext.push(...result.additionalContext);
        }
        return result.additionalContext;
      },
      onPostToolUseFailure: async (toolName, input, error, isInterrupt) => {
        const result = await executeHooks({
          event: "PostToolUseFailure",
          toolName,
          toolInput: input,
          error,
          isInterrupt,
          sessionId,
          agentId,
          cwd,
        });
        if (result.additionalContext) {
          collectedAdditionalContext.push(...result.additionalContext);
        }
        return result.additionalContext;
      },
      onProgress: onToolProgress,
    };
    const toolResults = await executeToolUseBlocks(
      toolUseBlocks,
      tools,
      toolContext
    );

    // ── Post-process: Bash Output Analyzer ─────────────────────
    // When bash output exceeds the threshold (default 30K chars),
    // run intelligent summarization instead of blind truncation.
    for (const result of toolResults) {
      if (
        result.toolName === "Bash" &&
        !result.isError &&
        needsBashAnalysis(result.content)
      ) {
        // Extract the command from the corresponding tool_use block
        const toolBlock = toolUseBlocks.find((b) => b.id === result.toolUseId);
        const command =
          (toolBlock?.input as Record<string, unknown> | undefined)?.command as string | undefined;
        result.content = await analyzeBashOutput(
          command ?? "(unknown command)",
          result.content,
          model
        );
      }
    }

    const toolResultBlocks: ApiToolResultBlockParam[] = [];

    for (const result of toolResults) {
      yield {
        type: "tool_result",
        toolName: result.toolName,
        toolUseId: result.toolUseId,
        result: result.content,
        isError: result.isError,
      };

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: result.toolUseId,
        content: result.content,
        is_error: result.isError || undefined,
      });
    }

    apiMessages.push({
      role: "user",
      content: toolResultBlocks,
    });

    // Inject additionalContext from PostToolUse/PostToolUseFailure hooks
    if (collectedAdditionalContext.length > 0) {
      const contextText = collectedAdditionalContext.join("\n");
      apiMessages.push({ role: "user", content: contextText });
      messages.push({
        type: "user",
        role: "user",
        content: contextText,
        uuid: uuid(),
        timestamp: timestamp(),
      });
      collectedAdditionalContext.length = 0; // Reset for next turn
    }

    // Persist tool_result user message to the outer messages array.
    // Without this, the next interaction's messagesToApi() would produce
    // assistant(tool_use) → user(text) — missing the required tool_result,
    // causing an API validation error.
    messages.push({
      type: "user",
      role: "user",
      content: toolResultBlocks as ApiToolResultBlockParam[],
      uuid: uuid(),
      timestamp: timestamp(),
    });
  }
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export function messagesToApi(
  messages: ConversationMessage[]
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (msg.type === "user") {
      return {
        role: "user" as const,
        content:
          typeof msg.content === "string"
            ? msg.content
            : (msg.content as Anthropic.ToolResultBlockParam[]),
      };
    } else {
      return {
        role: "assistant" as const,
        content: msg.content as Anthropic.ContentBlockParam[],
      };
    }
  });
}
