/**
 * OpenAI-compatible LLM provider.
 *
 * Uses raw fetch (no openai npm dependency) so it works with ANY
 * OpenAI-compatible API out of the box:
 *   - OpenAI (GPT-4o, GPT-4.5, o1, o3)
 *   - Azure OpenAI
 *   - Qwen (Alibaba)
 *   - Together AI
 *   - Groq
 *   - Mistral (via OpenAI compat endpoint)
 *   - Ollama (local)
 *   - LM Studio (local)
 *   - vLLM, text-generation-inference, etc.
 *
 * Configuration via env vars:
 *   OPENAI_API_KEY     — API key (required for cloud providers, optional for local)
 *   OPENAI_BASE_URL    — Base URL (default: https://api.openai.com/v1)
 *   OPENAI_MODEL       — Default model (default: gpt-4o)
 */

import type {
  LLMProvider,
  ProviderStreamParams,
  ProviderStreamYield,
  ProviderCompleteParams,
  ProviderCompleteResult,
  ToolSchema,
} from "./base.js";
import type { AssistantMessage, StopReason, SystemPrompt } from "../types.js";
import { uuid, timestamp } from "../../utils.js";
import {
  getOpenAIModelCaps,
  getAlternateTokenParam,
  type ModelParamCaps,
} from "../model-params.js";

// ── Config ───────────────────────────────────────────────────────

function getBaseUrl(): string {
  return (
    process.env.OPENAI_BASE_URL ||
    process.env.OPENAI_API_BASE || // Common alias
    "https://api.openai.com/v1"
  );
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Allow empty key for local servers (Ollama, LM Studio)
    const baseUrl = getBaseUrl();
    if (
      baseUrl.includes("localhost") ||
      baseUrl.includes("127.0.0.1") ||
      baseUrl.includes("0.0.0.0")
    ) {
      return "";
    }
    throw new Error("OPENAI_API_KEY not set");
  }
  return key;
}

// ── Model capability helpers ─────────────────────────────────────

/** True when the configured endpoint is official OpenAI or Azure OpenAI. */
function isOfficialOpenAI(): boolean {
  const url = getBaseUrl().toLowerCase();
  return url.includes("api.openai.com") || url.includes("openai.azure.com");
}

/**
 * Session-level cache for learned parameter overrides.
 * When error-based fallback discovers that a model needs a different token
 * param, the override is cached here so subsequent requests skip the
 * initial failed attempt.
 */
const paramOverrideCache = new Map<string, Partial<ModelParamCaps>>();

/** Merge static config + cached runtime overrides. */
function getEffectiveCaps(model: string): ModelParamCaps {
  const base = getOpenAIModelCaps(model, isOfficialOpenAI());
  const override = paramOverrideCache.get(model);
  return override ? { ...base, ...override } : base;
}

/**
 * Build the request body with the correct parameter names for the model.
 */
function buildOpenAIBody(
  model: string,
  maxTokens: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const caps = getEffectiveCaps(model);
  const body: Record<string, unknown> = {
    model,
    [caps.tokenParam]: maxTokens,
    ...extra,
  };
  return body;
}

/**
 * Try to extract a rejected parameter name from an OpenAI 400 error body.
 * Returns the param name if found, or null.
 *
 * Known error patterns:
 *   "Unsupported parameter: 'max_tokens'"
 *   "Unknown parameter: 'max_completion_tokens'"
 */
function parseParamRejection(
  errorBody: string
): "max_tokens" | "max_completion_tokens" | null {
  const match = errorBody.match(
    /(?:unsupported|unknown|invalid)\s+parameter[:\s]*['"`]?(max_tokens|max_completion_tokens)['"`]?/i
  );
  if (!match) return null;
  return match[1] as "max_tokens" | "max_completion_tokens";
}

// ── OpenAI types (minimal, for our use) ──────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model?: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model: string;
}

// ── Format conversion ────────────────────────────────────────────

