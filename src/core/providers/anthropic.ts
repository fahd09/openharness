/**
 * Anthropic Claude provider.
 *
 * Wraps the @anthropic-ai/sdk to implement the LLMProvider interface.
 * This is the default provider — our internal message format is Anthropic-shaped,
 * so this provider mostly passes messages through.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderStreamParams,
  ProviderStreamYield,
  ProviderCompleteParams,
  ProviderCompleteResult,
} from "./base.js";
import type { AssistantMessage, StopReason, SystemPrompt } from "../types.js";
import { uuid, timestamp } from "../../utils.js";

// ── Client singleton ─────────────────────────────────────────────

let clientInstance: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!clientInstance) {
    clientInstance = new Anthropic({
      maxRetries: 0, // We handle retries ourselves
      timeout: parseInt(process.env.API_TIMEOUT_MS || "600000", 10),
    });
  }
  return clientInstance;
}

// ── Helpers ──────────────────────────────────────────────────────

function isCachingDisabled(model: string): boolean {
  if (process.env.DISABLE_PROMPT_CACHING) return true;
  if (process.env.DISABLE_PROMPT_CACHING_HAIKU && model.includes("haiku"))
    return true;
  if (process.env.DISABLE_PROMPT_CACHING_SONNET && model.includes("sonnet"))
    return true;
  if (process.env.DISABLE_PROMPT_CACHING_OPUS && model.includes("opus"))
    return true;
  return false;
}

function systemToApi(
  prompt: SystemPrompt,
  model: string
): Anthropic.TextBlockParam[] {
  const disableCache = isCachingDisabled(model);

  return prompt.map((segment) => ({
    type: "text" as const,
    text: segment.text,
    ...(segment.cacheHint && !disableCache
      ? { cache_control: { type: "ephemeral" as const } }
      : {}),
  }));
}

function buildThinkingConfig(
  budgetTokens: number | undefined,
  maxTokens: number
): Anthropic.ThinkingConfigParam | undefined {
  if (!budgetTokens || budgetTokens < 1024) return undefined;
  const effectiveBudget = Math.min(budgetTokens, maxTokens - 1);
  if (effectiveBudget < 1024) return undefined;
  return {
    type: "enabled",
    budget_tokens: effectiveBudget,
  };
}

// ── Provider implementation ──────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";

  async *streamOnce(
    params: ProviderStreamParams
  ): AsyncGenerator<ProviderStreamYield> {
    const client = getAnthropicClient();
    const thinking = buildThinkingConfig(
      params.thinkingBudgetTokens,
      params.maxTokens
    );

    const stream = client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      system: systemToApi(params.system, params.model),
      messages: params.messages as Anthropic.MessageParam[],
      tools:
        params.tools.length > 0
          ? (params.tools as Anthropic.Tool[])
          : undefined,
      ...(thinking ? { thinking } : {}),
    });

    // Wire abort signal
    if (params.signal) {
      const onAbort = () => stream.abort();
      params.signal.addEventListener("abort", onAbort, { once: true });
    }

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "tool_use") {
            yield {
              type: "tool_use_start",
              toolName: event.content_block.name,
              toolUseId: event.content_block.id,
            };
          }
          break;
        }
        case "content_block_delta": {
          if (
            event.delta.type === "text_delta" &&
            "text" in event.delta
          ) {
            yield { type: "text_delta", text: event.delta.text };
          }
          if (
            event.delta.type === "thinking_delta" &&
            "thinking" in event.delta
          ) {
            yield {
              type: "thinking_delta",
              thinking: event.delta.thinking,
            };
          }
          break;
        }
      }
    }

    // Get the final assembled message
    const finalMessage = await stream.finalMessage();

    const assistantMessage: AssistantMessage = {
      type: "assistant",
      role: "assistant",
      content: finalMessage.content,
      model: finalMessage.model,
      stop_reason: finalMessage.stop_reason as StopReason,
      usage: {
        input_tokens: finalMessage.usage.input_tokens,
        output_tokens: finalMessage.usage.output_tokens,
        cache_creation_input_tokens:
          (finalMessage.usage as unknown as Record<string, number>)
            .cache_creation_input_tokens ?? 0,
        cache_read_input_tokens:
          (finalMessage.usage as unknown as Record<string, number>)
            .cache_read_input_tokens ?? 0,
      },
      uuid: uuid(),
      timestamp: timestamp(),
    };

    yield { type: "message_complete", message: assistantMessage };
  }

  async complete(
    params: ProviderCompleteParams
  ): Promise<ProviderCompleteResult> {
    const client = getAnthropicClient();

    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: params.messages,
    });

    const text =
      response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n") || "";

    return {
      text,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }

  supports(feature: "thinking" | "caching" | "tool_use"): boolean {
    return true; // Anthropic supports all features
  }
}
