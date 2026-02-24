/**
 * Cost tracking module.
 *
 * Mirrors the original's r1 global tracker, sc3 cost calculation,
 * and tc3 dynamic pricing selection.
 *
 * Pricing is per million tokens (MTok).
 */

import type { Usage } from "./types.js";

// ── Pricing tables ──────────────────────────────────────────────────

interface ModelPricing {
  inputTokens: number; // $ per MTok
  outputTokens: number; // $ per MTok
  cacheWriteTokens: number; // $ per MTok (cache_creation)
  cacheReadTokens: number; // $ per MTok (cache_read)
}

/**
 * Standard pricing per model family.
 * Source: Claude API pricing page, OpenAI pricing page (as of 2025).
 */
const PRICING: Record<string, ModelPricing> = {
  // ── Anthropic Claude ─────────────────────────────────────────
  opus: {
    inputTokens: 15,
    outputTokens: 75,
    cacheWriteTokens: 18.75,
    cacheReadTokens: 1.5,
  },
  sonnet: {
    inputTokens: 3,
    outputTokens: 15,
    cacheWriteTokens: 3.75,
    cacheReadTokens: 0.3,
  },
  haiku: {
    inputTokens: 0.8,
    outputTokens: 4,
    cacheWriteTokens: 1.0,
    cacheReadTokens: 0.08,
  },
  // ── OpenAI ───────────────────────────────────────────────────
  "gpt-4o": {
    inputTokens: 2.5,
    outputTokens: 10,
    cacheWriteTokens: 2.5,
    cacheReadTokens: 1.25,
  },
  "gpt-4o-mini": {
    inputTokens: 0.15,
    outputTokens: 0.6,
    cacheWriteTokens: 0.15,
    cacheReadTokens: 0.075,
  },
  "gpt-4-turbo": {
    inputTokens: 10,
    outputTokens: 30,
    cacheWriteTokens: 10,
    cacheReadTokens: 10,
  },
  "o1": {
    inputTokens: 15,
    outputTokens: 60,
    cacheWriteTokens: 15,
    cacheReadTokens: 7.5,
  },
  "o3-mini": {
    inputTokens: 1.1,
    outputTokens: 4.4,
    cacheWriteTokens: 1.1,
    cacheReadTokens: 0.55,
  },
  "o3": {
    inputTokens: 2,
    outputTokens: 8,
    cacheWriteTokens: 2,
    cacheReadTokens: 1,
  },
  "o3-pro": {
    inputTokens: 20,
    outputTokens: 80,
    cacheWriteTokens: 20,
    cacheReadTokens: 10,
  },
  "o4-mini": {
    inputTokens: 1.1,
    outputTokens: 4.4,
    cacheWriteTokens: 1.1,
    cacheReadTokens: 0.55,
  },
  "o1-pro": {
    inputTokens: 150,
    outputTokens: 600,
    cacheWriteTokens: 150,
    cacheReadTokens: 75,
  },
  "gpt-4.1": {
    inputTokens: 2,
    outputTokens: 8,
    cacheWriteTokens: 2,
    cacheReadTokens: 1,
  },
  "gpt-4.1-mini": {
    inputTokens: 0.4,
    outputTokens: 1.6,
    cacheWriteTokens: 0.4,
    cacheReadTokens: 0.2,
  },
  "gpt-4.1-nano": {
    inputTokens: 0.1,
    outputTokens: 0.4,
    cacheWriteTokens: 0.1,
    cacheReadTokens: 0.05,
  },
  "gpt-5": {
    inputTokens: 2,
    outputTokens: 8,
    cacheWriteTokens: 2,
    cacheReadTokens: 1,
  },
  "gpt-5-mini": {
    inputTokens: 0.4,
    outputTokens: 1.6,
    cacheWriteTokens: 0.4,
    cacheReadTokens: 0.2,
  },
  // ── Google Gemini ───────────────────────────────────────────
  "gemini-2.5-flash": {
    inputTokens: 0.30,
    outputTokens: 2.50,
    cacheWriteTokens: 0.30,
    cacheReadTokens: 0.15,
  },
  "gemini-2.5-flash-lite": {
    inputTokens: 0.10,
    outputTokens: 0.40,
    cacheWriteTokens: 0.10,
    cacheReadTokens: 0.05,
  },
  "gemini-2.5-pro": {
    inputTokens: 1.25,
    outputTokens: 10.0,
    cacheWriteTokens: 1.25,
    cacheReadTokens: 0.625,
  },
  "gemini-3-flash": {
    inputTokens: 0.50,
    outputTokens: 3.0,
    cacheWriteTokens: 0.50,
    cacheReadTokens: 0.25,
  },
  "gemini-3-pro": {
    inputTokens: 2.0,
    outputTokens: 12.0,
    cacheWriteTokens: 2.0,
    cacheReadTokens: 1.0,
  },
  "gemini-3.1-pro": {
    inputTokens: 2.0,
    outputTokens: 12.0,
    cacheWriteTokens: 2.0,
    cacheReadTokens: 1.0,
  },
  // ── Generic cheap (for local models, unknown providers) ──────
  "local": {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  },
};

