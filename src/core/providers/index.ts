/**
 * Provider factory.
 *
 * Selects the active LLM provider based on the LLM_PROVIDER env var.
 * Default: "anthropic".
 *
 * Supported providers:
 *   - "anthropic" / "claude" — Anthropic Claude API (default)
 *   - "openai"               — OpenAI API (GPT-4o, o1, o3, etc.)
 *   - "openai-compat"        — Any OpenAI-compatible API (set OPENAI_BASE_URL)
 *   - "gemini" / "google"    — Google Gemini API (2.5 Flash/Pro, 3 Flash/Pro, etc.)
 */

export type { LLMProvider, ProviderStreamYield, ProviderStreamParams, ProviderCompleteParams, ProviderCompleteResult, ToolSchema } from "./base.js";

import type { LLMProvider } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";
import { GeminiProvider } from "./gemini.js";

let activeProvider: LLMProvider | null = null;

/**
 * Get the active LLM provider.
 * Selected via LLM_PROVIDER env var (default: "anthropic").
 */
export function getProvider(): LLMProvider {
  if (!activeProvider) {
    const providerName = (
      process.env.LLM_PROVIDER || "anthropic"
    ).toLowerCase();

    switch (providerName) {
      case "anthropic":
      case "claude":
        activeProvider = new AnthropicProvider();
        break;
      case "openai":
      case "openai-compat":
      case "openai_compat":
        activeProvider = new OpenAICompatProvider();
        break;
      case "gemini":
      case "google":
        activeProvider = new GeminiProvider();
        break;
      default:
        throw new Error(
          `Unknown LLM provider: "${providerName}". Supported: anthropic, openai, openai-compat, gemini`
        );
    }
  }
  return activeProvider;
}

/**
 * Reset the active provider (for testing or dynamic switching).
 */
export function resetProvider(): void {
  activeProvider = null;
}

/**
 * Get the name of the active provider.
 */
export function getProviderName(): string {
  return getProvider().name;
}

/**
 * List available provider names.
 */
export function listProviders(): string[] {
  return ["anthropic", "openai", "openai-compat", "gemini"];
}
