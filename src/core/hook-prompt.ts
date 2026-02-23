/**
 * Prompt-based Hook Evaluation.
 *
 * Evaluates a hook by sending context to a fast LLM model and parsing
 * the structured JSON response. Used for LLM-powered quality gates
 * (e.g., "are all tasks complete before stopping?").
 */

import { getProvider } from "./providers/index.js";
import { loadPrompt } from "./prompt-loader.js";

export interface PromptHookConfig {
  prompt: string;
  model?: string;
  timeout?: number;
}

export interface PromptHookResult {
  ok: boolean;
  reason?: string;
  additionalContext?: string[];
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT = 10000;

/**
 * Evaluate a prompt-based hook by sending the hook context to an LLM.
 *
 * The prompt can contain `$ARGUMENTS` which is replaced with the JSON
 * context string. The model must respond with `{"ok": true/false, "reason": "..."}`.
 *
 * Returns `{ok: true}` on any failure (parse error, timeout) — fail-open.
 */
export async function evaluatePromptHook(
  config: PromptHookConfig,
  contextJson: string
): Promise<PromptHookResult> {
  const provider = getProvider();
  const model = config.model ?? DEFAULT_MODEL;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  // Substitute $ARGUMENTS in the prompt
  const prompt = config.prompt.replace(/\$ARGUMENTS/g, contextJson);

  const systemMessage = loadPrompt("hook-evaluator");

  try {
    const result = await Promise.race([
      provider.complete({
        model,
        maxTokens: 512,
        messages: [
          { role: "user", content: `${systemMessage}\n\n${prompt}` },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Prompt hook timed out")), timeout)
      ),
    ]);

    // Parse the JSON response
    const text = result.text.trim();
    // Extract JSON from potential markdown code blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: true };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      ok: Boolean(parsed.ok),
      reason: parsed.reason,
      additionalContext: Array.isArray(parsed.additionalContext) ? parsed.additionalContext : undefined,
    };
  } catch {
    // Fail-open: any error means continue
    return { ok: true };
  }
}
