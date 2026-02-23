import { randomUUID } from "crypto";

export function uuid(): string {
  return randomUUID();
}

export function timestamp(): string {
  return new Date().toISOString();
}

/** Rough token count estimate: ~4 chars per token */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate string to max chars, adding a note if truncated */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  return `${truncated}\n\n... (truncated, ${text.length - maxChars} chars omitted)`;
}

/** Get the current working directory */
export function cwd(): string {
  return process.cwd();
}

/** Check if a path is absolute */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/");
}
