/**
 * Authentication — token storage and management.
 *
 * Stores credentials securely in ~/.openharness/auth.json with
 * restricted file permissions (0600). Supports token refresh logic.
 */

import { readFile, writeFile, mkdir, chmod } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const AUTH_DIR = join(homedir(), ".openharness");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

interface AuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  createdAt: string;
}

interface AuthStore {
  tokens: Record<string, AuthToken>;
}

/**
 * Load the auth store from disk.
 */
async function loadStore(): Promise<AuthStore> {
  try {
    const content = await readFile(AUTH_FILE, "utf-8");
    return JSON.parse(content) as AuthStore;
  } catch {
    return { tokens: {} };
  }
}

/**
 * Save the auth store to disk with restricted permissions.
 */
async function saveStore(store: AuthStore): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(store, null, 2), "utf-8");
  try {
    await chmod(AUTH_FILE, 0o600);
  } catch {
    // chmod may fail on some systems
  }
}

/**
 * Get the stored token for a provider.
 */
export async function getToken(provider: string): Promise<AuthToken | null> {
  const store = await loadStore();
  return store.tokens[provider] ?? null;
}

/**
 * Check if a token is expired.
 */
export function isTokenExpired(token: AuthToken): boolean {
  if (!token.expiresAt) return false;
  return new Date(token.expiresAt) < new Date();
}

/**
 * Store a token for a provider.
 */
export async function storeToken(
  provider: string,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: string
): Promise<void> {
  const store = await loadStore();
  store.tokens[provider] = {
    provider,
    accessToken,
    refreshToken,
    expiresAt,
    createdAt: new Date().toISOString(),
  };
  await saveStore(store);
}

/**
 * Remove a token for a provider.
 */
export async function removeToken(provider: string): Promise<void> {
  const store = await loadStore();
  delete store.tokens[provider];
  await saveStore(store);
}

/**
 * Login flow — currently supports API key-based auth.
 * OAuth flows would be added here for specific providers.
 */
export async function login(provider: string): Promise<void> {
  // For API-key based providers, check if the key is already in env
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (key) {
      await storeToken(provider, key);
      return;
    }
    throw new Error(
      "Set ANTHROPIC_API_KEY environment variable to authenticate."
    );
  }

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (key) {
      await storeToken(provider, key);
      return;
    }
    throw new Error(
      "Set OPENAI_API_KEY environment variable to authenticate."
    );
  }

  throw new Error(
    `Unknown provider: ${provider}. Supported: anthropic, openai`
  );
}

/**
 * Logout — remove stored credentials.
 */
export async function logout(provider: string): Promise<void> {
  await removeToken(provider);
}

/**
 * Get current auth status for display.
 */
export async function getAuthStatus(): Promise<
  Array<{ provider: string; authenticated: boolean; expiresAt?: string }>
> {
  const store = await loadStore();
  const status = [];
  for (const [provider, token] of Object.entries(store.tokens)) {
    status.push({
      provider,
      authenticated: !isTokenExpired(token),
      expiresAt: token.expiresAt,
    });
  }
  return status;
}