/**
 * Convert our internal (Anthropic-shaped) messages to OpenAI chat format.
 *
 * Key differences:
 * - System prompt is a separate "system" role message
 * - tool_use content blocks → assistant.tool_calls array
 * - tool_result content blocks → separate "tool" role messages
 * - Anthropic can have mixed text + tool_use in one message;
 *   OpenAI uses content + tool_calls on the same message
 */
function toOpenAIMessages(
  messages: Array<{ role: string; content: unknown }>,
  system: SystemPrompt
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // System message from our system prompt segments
  const systemText = system.map((s) => s.text).join("\n\n");
  if (systemText) {
    result.push({ role: "system", content: systemText });
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Could be text blocks or tool_result blocks
        const blocks = msg.content as Array<Record<string, unknown>>;

        const toolResults = blocks.filter((b) => b.type === "tool_result");
        const textBlocks = blocks.filter((b) => b.type === "text");

        // Each tool_result → separate "tool" role message
        for (const block of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: String(block.tool_use_id),
            content: String(block.content ?? ""),
          });
        }

        // Text blocks → user message
        if (textBlocks.length > 0) {
          const text = textBlocks
            .map((b) => String(b.text ?? ""))
            .join("\n");
          if (text.trim()) {
            result.push({ role: "user", content: text });
          }
        }

        // If only tool results (no text), that's fine — they're already added
        if (toolResults.length === 0 && textBlocks.length === 0) {
          // Fallback: serialize as text
          result.push({
            role: "user",
            content: JSON.stringify(msg.content),
          });
        }
      }
    } else if (msg.role === "assistant") {
      if (msg.content == null) {
        // Guard against null/undefined content (e.g. from cross-provider session resume)
        result.push({ role: "assistant", content: "" });
      } else if (typeof msg.content === "string") {
        result.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content as Array<Record<string, unknown>>;

        const textParts = blocks
          .filter((b) => b.type === "text")
          .map((b) => String(b.text ?? ""))
          .join("\n");

        const toolCalls = blocks
          .filter((b) => b.type === "tool_use")
          .map((b) => ({
            id: String(b.id),
            type: "function" as const,
            function: {
              name: String(b.name),
              arguments: JSON.stringify(b.input ?? {}),
            },
          }));

        const assistantMsg: OpenAIMessage = {
          role: "assistant",
          content: textParts || "",
        };

        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }

        result.push(assistantMsg);
      }
    }
  }

  return result;
}

/**
 * Convert our tool schemas to OpenAI function format.
 */
function toOpenAITools(tools: ToolSchema[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Convert OpenAI finish_reason to our stop_reason.
 */
function mapFinishReason(reason: string | null): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "content_filtered";
    default:
      return reason as StopReason;
  }
}

// Re-export generic SSE parser typed for OpenAI chunks
import { parseSSE as genericParseSSE } from "./sse-parser.js";

function parseSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<OpenAIStreamChunk> {
  return genericParseSSE<OpenAIStreamChunk>(reader);
}

// ── Provider implementation ──────────────────────────────────────

export class OpenAICompatProvider implements LLMProvider {
  name = "openai";

  async *streamOnce(
    params: ProviderStreamParams
  ): AsyncGenerator<ProviderStreamYield> {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    const messages = toOpenAIMessages(params.messages, params.system);
    const tools = toOpenAITools(params.tools);

    const extraFields: Record<string, unknown> = {
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools.length > 0) {
      extraFields.tools = tools;
    }

    let body = buildOpenAIBody(params.model, params.maxTokens, extraFields);

    // Wire abort signal
    const controller = new AbortController();
    if (params.signal) {
      if (params.signal.aborted) {
        controller.abort();
      } else {
        params.signal.addEventListener(
          "abort",
          () => controller.abort(),
          { once: true }
        );
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");

      // Layer 3: error-based fallback for rejected token param
      if (response.status === 400) {
        const rejected = parseParamRejection(errorText);
        if (rejected) {
          const alt = getAlternateTokenParam(rejected);
          // Cache the override so future requests use the right param
          paramOverrideCache.set(params.model, { tokenParam: alt });
          // Rebuild body with corrected param and retry once
          body = buildOpenAIBody(params.model, params.maxTokens, extraFields);
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!response.ok) {
            const retryError = await response.text().catch(() => "");
            const error = new Error(
              `OpenAI API ${response.status}: ${retryError.slice(0, 500)}`
            ) as Error & { status: number; headers: Record<string, string> };
            error.status = response.status;
            error.headers = {};
            const retryAfter = response.headers.get("retry-after");
            if (retryAfter) error.headers["retry-after"] = retryAfter;
            throw error;
          }
        } else {
          const error = new Error(
            `OpenAI API ${response.status}: ${errorText.slice(0, 500)}`
          ) as Error & { status: number; headers: Record<string, string> };
          error.status = response.status;
          error.headers = {};
          throw error;
        }
      } else {
        const error = new Error(
          `OpenAI API ${response.status}: ${errorText.slice(0, 500)}`
        ) as Error & { status: number; headers: Record<string, string> };
        error.status = response.status;
        error.headers = {};
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) error.headers["retry-after"] = retryAfter;
        throw error;
      }
    }

