/**
 * Model Aliases & Resolution — single source of truth for model names.
 */

export const ANTHROPIC_ALIASES: Record<string, string> = {
  opus: "claude-opus-4-20250514",
  sonnet: "claude-sonnet-4-20250514",
  haiku: "claude-haiku-4-5-20251001",
};

export const OPENAI_ALIASES: Record<string, string> = {
  "4o": "gpt-4o",
  "4o-mini": "gpt-4o-mini",
  "4-turbo": "gpt-4-turbo",
};

export const GEMINI_ALIASES: Record<string, string> = {
  "flash": "gemini-2.5-flash",
  "pro": "gemini-2.5-pro",
};

export const FAST_MODELS: Record<string, string> = {
  // Anthropic: any non-haiku model → haiku
  "claude-opus-4-20250514": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-20250514": "claude-haiku-4-5-20251001",
  // OpenAI: full model → mini
  "gpt-4o": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4o-mini",
  // Gemini: pro → flash
  "gemini-2.5-pro": "gemini-2.5-flash",
};

export const AVAILABLE_MODELS: Record<string, Array<{ alias: string; id: string; description: string }>> = {
  anthropic: [
    { alias: "opus", id: "claude-opus-4-20250514", description: "Most capable, complex tasks" },
    { alias: "sonnet", id: "claude-sonnet-4-20250514", description: "Balanced speed and capability" },
    { alias: "haiku", id: "claude-haiku-4-5-20251001", description: "Fastest, lightweight tasks" },
  ],
  openai: [
    { alias: "4o", id: "gpt-4o", description: "Most capable GPT model" },
    { alias: "4o-mini", id: "gpt-4o-mini", description: "Fast and affordable" },
    { alias: "4-turbo", id: "gpt-4-turbo", description: "GPT-4 Turbo" },
  ],
  gemini: [
    { alias: "flash", id: "gemini-2.5-flash", description: "Fast and efficient" },
    { alias: "pro", id: "gemini-2.5-pro", description: "Most capable Gemini model" },
  ],
};

/**
 * Map of provider names to their required API key env var(s).
 */
export const PROVIDER_API_KEYS: Record<string, string | string[]> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

/**
 * Check if the relevant API key env var is set for a provider.
 */
export function hasProviderApiKey(provider: string): boolean {
  const keys = PROVIDER_API_KEYS[provider];
  if (!keys) return false;
  if (Array.isArray(keys)) {
    return keys.some((k) => !!process.env[k]);
  }
  return !!process.env[keys];
}

/**
 * Reverse lookup: given a model ID, find which provider it belongs to.
 * First checks hardcoded AVAILABLE_MODELS, then falls back to prefix patterns.
 */
export function getProviderForModel(modelId: string): string | undefined {
  // Check hardcoded list first
  for (const [provider, models] of Object.entries(AVAILABLE_MODELS)) {
    if (models.some((m) => m.id === modelId)) {
      return provider;
    }
  }

  // Prefix-based detection for dynamically discovered models
  const lower = modelId.toLowerCase();
  if (lower.startsWith("claude-")) return "anthropic";
  if (lower.startsWith("gpt-") || /^o[134]-/.test(lower) || /^o[134]$/.test(lower)) return "openai";
  if (lower.startsWith("gemini-")) return "gemini";

  return undefined;
}

/**
 * Resolve a model alias to full model ID based on current provider.
 */
export function resolveModelAlias(input: string): string {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

  if (provider === "openai" || provider === "openai-compat" || provider === "openai_compat") {
    return OPENAI_ALIASES[input] ?? input;
  }

  if (provider === "gemini" || provider === "google") {
    return GEMINI_ALIASES[input] ?? input;
  }

  return ANTHROPIC_ALIASES[input] ?? input;
}
