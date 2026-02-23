import type Anthropic from "@anthropic-ai/sdk";
import { getProvider } from "./providers/index.js";
import { estimateTokens } from "../utils.js";
import type { ConversationMessage, SystemPrompt } from "./types.js";
import { loadPrompt } from "./prompt-loader.js";

// Context window sizes by model
const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  "claude-opus-4-20250514": 200000,
  "claude-sonnet-4-20250514": 200000,
  "claude-haiku-4-5-20251001": 200000,
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "o1": 200000,
  "o3-mini": 200000,
  default: 128000,
};

const COMPACT_THRESHOLD = 0.8; // Compact at 80% of context window
const COMPACT_BUFFER = 500; // Token buffer to avoid thrashing (matches original yZ1)

/**
 * Estimate tokens for a single content block (string or structured).
 */
function estimateContentTokens(
  content: string | Anthropic.ContentBlockParam[] | Anthropic.ToolResultBlockParam[]
): number {
  if (typeof content === "string") {
    return estimateTokens(content);
  }
  let total = 0;
  for (const block of content) {
    if ("text" in block && typeof block.text === "string") {
      total += estimateTokens(block.text);
    } else if ("content" in block && typeof block.content === "string") {
      total += estimateTokens(block.content);
    } else if ("input" in block) {
      total += estimateTokens(JSON.stringify(block.input));
    } else {
      // Fallback: serialize the block
      total += estimateTokens(JSON.stringify(block));
    }
  }
  return total;
}

/**
 * Estimate tokens for a system prompt (string or segments).
 */
function estimateSystemTokens(prompt: string | SystemPrompt): number {
  if (typeof prompt === "string") return estimateTokens(prompt);
  let total = 0;
  for (const segment of prompt) {
    total += estimateTokens(segment.text);
  }
  return total;
}

/**
 * Estimate total tokens for API-format messages + system prompt.
 */
export function estimateApiTokens(
  messages: Anthropic.MessageParam[],
  systemPrompt: string | SystemPrompt
): number {
  let total = estimateSystemTokens(systemPrompt);
  for (const msg of messages) {
    total += estimateContentTokens(
      msg.content as string | Anthropic.ContentBlockParam[]
    );
  }
  return total;
}

/**
 * Estimate total tokens for internal conversation messages.
 */
export function estimateConversationTokens(
  messages: ConversationMessage[],
  systemPrompt: string
): number {
  let total = estimateTokens(systemPrompt);
  for (const msg of messages) {
    if (msg.type === "user") {
      if (typeof msg.content === "string") {
        total += estimateTokens(msg.content);
      } else {
        for (const block of msg.content) {
          if (typeof block.content === "string") {
            total += estimateTokens(block.content);
          }
        }
      }
    } else {
      for (const block of msg.content) {
        if (block.type === "text") {
          total += estimateTokens(block.text);
        } else if (block.type === "tool_use") {
          total += estimateTokens(JSON.stringify(block.input));
        }
      }
    }
  }
  return total;
}

/**
 * Check if API messages need compaction.
 */
export function needsCompaction(
  messages: Anthropic.MessageParam[],
  systemPrompt: string | SystemPrompt,
  model: string
): boolean {
  const contextWindow =
    CONTEXT_WINDOWS[model] ?? CONTEXT_WINDOWS["default"];
  const used = estimateApiTokens(messages, systemPrompt);
  return used > contextWindow * COMPACT_THRESHOLD - COMPACT_BUFFER;
}

/**
 * Get the context window size for a model.
 */
export function getContextWindow(model: string): number {
  return CONTEXT_WINDOWS[model] ?? CONTEXT_WINDOWS["default"];
}

/**
 * Compact the conversation by summarizing older messages.
 * Mirrors the original's approach: summarize older messages, keep recent ones.
 *
 * Returns the compacted messages and pre/post token counts for telemetry.
 */
export async function compactConversation(
  messages: Anthropic.MessageParam[],
  systemPrompt: string | SystemPrompt,
  model: string,
  customPreservation?: string
): Promise<{
  messages: Anthropic.MessageParam[];
  preTokens: number;
  postTokens: number;
}> {
  const preTokens = estimateApiTokens(messages, systemPrompt);

  if (messages.length <= 2) {
    return { messages, preTokens, postTokens: preTokens };
  }

  const provider = getProvider();

  // Keep the last 4 messages (2 exchanges) to preserve recent context
  const keepCount = Math.min(4, messages.length);
  const toSummarize = messages.slice(0, messages.length - keepCount);
  const toKeep = messages.slice(messages.length - keepCount);

  // Strip tool_use, thinking, and redacted_thinking blocks from messages
  // being summarized. Tool calls are incomplete without results, and thinking
  // blocks are large internal reasoning that's not useful for summaries.
  const cleanedForSummary = toSummarize.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const filtered = (msg.content as Anthropic.ContentBlockParam[]).filter(
        (b) =>
          b.type !== "tool_use" &&
          b.type !== "thinking" &&
          b.type !== "redacted_thinking"
      );
      return filtered.length > 0
        ? { ...msg, content: filtered }
        : { ...msg, content: [{ type: "text" as const, text: "(tool calls removed)" }] };
    }
    return msg;
  });

  const customInstructions = customPreservation
    ? `\n\nAdditional preservation instructions: ${customPreservation}`
    : "";

  const compactionPrompt = loadPrompt("compaction");

  const summaryPrompt = `${compactionPrompt}${customInstructions}

Summarize the following conversation:

<conversation>
${JSON.stringify(cleanedForSummary)}
</conversation>`;

  try {
    const response = await provider.complete({
      model,
      maxTokens: 2048,
      messages: [{ role: "user", content: summaryPrompt }],
    });

    const summaryText =
      response.text || "Previous conversation context was compacted.";

    const compacted: Anthropic.MessageParam[] = [
      {
        role: "user" as const,
        content: `[Auto-compacted conversation summary]\n\n${summaryText}`,
      },
      {
        role: "assistant" as const,
        content:
          "I understand the context from the compacted summary. Let me continue helping you.",
      },
      ...toKeep,
    ];

    const postTokens = estimateApiTokens(compacted, systemPrompt);
    return { messages: compacted, preTokens, postTokens };
  } catch {
    // If summarization fails, just keep recent messages
    const fallback: Anthropic.MessageParam[] = [
      {
        role: "user" as const,
        content:
          "[Earlier conversation was compacted due to context limits]",
      },
      {
        role: "assistant" as const,
        content: "Understood. Let me continue.",
      },
      ...toKeep,
    ];

    const postTokens = estimateApiTokens(fallback, systemPrompt);
    return { messages: fallback, preTokens, postTokens };
  }
}
