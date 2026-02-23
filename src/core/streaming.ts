/**
 * Streaming API client with retry logic.
 *
 * This module is the single entry point for all LLM API calls.
 * It delegates to the active provider (Anthropic, OpenAI, etc.)
 * and wraps calls with retry/backoff logic.
 *
 * Retry strategy (matches original Rw1):
 * - Up to 10 retries (configurable via CLAUDE_CODE_MAX_RETRIES)
 * - Exponential backoff: min(500ms * 2^attempt, 32s) + 0-25% jitter
 * - Retries on: 429, 500+, connection errors, overloaded
 * - Context overflow: auto-adjusts max_tokens and retries
 * - Respects retry-after headers
 */

import type {
  AssistantMessage,
  SystemPrompt,
} from "./types.js";
import { getProvider, type ProviderStreamYield } from "./providers/index.js";
import {
  getMaxRetries,
  calculateRetryDelay,
  sleep,
  isRetryableError,
  parseRetryAfter,
  parseContextOverflow,
  isOverloadedError,
} from "./retry.js";

// Re-export the Anthropic client getter for backward compatibility
// (used by context.ts compaction — will be migrated to provider.complete())
export { getAnthropicClient as getClient } from "./providers/anthropic.js";

export interface StreamParams {
  messages: Array<{ role: string; content: unknown }>;
  system: SystemPrompt;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  model: string;
  maxTokens: number;
  signal?: AbortSignal;
  /** If set, enables extended thinking with this budget (tokens). Must be >= 1024. */
  thinkingBudgetTokens?: number;
}

export type StreamYield = ProviderStreamYield;

/**
 * Stream a message from the LLM API with retry logic.
 *
 * Delegates to the active provider's streamOnce() and wraps
 * with retry/backoff logic.
 */
export async function* streamMessage(
  params: StreamParams
): AsyncGenerator<StreamYield> {
  const provider = getProvider();
  const maxRetries = getMaxRetries();
  let currentMaxTokens = params.maxTokens;
  let consecutiveOverloaded = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Delegate to the active provider
      yield* provider.streamOnce({
        messages: params.messages,
        system: params.system,
        tools: params.tools,
        model: params.model,
        maxTokens: currentMaxTokens,
        signal: params.signal,
        thinkingBudgetTokens: params.thinkingBudgetTokens,
      });
      return; // Success — exit retry loop
    } catch (error) {
      // Check abort — don't retry if user cancelled
      if (params.signal?.aborted) throw error;

      // Context overflow — adjust max_tokens and retry immediately
      const adjustedTokens = parseContextOverflow(error, currentMaxTokens);
      if (adjustedTokens !== null) {
        currentMaxTokens = adjustedTokens;
        attempt--; // Don't count as a retry attempt
        continue;
      }

      // Track consecutive overloaded errors
      if (isOverloadedError(error)) {
        consecutiveOverloaded++;
      } else {
        consecutiveOverloaded = 0;
      }

      // Not retryable or exhausted retries — throw
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      // Calculate delay
      const retryAfterMs = parseRetryAfter(error);
      const delayMs = calculateRetryDelay(attempt, retryAfterMs);

      // Yield retry event for display
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      yield {
        type: "retry",
        attempt: attempt + 1,
        delayMs: Math.round(delayMs),
        error: errorMsg.slice(0, 200),
      };

      // Wait before retrying
      await sleep(delayMs, params.signal);
    }
  }
}
