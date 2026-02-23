/**
 * LLM Provider abstraction.
 *
 * Defines the interface that all LLM providers must implement.
 * Our internal message format is Anthropic-shaped (ContentBlock arrays),
 * and each provider translates to/from its native format at the API boundary.
 */

import type { AssistantMessage, SystemPrompt, StopReason } from "../types.js";

// ── Provider-agnostic tool schema ────────────────────────────────

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ── Stream parameters ────────────────────────────────────────────

export interface ProviderStreamParams {
  /**
   * Messages in our internal format (Anthropic-shaped).
   * Each element has { role: "user"|"assistant", content: string | ContentBlock[] }.
   * The provider translates to its native format.
   */
  messages: Array<{ role: string; content: unknown }>;
  system: SystemPrompt;
  tools: ToolSchema[];
  model: string;
  maxTokens: number;
  signal?: AbortSignal;
  /** Extended thinking budget (Anthropic-only; ignored by providers that don't support it). */
  thinkingBudgetTokens?: number;
  /** Optional JSON schema for structured output (provider-specific support). */
  responseSchema?: Record<string, unknown>;
}

// ── Stream events (same as streaming.ts yields) ──────────────────

export type ProviderStreamYield =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_use_start"; toolName: string; toolUseId: string }
  | { type: "message_complete"; message: AssistantMessage }
  | { type: "retry"; attempt: number; delayMs: number; error: string };

// ── Non-streaming completion ─────────────────────────────────────

export interface ProviderCompleteParams {
  model: string;
  maxTokens: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ProviderCompleteResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

// ── Provider interface ───────────────────────────────────────────

export interface LLMProvider {
  /** Provider name (e.g., "anthropic", "openai"). */
  name: string;

  /**
   * Execute a single streaming API call.
   * Yields stream events for display and assembles the final message.
   * Does NOT handle retries — the caller handles retry logic.
   */
  streamOnce(params: ProviderStreamParams): AsyncGenerator<ProviderStreamYield>;

  /**
   * Non-streaming completion call.
   * Used for auxiliary tasks like conversation compaction.
   */
  complete(params: ProviderCompleteParams): Promise<ProviderCompleteResult>;

  /** Whether this provider supports a given feature. */
  supports(feature: "thinking" | "caching" | "tool_use"): boolean;
}