// Default to Sonnet pricing for unknown models
const DEFAULT_PRICING = PRICING.sonnet;

/**
 * Resolve pricing for a model string.
 * Matches model ID substrings to pricing tiers.
 */
export function getPricing(model: string): ModelPricing {
  const lower = model.toLowerCase();

  // Anthropic models
  if (lower.includes("opus")) return PRICING.opus;
  if (lower.includes("haiku")) return PRICING.haiku;
  if (lower.includes("sonnet")) return PRICING.sonnet;

  // Gemini models (order matters — check more specific first)
  if (lower.includes("gemini-3.1-pro")) return PRICING["gemini-3.1-pro"];
  if (lower.includes("gemini-3-flash")) return PRICING["gemini-3-flash"];
  if (lower.includes("gemini-3-pro")) return PRICING["gemini-3-pro"];
  if (lower.includes("gemini-2.5-flash-lite")) return PRICING["gemini-2.5-flash-lite"];
  if (lower.includes("gemini-2.5-flash")) return PRICING["gemini-2.5-flash"];
  if (lower.includes("gemini-2.5-pro")) return PRICING["gemini-2.5-pro"];

  // OpenAI models (order matters — check more specific first)
  if (lower.includes("gpt-4o-mini")) return PRICING["gpt-4o-mini"];
  if (lower.includes("gpt-4o")) return PRICING["gpt-4o"];
  if (lower.includes("gpt-4-turbo")) return PRICING["gpt-4-turbo"];
  if (lower.includes("gpt-4.1-nano")) return PRICING["gpt-4.1-nano"];
  if (lower.includes("gpt-4.1-mini")) return PRICING["gpt-4.1-mini"];
  if (lower.includes("gpt-4.1")) return PRICING["gpt-4.1"];
  if (lower.includes("gpt-5-mini")) return PRICING["gpt-5-mini"];
  if (lower.includes("gpt-5")) return PRICING["gpt-5"];
  if (lower.includes("o1-pro")) return PRICING["o1-pro"];
  if (lower.includes("o1")) return PRICING["o1"];
  if (lower.includes("o3-pro")) return PRICING["o3-pro"];
  if (lower.includes("o3-mini")) return PRICING["o3-mini"];
  if (lower.includes("o3")) return PRICING["o3"];
  if (lower.includes("o4-mini")) return PRICING["o4-mini"];

  // Local models (Ollama, LM Studio, etc.)
  const baseUrl = process.env.OPENAI_BASE_URL ?? "";
  if (
    baseUrl.includes("localhost") ||
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("0.0.0.0")
  ) {
    return PRICING["local"];
  }

  return DEFAULT_PRICING;
}

// ── Cost calculation ────────────────────────────────────────────────

/**
 * Calculate USD cost for a single API response.
 * Matches original's sc3 function.
 */
export function calculateCost(usage: Usage, model: string): number {
  const pricing = getPricing(model);

  return (
    (usage.input_tokens / 1_000_000) * pricing.inputTokens +
    (usage.output_tokens / 1_000_000) * pricing.outputTokens +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      pricing.cacheWriteTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      pricing.cacheReadTokens
  );
}

// ── Per-model usage breakdown ───────────────────────────────────────

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

// ── Cost tracker ────────────────────────────────────────────────────

/**
 * Tracks cumulative cost across the session.
 * Mirrors original's r1 global state.
 */
export class CostTracker {
  private totalCostUsd = 0;
  private modelUsage = new Map<string, ModelUsage>();
  private _hasUnknownModelCost = false;

  /**
   * Record usage from an API response.
   */
  addUsage(usage: Usage, model: string): number {
    const cost = calculateCost(usage, model);
    this.totalCostUsd += cost;

    // Track if we're using unknown model pricing
    const lower = model.toLowerCase();
    if (
      !lower.includes("opus") &&
      !lower.includes("sonnet") &&
      !lower.includes("haiku")
    ) {
      this._hasUnknownModelCost = true;
    }

    // Accumulate per-model breakdown
    const existing = this.modelUsage.get(model) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
    };

    existing.inputTokens += usage.input_tokens;
    existing.outputTokens += usage.output_tokens;
    existing.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
    existing.cacheCreationInputTokens +=
      usage.cache_creation_input_tokens ?? 0;
    existing.costUsd += cost;

    this.modelUsage.set(model, existing);

    return cost;
  }

  /** Get total cost across all models. */
  getTotalCost(): number {
    return this.totalCostUsd;
  }

  /** Whether any usage was from an unknown model (costs may be inaccurate). */
  hasUnknownModelCost(): boolean {
    return this._hasUnknownModelCost;
  }

  /** Get per-model usage breakdown. */
  getModelBreakdown(): Map<string, ModelUsage> {
    return new Map(this.modelUsage);
  }
}

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format a USD cost for display.
 * Matches original's Ny6 function:
 * - > $0.50: show 2 decimal places ($1.23)
 * - <= $0.50: show 4 decimal places ($0.0042)
 */
export function formatCost(usd: number): string {
  if (usd > 0.5) {
    return `$${usd.toFixed(2)}`;
  }
  return `$${usd.toFixed(4)}`;
}
