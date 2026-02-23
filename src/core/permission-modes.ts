/**
 * Permission Modes — controls how tool permissions are handled.
 *
 * 4 modes matching the original:
 * - default: Prompt user for all non-read-only tools
 * - acceptEdits: Auto-approve Write/Edit, prompt for Bash and others
 * - bypassPermissions: Auto-approve all tools (dangerous — for trusted environments)
 * - plan: Block all non-read-only tools (read-only exploration only)
 *
 * Also loads project-level permissions from .claude/settings.local.json
 * to auto-approve tools matching configured allow patterns.
 *
 * Configurable via --permission-mode CLI flag or CLAUDE_CODE_PERMISSION_MODE env var.
 */

import type { PermissionRequest, PermissionResult } from "../tools/tool-registry.js";
import { loadClaudeSettings, getClaudeProjectSettingsPath } from "./claude-compat.js";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

/**
 * Resolve the permission mode from CLI flag or environment variable.
 */
export function resolvePermissionMode(cliValue?: string): PermissionMode {
  const value = cliValue ?? process.env.CLAUDE_CODE_PERMISSION_MODE ?? "default";
  const valid: PermissionMode[] = [
    "default",
    "acceptEdits",
    "bypassPermissions",
    "plan",
  ];
  if (valid.includes(value as PermissionMode)) {
    return value as PermissionMode;
  }
  return "default";
}

// Tools that are auto-approved in acceptEdits mode
const AUTO_APPROVE_EDIT_TOOLS = new Set(["Write", "Edit"]);

// Tools that are always allowed (read-only tools handled by isReadOnly,
// but these are tools that should be allowed even in plan mode)
const PLAN_MODE_BLOCKED_MESSAGE =
  "Tool blocked: Plan mode only allows read-only tools. Use ExitPlanMode to request implementation approval.";

// ── Project Permissions ──────────────────────────────────────────────

export interface ProjectPermissions {
  allow: string[];
  deny: string[];
}

/**
 * Load project-level permissions from .claude/settings.local.json.
 *
 * Permission format examples:
 * - "ToolName" — matches any invocation of that tool
 * - "Bash(npm install:*)" — matches Bash tool where command starts with "npm install"
 * - "WebFetch(domain:example.com)" — matches WebFetch with specific domain
 */
export async function loadProjectPermissions(cwd: string): Promise<ProjectPermissions> {
  const result: ProjectPermissions = { allow: [], deny: [] };

  const settings = await loadClaudeSettings(getClaudeProjectSettingsPath(cwd));
  if (!settings) return result;

  const permissions = settings.permissions as Record<string, unknown> | undefined;
  if (!permissions || typeof permissions !== "object") return result;

  if (Array.isArray(permissions.allow)) {
    result.allow = permissions.allow.filter((p): p is string => typeof p === "string");
  }
  if (Array.isArray(permissions.deny)) {
    result.deny = permissions.deny.filter((p): p is string => typeof p === "string");
  }

  return result;
}

/**
 * Check if a tool invocation matches a permission pattern.
 *
 * Patterns:
 * - "ToolName" → matches any invocation of that tool
 * - "ToolName(prefix:*)" → matches tool where the first input string starts with prefix
 * - "WebFetch(domain:example.com)" → matches tool with domain-based filter
 */
