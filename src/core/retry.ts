/**
 * Retry logic matching Claude Code's original Rw1 wrapper.
 *
 * - Exponential backoff: min(BASE * 2^attempt, 32s) + 0-25% jitter
 * - Respects retry-after headers
 * - Context overflow auto-recovery (adjusts max_tokens)
 * - Configurable via CLAUDE_CODE_MAX_RETRIES env var
 */

const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 32000;
const FLOOR_OUTPUT_TOKENS = 3000; // Minimum tokens to reserve for output
const CONTEXT_BUFFER = 1000; // Buffer between input and context limit

/**
 * Get max retries from env or default.
 * Original: DEFAULT_MAX_RETRIES = 10, configurable via CLAUDE_CODE_MAX_RETRIES.
 */
export function getMaxRetries(): number {
  const env = process.env.CLAUDE_CODE_MAX_RETRIES;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return 10;
}

/**
 * Calculate retry delay with exponential backoff and jitter.
 * Formula: min(500ms * 2^attempt, 32s) + random(0, 25% of base)
 * Respects retry-after header if present.
 */
export function calculateRetryDelay(
  attempt: number,
  retryAfterMs?: number
): number {
  // If server told us how long to wait, use that
  if (retryAfterMs && retryAfterMs > 0) {
    return retryAfterMs;
  }

  // Exponential backoff capped at 32s
  const base = Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, attempt),
    MAX_RETRY_DELAY_MS
  );
  // Add 0-25% jitter to avoid thundering herd
  const jitter = Math.random() * 0.25 * base;
  return base + jitter;
}

/**
 * Sleep for a given number of milliseconds.
 * Respects abort signal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      },
      { once: true }
    );
  });
}

/**
 * Determine if an error is retryable.
 * Matches original's retryable conditions:
 * - 408, 409, 429, >= 500 status codes
 * - Overloaded errors
 * - Connection errors (ECONNRESET, ECONNREFUSED, etc.)
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // Claude SDK APIError — has status property
  if ("status" in error) {
    const status = (error as { status: number }).status;
    if (status === 408 || status === 409 || status === 429 || status >= 500) {
      return true;
    }
  }

  // Check error message for overloaded indicators
  const message = getErrorMessage(error);
  if (
    message.includes("overloaded") ||
    message.includes("overloaded_error") ||
    message.includes("server_overload")
  ) {
    return true;
  }

  // Connection errors
  if ("code" in error) {
    const code = (error as { code: string }).code;
    const retryableCodes = [
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "ENETDOWN",
      "ENETUNREACH",
      "EHOSTDOWN",
      "EHOSTUNREACH",
      "EPIPE",
      "UND_ERR_SOCKET",
    ];
    if (retryableCodes.includes(code)) return true;
  }

  return false;
}

/**
 * Parse retry-after header from error.
 * Returns milliseconds to wait, or undefined.
 */
export function parseRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  // Claude SDK errors expose headers
  if ("headers" in error) {
    const headers = (error as { headers: Record<string, string> }).headers;
    const retryAfter = headers?.["retry-after"];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }

  return undefined;
}

/**
 * Context overflow detection and recovery.
 *
 * When the API returns a 400 with "input length and 'max_tokens' exceed context limit",
 * we parse the error to extract the actual token counts and calculate a viable max_tokens.
 *
 * Returns the adjusted max_tokens, or null if this isn't a context overflow error.
 */
export function parseContextOverflow(
  error: unknown,
  currentMaxTokens: number
): number | null {
  if (!error || typeof error !== "object") return null;

  // Must be a 400 status
  if ("status" in error && (error as { status: number }).status !== 400) {
    return null;
  }

  const message = getErrorMessage(error);

  // Match patterns like "prompt is too long: 180000 tokens > 200000 token limit"
  // or "input length and 'max_tokens' exceed context limit"
  const tokenMatch = message.match(
    /(\d+)\s*tokens?\s*>\s*(\d+)\s*token/i
  );
  const exceedMatch = message.match(
    /input.*(?:length|tokens?).*exceed.*context/i
  );

  if (!tokenMatch && !exceedMatch) return null;

  if (tokenMatch) {
    const inputTokens = parseInt(tokenMatch[1], 10);
    const contextLimit = parseInt(tokenMatch[2], 10);
    const available = contextLimit - inputTokens - CONTEXT_BUFFER;

    if (available < FLOOR_OUTPUT_TOKENS) return null; // Can't recover
    return Math.max(FLOOR_OUTPUT_TOKENS, available);
  }

  // Generic context overflow — try halving max_tokens
  const halved = Math.floor(currentMaxTokens / 2);
  if (halved < FLOOR_OUTPUT_TOKENS) return null;
  return halved;
}

/**
 * Check if an error is an overloaded error (for model fallback tracking).
 */
export function isOverloadedError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("overloaded") ||
    message.includes("overloaded_error") ||
    (typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 529)
  );
}

/**
 * Check if an error is a context overflow (400 with context limit message).
 * Used by the agent loop to decide whether to compact and retry.
 */
export function isContextOverflowError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (!("status" in error) || (error as { status: number }).status !== 400)
    return false;
  const message = getErrorMessage(error);
  return (
    message.includes("exceed") && message.includes("context") ||
    /\d+\s*tokens?\s*>\s*\d+\s*token/i.test(message)
  );
}

/**
 * Categorize an API error for display.
 * Matches original's error categories.
 */
export function categorizeApiError(error: unknown): {
  category: string;
  message: string;
} {
  if (!error || typeof error !== "object") {
    return { category: "unknown", message: String(error) };
  }

  const status =
    "status" in error ? (error as { status: number }).status : 0;
  const msg = getErrorMessage(error);

  if (status === 401 || msg.includes("authentication") || msg.includes("api_key")) {
    return { category: "authentication_failed", message: msg };
  }
  if (status === 403 || msg.includes("billing") || msg.includes("payment")) {
    return { category: "billing_error", message: msg };
  }
  if (status === 429 || msg.includes("rate_limit")) {
    return { category: "rate_limit", message: msg };
  }
  if (status === 400) {
    return { category: "invalid_request", message: msg };
  }
  if (status >= 500) {
    return { category: "server_error", message: msg };
  }
  return { category: "unknown", message: msg };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
