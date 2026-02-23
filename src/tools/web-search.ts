/**
 * WebSearch tool — real web search via Brave Search API (primary)
 * with Serper.dev as fallback.
 *
 * Configuration (via .env or environment variables):
 *   BRAVE_SEARCH_API_KEY  — Brave Search API key (free: 2000 queries/month)
 *   SERPER_API_KEY         — Serper.dev API key (free: 2500 queries)
 *
 * At least one key must be set for search to work.
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({
  query: z.string().describe("The search query"),
  allowed_domains: z
    .array(z.string())
    .optional()
    .describe("Only include results from these domains"),
  blocked_domains: z
    .array(z.string())
    .optional()
    .describe("Exclude results from these domains"),
});

// ── Result types ────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No results found for: "${query}"`;
  }

  const lines: string[] = [`Search results for: "${query}"\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    lines.push(`   ${r.snippet}`);
    lines.push("");
  }
  return lines.join("\n");
}

function applyDomainFilters(
  results: SearchResult[],
  allowedDomains?: string[],
  blockedDomains?: string[]
): SearchResult[] {
  let filtered = results;

  if (allowedDomains && allowedDomains.length > 0) {
    filtered = filtered.filter((r) => {
      try {
        const host = new URL(r.url).hostname;
        return allowedDomains.some(
          (d) => host === d || host.endsWith(`.${d}`)
        );
      } catch {
        return false;
      }
    });
  }

  if (blockedDomains && blockedDomains.length > 0) {
    filtered = filtered.filter((r) => {
      try {
        const host = new URL(r.url).hostname;
        return !blockedDomains.some(
          (d) => host === d || host.endsWith(`.${d}`)
        );
      } catch {
        return true;
      }
    });
  }

  return filtered;
}

// ── Brave Search API ────────────────────────────────────────────────
// Docs: https://brave.com/search/api/
// Free tier: 2,000 queries/month

async function searchBrave(
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not set");

  const params = new URLSearchParams({
    q: query,
    count: "10",
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    }
  );

  clearTimeout(timeoutId);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Brave API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

// ── Serper.dev API ──────────────────────────────────────────────────
// Docs: https://serper.dev/
// Free tier: 2,500 queries

async function searchSerper(
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("SERPER_API_KEY not set");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Serper API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    organic?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
    }>;
  };

  return (data.organic ?? []).map((r) => ({
    title: r.title ?? "(untitled)",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }));
}

// ── Search with fallback ────────────────────────────────────────────

async function search(
  query: string,
  signal?: AbortSignal
): Promise<{ results: SearchResult[]; provider: string }> {
  // Try Brave first
  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const results = await searchBrave(query, signal);
      return { results, provider: "brave" };
    } catch (err) {
      // Fall through to Serper
      const msg = err instanceof Error ? err.message : String(err);
      if (!process.env.SERPER_API_KEY) {
        throw new Error(`Brave Search failed: ${msg}`);
      }
    }
  }

  // Try Serper as fallback
  if (process.env.SERPER_API_KEY) {
    const results = await searchSerper(query, signal);
    return { results, provider: "serper" };
  }

  throw new Error(
    "No search API configured. Set BRAVE_SEARCH_API_KEY or SERPER_API_KEY in your .env file."
  );
}

// ── Tool ────────────────────────────────────────────────────────────

export const webSearchTool: Tool = {
  name: "WebSearch",
  description:
    "Search the web for information. Returns search results with titles, URLs, and snippets.",
  inputSchema,
  maxResultSizeChars: 50000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);

    if (context.abortSignal?.aborted) {
      yield { type: "result", content: "Tool execution was aborted." };
      return;
    }

    yield { type: "progress", content: `Searching for "${input.query}"...` };

    try {
      const { results, provider } = await search(
        input.query,
        context.abortSignal
      );

      const filtered = applyDomainFilters(
        results,
        input.allowed_domains,
        input.blocked_domains
      );

      yield {
        type: "result",
        content: formatResults(filtered, input.query) +
          `\n(via ${provider})`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort")) {
        yield { type: "result", content: "Error: Search request timed out or was aborted" };
        return;
      }
      yield { type: "result", content: `Error: ${msg}` };
    }
  },
};