function matchesPermissionPattern(
  pattern: string,
  toolName: string,
  input: unknown
): boolean {
  // Simple pattern: just "ToolName"
  if (!pattern.includes("(")) {
    return pattern === toolName;
  }

  // Complex pattern: "ToolName(prefix:*)" or "ToolName(exact command)"
  const parenIdx = pattern.indexOf("(");
  const patternTool = pattern.slice(0, parenIdx);
  if (patternTool !== toolName) return false;

  const inner = pattern.slice(parenIdx + 1, -1); // Remove parens

  // Wildcard pattern: "prefix:*" — match if input starts with prefix
  if (inner.endsWith(":*")) {
    const prefix = inner.slice(0, -2);

    // For Bash tool, check the "command" field
    if (toolName === "Bash" && typeof input === "object" && input !== null) {
      const cmd = (input as Record<string, unknown>).command;
      if (typeof cmd === "string") {
        return cmd.startsWith(prefix) || cmd.trimStart().startsWith(prefix);
      }
    }

    // For WebFetch/WebSearch, check "domain:" pattern against url
    if (prefix.startsWith("domain:")) {
      const domain = prefix.slice(7);
      if (typeof input === "object" && input !== null) {
        const url = (input as Record<string, unknown>).url as string | undefined;
        if (typeof url === "string") {
          try {
            return new URL(url).hostname === domain || new URL(url).hostname.endsWith(`.${domain}`);
          } catch {
            return false;
          }
        }
      }
    }

    // Generic: check if any string input field starts with prefix
    if (typeof input === "object" && input !== null) {
      for (const val of Object.values(input as Record<string, unknown>)) {
        if (typeof val === "string" && val.startsWith(prefix)) return true;
      }
    }
    return false;
  }

  // Exact match pattern (no wildcard)
  if (toolName === "Bash" && typeof input === "object" && input !== null) {
    const cmd = (input as Record<string, unknown>).command;
    if (typeof cmd === "string") {
      return cmd.trim() === inner.trim();
    }
  }

  return false;
}

/**
 * Check if a tool invocation is allowed by project permissions.
 *
 * Returns:
 * - "allow" if explicitly permitted
 * - "deny" if explicitly denied
 * - null if no matching pattern (defer to normal permission flow)
 */
export function checkProjectPermission(
  permissions: ProjectPermissions,
  toolName: string,
  input: unknown
): "allow" | "deny" | null {
  // Check deny patterns first (deny takes precedence)
  for (const pattern of permissions.deny) {
    if (matchesPermissionPattern(pattern, toolName, input)) {
      return "deny";
    }
  }

  // Check allow patterns
  for (const pattern of permissions.allow) {
    if (matchesPermissionPattern(pattern, toolName, input)) {
      return "allow";
    }
  }

  return null;
}

/**
 * Create a permission callback wrapper that enforces the permission mode.
 *
 * @param mode - The permission mode to enforce
 * @param baseCallback - The underlying permission prompt (user interaction)
 * @param projectPermissions - Optional project-level permissions from .claude/settings.local.json
 * @returns A wrapped permission callback, or undefined if all tools are auto-approved
 */
export function createPermissionWrapper(
  mode: PermissionMode,
  baseCallback: (request: PermissionRequest) => Promise<PermissionResult>,
  projectPermissions?: ProjectPermissions
): ((request: PermissionRequest) => Promise<PermissionResult>) | undefined {
  switch (mode) {
    case "bypassPermissions":
      // Auto-approve everything — no callback needed
      return undefined;

    case "plan":
      // Block all non-read-only tools (they wouldn't reach here if read-only)
      // Except ExitPlanMode which is the escape hatch
      return async (request: PermissionRequest) => {
        if (request.toolName === "ExitPlanMode") {
          return "allow";
        }
        // Return deny with a message (the tool result will contain the error)
        return "deny";
      };

    case "acceptEdits":
      // Auto-approve Write/Edit, prompt for everything else
      return async (request: PermissionRequest) => {
        if (AUTO_APPROVE_EDIT_TOOLS.has(request.toolName)) {
          return "allow";
        }
        // Check project permissions before prompting
        if (projectPermissions) {
          const result = checkProjectPermission(
            projectPermissions,
            request.toolName,
            request.input
          );
          if (result) return result;
        }
        return baseCallback(request);
      };

    case "default":
    default:
      // Check project permissions, then prompt for everything else
      if (projectPermissions && projectPermissions.allow.length > 0) {
        return async (request: PermissionRequest) => {
          const result = checkProjectPermission(
            projectPermissions,
            request.toolName,
            request.input
          );
          if (result) return result;
          return baseCallback(request);
        };
      }
      return baseCallback;
  }
}

/**
 * Get a human-readable description of the permission mode.
 */
export function describePermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case "default":
      return "Prompt for all non-read-only tools";
    case "acceptEdits":
      return "Auto-approve Write/Edit, prompt for Bash and others";
    case "bypassPermissions":
      return "Auto-approve all tools (no prompts)";
    case "plan":
      return "Read-only mode (planning only, no execution)";
  }
}
