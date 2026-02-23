/**
 * Output Style Modes — controls response formatting style.
 */

export type OutputStyleName = "concise" | "detailed" | "markdown" | "plain";

export const OUTPUT_STYLES: Record<OutputStyleName, string> = {
  concise: "Brief responses, minimal explanation",
  detailed: "Thorough explanations with examples",
  markdown: "Rich markdown formatting with headers and lists",
  plain: "Plain text, no special formatting",
};

const STYLE_PROMPTS: Record<OutputStyleName, string> = {
  concise:
    "Be extremely concise. Use short sentences. Omit unnecessary explanations. Get straight to the point.",
  detailed:
    "Provide thorough, detailed explanations. Include examples, reasoning, and context. Explain trade-offs.",
  markdown:
    "Use rich markdown formatting: headers, bullet lists, code blocks, tables where helpful. Structure responses clearly.",
  plain:
    "Use plain text only. No markdown formatting, no code blocks, no special characters. Simple and readable.",
};

/**
 * Get the style instruction to inject into the system prompt.
 * Returns null if no custom style is set.
 */
export function getStylePrompt(): string | null {
  const style = process.env.CLAUDE_CODE_OUTPUT_STYLE as OutputStyleName | undefined;
  if (!style || !(style in STYLE_PROMPTS)) return null;
  return STYLE_PROMPTS[style];
}
