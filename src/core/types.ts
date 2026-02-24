import type Anthropic from "@anthropic-ai/sdk";

// Re-export useful SDK types
export type ApiMessage = Anthropic.MessageParam;
export type ApiContentBlock = Anthropic.ContentBlock;
export type ApiToolUseBlock = Anthropic.ToolUseBlock;
export type ApiToolResultBlockParam = Anthropic.ToolResultBlockParam;
export type ApiTextBlock = Anthropic.TextBlock;
export type ApiMessageCreateParams = Anthropic.MessageCreateParamsStreaming;

// System prompt as cacheable segments
// Each segment is a block of text. The last segment marked cacheHint=true
// gets cache_control: { type: "ephemeral" }, telling the API to cache
// everything up to that point. This saves re-processing ~10K tokens/turn.
export interface SystemPromptSegment {
  text: string;
  cacheHint: boolean; // Whether to add cache_control breakpoint here
}

/** Per-plugin-segment metadata for token breakdown in /cost. */
export interface PromptSegmentDetail {
  id: string;
  position: "static" | "dynamic" | "volatile";
  charCount: number;
}

export type SystemPrompt = SystemPromptSegment[];

/** Result of building the system prompt — includes segment metadata for diagnostics. */
export interface SystemPromptResult {
  segments: SystemPrompt;
  details: PromptSegmentDetail[];
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "tool_use"
  | "stop_sequence"
  | "content_filtered"
  | "guardrail_intervened"
  | "model_context_window_exceeded"
  | null;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Our internal conversation message types
export interface UserMessage {
  type: "user";
  role: "user";
  content: string | ApiToolResultBlockParam[];
  uuid: string;
  timestamp: string;
}

export interface AssistantMessage {
  type: "assistant";
  role: "assistant";
  content: ApiContentBlock[];
  model: string;
  stop_reason: StopReason;
  usage: Usage;
  uuid: string;
  timestamp: string;
}

export type ConversationMessage = UserMessage | AssistantMessage;

// Events yielded by the agentic loop
export interface AssistantEvent {
  type: "assistant";
  message: AssistantMessage;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolName: string;
  toolUseId: string;
  result: string;
  isError: boolean;
}

export interface TextDeltaEvent {
  type: "text_delta";
  text: string;
}

export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  thinking: string;
}

export interface ToolUseStartEvent {
  type: "tool_use_start";
  toolName: string;
  toolUseId: string;
  /** Full tool input — available after message_complete, absent during streaming. */
  input?: Record<string, unknown>;
}

export interface CompactEvent {
  type: "system";
  subtype: "compact_boundary";
  compact_metadata: {
    trigger: "auto" | "manual";
    pre_tokens: number;
    post_tokens: number;
  };
}

export interface RetryEvent {
  type: "retry";
  attempt: number;
  maxRetries: number;
  delayMs: number;
  error: string;
}

export interface ResultEvent {
  type: "result";
  subtype:
    | "success"
    | "error_max_turns"
    | "error_max_tokens"
    | "error_max_budget_usd"
    | "error_during_execution";
  numTurns: number;
  totalUsage: Usage;
  totalCostUsd: number;
  durationMs: number;
  stopReason: StopReason;
  resultText: string;
}

export interface ToolProgressEvent {
  type: "tool_progress";
  toolName: string;
  toolUseId: string;
  content: string;
}

export type LoopEvent =
  | AssistantEvent
  | ToolResultEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolUseStartEvent
  | CompactEvent
  | RetryEvent
  | ResultEvent
  | ToolProgressEvent;
