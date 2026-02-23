/**
 * WebFetch tool — fetches content from a URL and optionally processes it.
 *
 * Fetches the URL, converts HTML to plain text, and returns the content.
 * Supports a prompt parameter for AI-assisted extraction (delegated to caller).
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

const inputSchema = z.object({
  url: z.string().describe("The URL to fetch content from"),
  prompt: z
    .string()
    .optional()
    .describe("What information to extract from the page"),
});

/** Strip HTML tags and decode basic entities. */
function htmlToText(html: string): string {
  return html
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Convert common block elements to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool: Tool = {
  name: "WebFetch",
  description:
    "Fetch content from a URL. Converts HTML to text. Use the prompt parameter to specify what information to extract.",
  inputSchema,
  maxResultSizeChars: 100000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);

    if (context.abortSignal?.aborted) {
      yield { type: "result", content: "Tool execution was aborted." };
      return;
    }

    try {
      // Validate URL
      let url: URL;
      try {
        url = new URL(input.url);
      } catch {
        yield { type: "result", content: `Error: Invalid URL "${input.url}"` };
        return;
      }

      // Only allow http/https
      if (!["http:", "https:"].includes(url.protocol)) {
        yield { type: "result", content: `Error: Only HTTP/HTTPS URLs are supported` };
        return;
      }

      yield { type: "progress", content: `Fetching ${url.hostname}...` };

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      // Chain abort signals
      if (context.abortSignal) {
        context.abortSignal.addEventListener(
          "abort",
          () => controller.abort(),
          { once: true }
        );
      }

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          "User-Agent": "Claude-Code-Core/1.0",
          Accept: "text/html,application/xhtml+xml,text/plain,application/json",
        },
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        yield {
          type: "result",
          content: `Error: HTTP ${response.status} ${response.statusText}`,
        };
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();

      let content: string;
      if (contentType.includes("text/html") || contentType.includes("xhtml")) {
        content = htmlToText(body);
      } else {
        content = body;
      }

      // Truncate if too long
      if (content.length > 80000) {
        content = content.slice(0, 80000) + "\n\n... (truncated)";
      }

      const parts: string[] = [`URL: ${url.toString()}`];
      if (input.prompt) {
        parts.push(`Extraction prompt: ${input.prompt}`);
      }
      parts.push(`\n--- Content ---\n${content}`);

      yield { type: "result", content: parts.join("\n") };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort")) {
        yield { type: "result", content: "Error: Request timed out or was aborted" };
        return;
      }
      yield { type: "result", content: `Error fetching URL: ${msg}` };
    }
  },
};
