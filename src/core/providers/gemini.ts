/**
 * Google Gemini LLM provider.
 *
 * Uses raw fetch (no SDK dependency) to call the Gemini API.
 * Supports streaming, tool use (function calling), and thinking (2.5+).
 *
 * Configuration via env vars:
 *   GEMINI_API_KEY   — API key (required)
 *   GOOGLE_API_KEY   — Alias for GEMINI_API_KEY
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

// ── Config ───────────────────────────────────────────────────────

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY (or GOOGLE_API_KEY) not set"
    );
  }
  return key;
}

// ── Gemini types (minimal) ───────────────────────────────────────

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: string } };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { role: string; parts: GeminiPart[] };
    finishReason?: string | null;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { role: string; parts: GeminiPart[] };
    finishReason?: string | null;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// ── JSON Schema sanitization for Gemini ──────────────────────────
//
// Gemini's API is strict about JSON Schema. Our Zod-derived schemas
// contain fields Gemini rejects (additionalProperties, $schema,
// type arrays, anyOf with null, unsupported format values, etc.).
// This sanitizer cleans schemas to be Gemini-compatible.

/** Fields Gemini accepts in JSON Schema objects. */
const ALLOWED_SCHEMA_FIELDS = new Set([
  "type", "format", "title", "description", "nullable",
  "enum", "maxItems", "minItems", "properties", "required",
  "items", "minimum", "maximum", "default",
]);

/**
 * Recursively sanitize a JSON Schema object for Gemini compatibility.
 */
function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Handle type arrays like ["string", "null"] → type: "string", nullable: true
  if (Array.isArray(schema.type)) {
    const types = schema.type as string[];
    const nonNull = types.filter((t) => t !== "null");
    if (types.includes("null")) {
      result.nullable = true;
    }
    result.type = nonNull.length === 1 ? nonNull[0] : nonNull[0] ?? "string";
  }

  // Handle anyOf with null type: anyOf: [{type: "null"}, {type: "object", ...}]
  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf as Array<Record<string, unknown>>;
    const nonNull = variants.filter((v) => v.type !== "null");
    if (nonNull.length === 1 && variants.length > nonNull.length) {
      // Collapse anyOf into the non-null variant + nullable
      const collapsed = sanitizeSchema(nonNull[0]);
      collapsed.nullable = true;
      return collapsed;
    }
    // If multiple non-null variants, just use the first one
    if (nonNull.length > 0) {
      return sanitizeSchema(nonNull[0]);
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && !result.type) {
      result.type = value;
    } else if (key === "anyOf") {
      // Already handled above
      continue;
    } else if (!ALLOWED_SCHEMA_FIELDS.has(key)) {
      // Strip unsupported fields ($schema, additionalProperties, etc.)
      continue;
    } else if (key === "enum" && result.type !== "string" && schema.type !== "string") {
      // Gemini only supports enum on string types
      continue;
    } else if (key === "format" && typeof value === "string") {
      // Only keep formats Gemini supports
      if (value === "date-time" || value === "enum") {
        result[key] = value;
      }
      // Skip unsupported format values (int32, int64, uri, etc.)
    } else if (key === "properties" && typeof value === "object" && value !== null) {
      // Recursively sanitize nested property schemas
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(
        value as Record<string, unknown>
      )) {
        if (typeof propSchema === "object" && propSchema !== null) {
          props[propName] = sanitizeSchema(propSchema as Record<string, unknown>);
        } else {
          props[propName] = propSchema;
        }
      }
      result[key] = props;
    } else if (key === "items" && typeof value === "object" && value !== null) {
      result[key] = sanitizeSchema(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  // Ensure type is present (default to "string")
  if (!result.type) {
    result.type = "string";
  }

  return result;
}

/**
 * Try to parse JSON, falling back to empty object on failure.
 */
function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// ── Format conversion ────────────────────────────────────────────

/**
 * Convert our internal (Anthropic-shaped) messages to Gemini contents.
 *
 * Key differences from Anthropic:
 * - Gemini uses "model" instead of "assistant"
 * - tool_use blocks → functionCall parts
 * - tool_result blocks → functionResponse parts (need name lookup)
 * - System prompt is passed separately as system_instruction
 *
 * Returns [contents, toolUseIdToName map] — the map is used for
 * functionResponse name lookups and synthetic ID tracking.
 */
function toGeminiContents(
  messages: Array<{ role: string; content: unknown }>
): [GeminiContent[], Map<string, string>] {
  const contents: GeminiContent[] = [];
  const toolUseIdToName = new Map<string, string>();

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        contents.push({ role: "model", parts: [{ text: msg.content }] });
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content as Array<Record<string, unknown>>;
        const parts: GeminiPart[] = [];

        for (const block of blocks) {
          if (block.type === "text") {
            parts.push({ text: String(block.text ?? "") });
          } else if (block.type === "thinking") {
            parts.push({ text: String(block.thinking ?? ""), thought: true });
          } else if (block.type === "tool_use") {
            const id = String(block.id);
            const name = String(block.name);
            toolUseIdToName.set(id, name);
            parts.push({
              functionCall: {
                name,
                args: (block.input as Record<string, unknown>) ?? {},
              },
            });
          }
        }

        // Gemini rejects messages with empty parts arrays
        contents.push({
          role: "model",
          parts: parts.length > 0 ? parts : [{ text: "" }],
        });
      }
    } else if (msg.role === "user") {
      if (typeof msg.content === "string") {
        contents.push({ role: "user", parts: [{ text: msg.content }] });
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content as Array<Record<string, unknown>>;
        const parts: GeminiPart[] = [];

        for (const block of blocks) {
          if (block.type === "text") {
            parts.push({ text: String(block.text ?? "") });
          } else if (block.type === "tool_result") {
            const toolUseId = String(block.tool_use_id);
            const name = toolUseIdToName.get(toolUseId) ?? "unknown";
            const content =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? "");
            parts.push({
              functionResponse: {
                name,
                response: { result: content },
              },
            });
          }
        }

        // Gemini rejects messages with empty parts arrays
        contents.push({
          role: "user",
          parts: parts.length > 0 ? parts : [{ text: "" }],
        });
      }
    }
  }

  return [contents, toolUseIdToName];
}

