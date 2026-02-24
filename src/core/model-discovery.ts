/**
 * Dynamic model discovery — fetches available models from provider APIs.
 *
 * Each provider's model listing endpoint is called once per session.
 * Results are merged with hardcoded pricing data and cached.
 */

import { getPricing } from "./cost.js";
import { hasProviderApiKey } from "./models.js";

// ── Types ────────────────────────────────────────────────────────────

export interface DiscoveredModel {
  id: string;
  displayName: string;
  provider: string; // "anthropic" | "openai" | "gemini"
  contextWindow?: number;
  maxOutput?: number;
  thinking?: boolean;
  pricing?: { input: number; output: number }; // $/MTok
}

// ── Session cache ────────────────────────────────────────────────────

let cached: DiscoveredModel[] | null = null;

/** Clear the session cache (useful for testing or forced refresh). */
export function clearModelCache(): void {
  cached = null;
}

// ── Known context windows (APIs don't always provide these) ──────────

const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-haiku-4": 200_000,
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4.1-nano": 1_047_576,
  "gpt-5": 1_047_576,
  "o1": 200_000,
  "o3": 200_000,
  "o3-mini": 200_000,
  "o4-mini": 200_000,
};

function lookupContextWindow(modelId: string): number | undefined {
  const lower = modelId.toLowerCase();
  for (const [prefix, ctx] of Object.entries(CONTEXT_WINDOWS)) {
    if (lower.startsWith(prefix)) return ctx;
  }
  return undefined;
}

// ── Anthropic fetcher ────────────────────────────────────────────────

async function fetchAnthropicModels(): Promise<DiscoveredModel[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];

    const body = (await res.json()) as {
      data: Array<{ id: string; display_name?: string }>;
    };

    return body.data.map((m) => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
      provider: "anthropic",
      contextWindow: lookupContextWindow(m.id),
    }));
  } catch {
    return [];
  }
}

// ── OpenAI fetcher ───────────────────────────────────────────────────

const OPENAI_INCLUDE = /^(gpt-4|gpt-5|o1|o3|o4)/i;
const OPENAI_EXCLUDE =
  /instruct|realtime|audio|transcribe|search|codex|dall|tts|whisper|embed/i;

async function fetchOpenAIModels(): Promise<DiscoveredModel[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const baseUrl =
    process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    "https://api.openai.com/v1";

  // Skip discovery for local servers
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl)) return [];

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];

    const body = (await res.json()) as {
      data: Array<{ id: string; owned_by?: string }>;
    };

    return body.data
      .filter((m) => OPENAI_INCLUDE.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
      .map((m) => ({
        id: m.id,
        displayName: m.id,
        provider: "openai",
        contextWindow: lookupContextWindow(m.id),
      }));
  } catch {
    return [];
  }
}

// ── Gemini fetcher ───────────────────────────────────────────────────

async function fetchGeminiModels(): Promise<DiscoveredModel[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];

    const body = (await res.json()) as {
      models: Array<{
        name: string;
        displayName?: string;
        description?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
      }>;
    };

    return body.models
      .filter(
        (m) =>
          m.name.includes("gemini") &&
          m.supportedGenerationMethods?.includes("generateContent") &&
          !/tts|image|robotics/i.test(m.name),
      )
      .map((m) => {
        const id = m.name.replace(/^models\//, "");
        return {
          id,
          displayName: m.displayName ?? id,
          provider: "gemini",
          contextWindow: m.inputTokenLimit,
          maxOutput: m.outputTokenLimit,
        };
      });
  } catch {
    return [];
  }
}

// ── Merge pricing ────────────────────────────────────────────────────

function mergePricing(models: DiscoveredModel[]): void {
  for (const m of models) {
    const p = getPricing(m.id);
    // getPricing returns default (sonnet) pricing for unknown models.
    // Only attach pricing if it's a specific match (not the fallback).
    // We detect fallback by checking if the model contains a known keyword.
    if (hasPricingMatch(m.id)) {
      m.pricing = { input: p.inputTokens, output: p.outputTokens };
    }
  }
}

/** Check if a model ID has a specific (non-default) pricing match. */
function hasPricingMatch(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return (
    lower.includes("opus") ||
    lower.includes("sonnet") ||
    lower.includes("haiku") ||
    lower.includes("gpt-4o") ||
    lower.includes("gpt-4-turbo") ||
    lower.includes("gpt-4.1") ||
    lower.includes("gpt-5") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("o4") ||
    lower.includes("gemini")
  );
}

// ── Sort helpers ─────────────────────────────────────────────────────

/** Sort models within a provider: pricier (more capable) first. */
function sortModels(models: DiscoveredModel[]): DiscoveredModel[] {
  return models.sort((a, b) => {
    const priceA = a.pricing ? a.pricing.input + a.pricing.output : 0;
    const priceB = b.pricing ? b.pricing.input + b.pricing.output : 0;
    if (priceB !== priceA) return priceB - priceA; // expensive first
    return a.id.localeCompare(b.id);
  });
}

// ── Main export ──────────────────────────────────────────────────────

/**
 * Discover models from all configured providers.
 * Results are session-cached — subsequent calls return instantly.
 */
export async function discoverModels(): Promise<DiscoveredModel[]> {
  if (cached) return cached;

  const [anthropic, openai, gemini] = await Promise.all([
    hasProviderApiKey("anthropic") ? fetchAnthropicModels() : Promise.resolve([]),
    hasProviderApiKey("openai") ? fetchOpenAIModels() : Promise.resolve([]),
    hasProviderApiKey("gemini") ? fetchGeminiModels() : Promise.resolve([]),
  ]);

  const all = [...anthropic, ...openai, ...gemini];
  mergePricing(all);

  // Sort each provider group
  const byProvider = new Map<string, DiscoveredModel[]>();
  for (const m of all) {
    const arr = byProvider.get(m.provider) ?? [];
    arr.push(m);
    byProvider.set(m.provider, arr);
  }

  cached = [];
  for (const [, models] of byProvider) {
    cached.push(...sortModels(models));
  }

  return cached;
}
