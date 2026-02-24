/**
 * /model command — view or change the active model.
 *
 * Usage:
 *   /model           — Interactive model/provider picker
 *   /model <name>    — Switch to a named model (aliases supported)
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import {
  resolveModelAlias,
  AVAILABLE_MODELS,
  hasProviderApiKey,
  getProviderForModel,
} from "../core/models.js";
import { discoverModels, type DiscoveredModel } from "../core/model-discovery.js";
import { resetProvider } from "../core/providers/index.js";
import type { ListItem } from "../ui/components/list-selector.js";

/** Display name for provider keys. */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

export const modelCommand: SlashCommand = {
  name: "model",
  description: "View or change model (e.g., /model sonnet)",
  category: "model",
  aliases: ["m"],
  completions: ["opus", "sonnet", "haiku", "4o", "4o-mini", "4-turbo", "flash", "pro"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;

    if (!args && ctx.dispatch) {
      // Interactive model selector via ListSelector
      const items = await buildModelItems(ctx.model);

      return new Promise<boolean>((resolve) => {
        ctx.dispatch!({
          type: "LIST_SELECT_START",
          items,
          header: "Select a model",
          resolve: (selectedId) => {
            if (!selectedId) {
              output(chalk.dim("Model selection cancelled."));
              resolve(true);
              return;
            }

            const provider = getProviderForModel(selectedId);
            if (provider && !hasProviderApiKey(provider)) {
              output(chalk.yellow(`No API key set for ${PROVIDER_LABELS[provider] ?? provider}. Cannot switch.`));
              resolve(true);
              return;
            }

            // Switch provider if needed
            let providerChanged = false;
            if (provider) {
              const currentProvider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
              const normalizedCurrent = currentProvider === "openai-compat" || currentProvider === "openai_compat"
                ? "openai" : currentProvider === "google" ? "gemini" : currentProvider;

              if (normalizedCurrent !== provider) {
                process.env.LLM_PROVIDER = provider;
                resetProvider();
                providerChanged = true;
                output(chalk.dim(`Provider switched to ${PROVIDER_LABELS[provider] ?? provider}`));
              }
            }

            ctx.setModel(selectedId);
            output(chalk.dim(`Model changed to: ${selectedId}`));

            // Rebuild system prompt if provider changed (loads new context file)
            if (providerChanged && ctx.rebuildSystemPrompt) {
              ctx.rebuildSystemPrompt().then(() => {
                output(chalk.dim(`Context file updated for ${PROVIDER_LABELS[provider!] ?? provider}`));
              });
            }

            resolve(true);
          },
        });
      });
    }

    if (!args) {
      // Fallback: static text menu when no dispatch available
      const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
      const normalizedProvider = provider === "openai-compat" || provider === "openai_compat"
        ? "openai" : provider === "google" ? "gemini" : provider;
      const models = AVAILABLE_MODELS[normalizedProvider] ?? AVAILABLE_MODELS["anthropic"];

      output(chalk.bold("\n  Available Models"));
      output(chalk.dim("  " + "─".repeat(40)));
      for (const model of models) {
        const current = ctx.model === model.id ? chalk.green(" ●") : "  ";
        output(
          `${current} ${chalk.bold(model.alias.padEnd(10))} ${chalk.dim(model.description)}`
        );
        output(chalk.dim(`     ${model.id}`));
      }
      output();
      output(
        chalk.dim("  Usage: /model <name>  (e.g., /model opus)")
      );
      output(chalk.dim("  Or use a full model ID: /model claude-opus-4-20250514"));
      output();
      return true;
    }

    // Direct model switch with args
    const newModel = resolveModelAlias(args.trim());

    // Detect and handle provider switch
    const newProvider = getProviderForModel(newModel);
    let providerSwitched = false;
    if (newProvider) {
      const currentProv = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
      const normalizedCurrent = currentProv === "openai-compat" || currentProv === "openai_compat"
        ? "openai" : currentProv === "google" ? "gemini" : currentProv;

      if (normalizedCurrent !== newProvider) {
        if (!hasProviderApiKey(newProvider)) {
          output(chalk.yellow(`No API key set for ${PROVIDER_LABELS[newProvider] ?? newProvider}. Cannot switch.`));
          return true;
        }
        process.env.LLM_PROVIDER = newProvider;
        resetProvider();
        providerSwitched = true;
        output(chalk.dim(`Provider switched to ${PROVIDER_LABELS[newProvider] ?? newProvider}`));
      }
    }

    const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
    const normalizedProvider = provider === "openai-compat" || provider === "openai_compat"
      ? "openai" : provider === "google" ? "gemini" : provider;
    const models = AVAILABLE_MODELS[normalizedProvider] ?? AVAILABLE_MODELS["anthropic"];
    const isKnown = models.some((m) => m.id === newModel || m.alias === args.trim());

    ctx.setModel(newModel);

    if (isKnown) {
      output(chalk.dim(`Model changed to: ${newModel}`));
    } else {
      output(chalk.dim(`Model changed to: ${newModel}`));
      output(chalk.yellow("  Note: This model is not in the known models list. It may not be available."));
    }

    // Rebuild system prompt if provider changed (loads new context file)
    if (providerSwitched && ctx.rebuildSystemPrompt) {
      await ctx.rebuildSystemPrompt();
      output(chalk.dim(`Context file updated for ${PROVIDER_LABELS[newProvider!] ?? newProvider}`));
    }

    return true;
  },
};

// ── Helper: build list items from discovered models (with fallback) ──

function formatDescription(m: DiscoveredModel): string {
  const parts: string[] = [];
  if (m.pricing) {
    parts.push(`$${m.pricing.input}/$${m.pricing.output} per MTok`);
  }
  if (m.contextWindow) {
    const ctxK = m.contextWindow >= 1_000_000
      ? `${(m.contextWindow / 1_000_000).toFixed(1)}M`
      : `${Math.round(m.contextWindow / 1000)}K`;
    parts.push(`${ctxK} ctx`);
  }
  return parts.length > 0 ? parts.join(" · ") : m.displayName;
}

async function buildModelItems(currentModel: string): Promise<ListItem[]> {
  const discovered = await discoverModels();

  if (discovered.length > 0) {
    const items: ListItem[] = [];
    for (const m of discovered) {
      const hasKey = hasProviderApiKey(m.provider);
      const groupLabel = PROVIDER_LABELS[m.provider] ?? m.provider;
      const isCurrent = currentModel === m.id;
      const badge = isCurrent ? "current" : !hasKey ? "no API key" : undefined;

      items.push({
        id: m.id,
        label: m.displayName,
        description: formatDescription(m),
        group: groupLabel,
        badge,
        disabled: !hasKey,
      });
    }
    return items;
  }

  // Fallback to hardcoded AVAILABLE_MODELS
  const items: ListItem[] = [];
  for (const [provider, models] of Object.entries(AVAILABLE_MODELS)) {
    const hasKey = hasProviderApiKey(provider);
    const groupLabel = PROVIDER_LABELS[provider] ?? provider;

    for (const model of models) {
      const isCurrent = currentModel === model.id;
      const badge = isCurrent ? "current" : !hasKey ? "no API key" : undefined;

      items.push({
        id: model.id,
        label: model.alias,
        description: model.description,
        group: groupLabel,
        badge,
        disabled: !hasKey,
      });
    }
  }
  return items;
}