/**
 * Convert system prompt segments to Gemini system_instruction.
 */
function toSystemInstruction(
  system: SystemPrompt
): { parts: Array<{ text: string }> } | undefined {
  const text = system.map((s) => s.text).join("\n\n");
  if (!text) return undefined;
  return { parts: [{ text }] };
}

/**
 * Convert our tool schemas to Gemini function declarations.
 * Sanitizes JSON Schemas to be Gemini-compatible.
 */
function toGeminiTools(
  tools: ToolSchema[]
): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> | undefined {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeSchema(t.input_schema),
      })),
    },
  ];
}

/**
 * Map Gemini finishReason to our StopReason.
 */
function mapFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
      return "content_filtered";
    default:
      return (reason as StopReason) ?? null;
  }
}

// Re-export generic SSE parser typed for Gemini chunks
import { parseSSE as genericParseSSE } from "./sse-parser.js";

function parseSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<GeminiStreamChunk> {
  return genericParseSSE<GeminiStreamChunk>(reader);
}

// ── Provider implementation ──────────────────────────────────────

export class GeminiProvider implements LLMProvider {
  name = "gemini";

  /** Counter for generating synthetic tool use IDs. */
  private toolCallCounter = 0;

  async *streamOnce(
    params: ProviderStreamParams
  ): AsyncGenerator<ProviderStreamYield> {
    const apiKey = getApiKey();
    const [contents] = toGeminiContents(params.messages);
    const systemInstruction = toSystemInstruction(params.system);
    const tools = toGeminiTools(params.tools);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: params.maxTokens,
      },
    };

    if (systemInstruction) {
      body.system_instruction = systemInstruction;
    }

    if (tools) {
      body.tools = tools;
    }

    // Thinking support (Gemini 2.5+)
    if (params.thinkingBudgetTokens) {
      const genConfig = body.generationConfig as Record<string, unknown>;
      const thinkingConfig: Record<string, unknown> = {
        includeThoughts: true,
      };

      if (params.model.includes("gemini-3")) {
        // Gemini 3 models use thinkingLevel instead of thinkingBudget
        if (params.thinkingBudgetTokens <= 1024) {
          thinkingConfig.thinkingLevel = "low";
        } else if (params.thinkingBudgetTokens <= 8192) {
          thinkingConfig.thinkingLevel = "medium";
        } else {
          thinkingConfig.thinkingLevel = "high";
        }
      } else {
        // Gemini 2.5 models use thinkingBudget (token count)
        thinkingConfig.thinkingBudget = params.thinkingBudgetTokens;
      }

      genConfig.thinkingConfig = thinkingConfig;
    }

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

    const url = `${BASE_URL}/models/${params.model}:streamGenerateContent?alt=sse`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const error = new Error(
        `Gemini API ${response.status}: ${errorBody.slice(0, 500)}`
      ) as Error & { status: number; headers: Record<string, string> };
      error.status = response.status;
      error.headers = {};
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) error.headers["retry-after"] = retryAfter;
      throw error;
    }

    if (!response.body) {
      throw new Error("No response body from Gemini API");
    }

    const reader = response.body.getReader();

    // Accumulate the full message as we stream
    let fullText = "";
    let fullThinking = "";
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    let finishReason: string | null = null;
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of parseSSE(reader)) {
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount ?? 0;
        completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      if (candidate.finishReason) {
        finishReason = candidate.finishReason;
      }

      const parts = candidate.content?.parts;
      if (!parts) continue;

      for (const part of parts) {
        if (part.functionCall) {
          const syntheticId = `gemini_call_${this.toolCallCounter++}`;
          const fc = part.functionCall;
          // Gemini may return args as a string or malformed object
          let args = fc.args;
          if (typeof args === "string") {
            args = safeParseJson(args);
          }
          toolCalls.push({
            id: syntheticId,
            name: fc.name,
            args: args ?? {},
          });
          yield {
            type: "tool_use_start",
            toolName: fc.name,
            toolUseId: syntheticId,
          };
        } else if (part.thought && part.text) {
          fullThinking += part.text;
          yield { type: "thinking_delta", thinking: part.text };
        } else if (part.text) {
          fullText += part.text;
          yield { type: "text_delta", text: part.text };
        }
      }
    }

    // Build the assembled assistant message in our internal (Anthropic-shaped) format
    const contentBlocks: Array<Record<string, unknown>> = [];

    if (fullThinking) {
      contentBlocks.push({ type: "thinking", thinking: fullThinking });
    }

    if (fullText) {
      contentBlocks.push({ type: "text", text: fullText });
    }

    for (const tc of toolCalls) {
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.args,
      });
    }

    // If tool calls present, stop_reason should be tool_use
    const stopReason = toolCalls.length > 0
      ? "tool_use" as StopReason
      : mapFinishReason(finishReason);

    const assistantMessage: AssistantMessage = {
      type: "assistant",
      role: "assistant",
      content: contentBlocks as unknown as AssistantMessage["content"],
      model: params.model,
      stop_reason: stopReason,
      usage: {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
      },
      uuid: uuid(),
      timestamp: timestamp(),
    };

    yield { type: "message_complete", message: assistantMessage };
  }

  async complete(
    params: ProviderCompleteParams
  ): Promise<ProviderCompleteResult> {
    const apiKey = getApiKey();

    const contents: GeminiContent[] = params.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url = `${BASE_URL}/models/${params.model}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: params.maxTokens,
        },
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Gemini API ${response.status}: ${errorBody.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text!)
      .join("");

    return {
      text,
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  supports(feature: "thinking" | "caching" | "tool_use"): boolean {
    switch (feature) {
      case "thinking":
        return true; // Gemini 2.5+ supports thinking
      case "caching":
        return false;
      case "tool_use":
        return true;
    }
  }
}