    if (!response.body) {
      throw new Error("No response body from OpenAI API");
    }

    const reader = response.body.getReader();

    // Accumulate the full message as we stream
    let fullText = "";
    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let finishReason: string | null = null;
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    let responseModel = params.model;

    for await (const chunk of parseSSE(reader)) {
      if (chunk.usage) {
        usage = chunk.usage;
      }
      if (chunk.model) {
        responseModel = chunk.model;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta;

      // Text delta
      if (delta.content) {
        fullText += delta.content;
        yield { type: "text_delta", text: delta.content };
      }

      // Tool call deltas (streamed incrementally)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (!existing) {
            // New tool call
            const entry = {
              id: tc.id ?? `call_${tc.index}`,
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
            };
            toolCalls.set(tc.index, entry);

            if (entry.name) {
              yield {
                type: "tool_use_start",
                toolName: entry.name,
                toolUseId: entry.id,
              };
            }
          } else {
            // Append to existing tool call
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments)
              existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    // Build the assembled assistant message in our internal (Anthropic-shaped) format
    const contentBlocks: Array<Record<string, unknown>> = [];

    if (fullText) {
      contentBlocks.push({ type: "text", text: fullText });
    }

    for (const [, tc] of toolCalls) {
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(tc.arguments);
      } catch {
        parsedInput = {};
      }
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: parsedInput,
      });
    }

    const assistantMessage: AssistantMessage = {
      type: "assistant",
      role: "assistant",
      content: contentBlocks as unknown as AssistantMessage["content"],
      model: responseModel,
      stop_reason: mapFinishReason(finishReason),
      usage: {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
      },
      uuid: uuid(),
      timestamp: timestamp(),
    };

    yield { type: "message_complete", message: assistantMessage };
  }

  async complete(
    params: ProviderCompleteParams
  ): Promise<ProviderCompleteResult> {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let body = buildOpenAIBody(params.model, params.maxTokens, {
      messages: params.messages,
    });

    let response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");

      // Error-based fallback for rejected token param
      if (response.status === 400) {
        const rejected = parseParamRejection(errorText);
        if (rejected) {
          const alt = getAlternateTokenParam(rejected);
          paramOverrideCache.set(params.model, { tokenParam: alt });
          body = buildOpenAIBody(params.model, params.maxTokens, {
            messages: params.messages,
          });
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: params.signal,
          });
          if (!response.ok) {
            const retryError = await response.text().catch(() => "");
            throw new Error(
              `OpenAI API ${response.status}: ${retryError.slice(0, 500)}`
            );
          }
        } else {
          throw new Error(
            `OpenAI API ${response.status}: ${errorText.slice(0, 500)}`
          );
        }
      } else {
        throw new Error(
          `OpenAI API ${response.status}: ${errorText.slice(0, 500)}`
        );
      }
    }

    const data = (await response.json()) as OpenAIResponse;
    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  supports(feature: "thinking" | "caching" | "tool_use"): boolean {
    switch (feature) {
      case "thinking":
        return false; // OpenAI reasoning (o1/o3) works differently
      case "caching":
        return false; // No prompt caching equivalent
      case "tool_use":
        return true;
    }
  }
}
