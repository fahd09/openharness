/**
 * Model parameter capabilities.
 *
 * Different model generations within the same provider require different
 * parameter names (e.g. `max_tokens` vs `max_completion_tokens`). This
 * module provides a lookup table and helpers so the provider can construct
 * the correct request body for any model.
 */

// ── Types ────────────────────────────────────────────────────────

export interface ModelParamCaps {
  /** Which field name to use for the token budget. */
  tokenParam: "max_tokens" | "max_completion_tokens";
  /** Whether the model accepts temperature / top_p / penalties. */
  supportsTemperature: boolean;
  /** Whether the model supports the reasoning_effort field. */
  supportsReasoningEffort: boolean;
}

// ── OpenAI prefix-match rules (evaluated top-to-bottom) ──────────

interface PrefixRule {
  prefix: string;
  caps: ModelParamCaps;
}

const OPENAI_RULES: PrefixRule[] = [
  // Reasoning models — no temperature, use max_completion_tokens
  { prefix: "o1", caps: { tokenParam: "max_completion_tokens", supportsTemperature: false, supportsReasoningEffort: true } },
  { prefix: "o3", caps: { tokenParam: "max_completion_tokens", supportsTemperature: false, supportsReasoningEffort: true } },
  { prefix: "o4", caps: { tokenParam: "max_completion_tokens", supportsTemperature: false, supportsReasoningEffort: true } },

  // GPT-4.1+ and GPT-5+ — new token param, but supports temperature
  { prefix: "gpt-4.1", caps: { tokenParam: "max_completion_tokens", supportsTemperature: true, supportsReasoningEffort: false } },
  { prefix: "gpt-4.5", caps: { tokenParam: "max_completion_tokens", supportsTemperature: true, supportsReasoningEffort: false } },
  { prefix: "gpt-5",   caps: { tokenParam: "max_completion_tokens", supportsTemperature: true, supportsReasoningEffort: false } },

  // Legacy GPT-4 family — old token param
  { prefix: "gpt-4o",     caps: { tokenParam: "max_tokens", supportsTemperature: true, supportsReasoningEffort: false } },
  { prefix: "gpt-4-turbo", caps: { tokenParam: "max_tokens", supportsTemperature: true, supportsReasoningEffort: false } },
  { prefix: "gpt-4",      caps: { tokenParam: "max_tokens", supportsTemperature: true, supportsReasoningEffort: false } },

  // GPT-3.5
  { prefix: "gpt-3.5", caps: { tokenParam: "max_tokens", supportsTemperature: true, supportsReasoningEffort: false } },
];

// ── Defaults for unknown models ──────────────────────────────────

const OFFICIAL_DEFAULT: ModelParamCaps = {
  tokenParam: "max_completion_tokens",
  supportsTemperature: true,
  supportsReasoningEffort: false,
};

const COMPAT_DEFAULT: ModelParamCaps = {
  tokenParam: "max_tokens",
  supportsTemperature: true,
  supportsReasoningEffort: false,
};

// ── Lookup ───────────────────────────────────────────────────────

/**
 * Get the parameter capabilities for a given OpenAI model.
 *
 * @param modelId - Model identifier (e.g. "gpt-5.2-2025-12-11", "o3-mini")
 * @param isOfficialEndpoint - true for api.openai.com / Azure, false for compat endpoints
 */
export function getOpenAIModelCaps(
  modelId: string,
  isOfficialEndpoint: boolean
): ModelParamCaps {
  const lower = modelId.toLowerCase();
  for (const rule of OPENAI_RULES) {
    if (lower.startsWith(rule.prefix)) {
      return rule.caps;
    }
  }
  // Unknown model — forward-looking default for official, backward-compat for others
  return isOfficialEndpoint ? OFFICIAL_DEFAULT : COMPAT_DEFAULT;
}

/**
 * Given a rejected token param name, return the alternative.
 * Used for error-based fallback: if the API rejects one param, try the other.
 */
export function getAlternateTokenParam(
  rejected: "max_tokens" | "max_completion_tokens"
): "max_tokens" | "max_completion_tokens" {
  return rejected === "max_tokens" ? "max_completion_tokens" : "max_tokens";
}
