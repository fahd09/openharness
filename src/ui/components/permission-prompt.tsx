/**
 * PermissionPrompt — Ink-native permission prompt.
 *
 * Renders during "permission" phase and captures a single keypress
 * (y/n/t/a) to resolve the pending permission request.
 */

import React from "react";
import { Text, Box, useInput } from "ink";
import chalk from "chalk";
import type { PermissionPending, AppAction } from "../state.js";

interface PermissionPromptProps {
  permission: PermissionPending;
  dispatch: (action: AppAction) => void;
}

export function PermissionPrompt({ permission, dispatch }: PermissionPromptProps): React.ReactElement {
  useInput((input, key) => {
    // Ignore modifier-only keys
    if (key.ctrl || key.meta) return;

    const ch = input.toLowerCase();
    // Only accept y/n/t/a — ignore unknown keys
    if (!["y", "n", "t", "a"].includes(ch)) return;
    permission.resolve(ch);
    dispatch({ type: "PERMISSION_RESOLVED" });
  }, { isActive: true });

  return (
    <Box flexDirection="column">
      <Text>
        {chalk.dim(`  Allow ${permission.toolName}?`)}
      </Text>
      {permission.params && (
        <Text>
          {chalk.dim("    ") + chalk.cyan(permission.params)}
        </Text>
      )}
      <Text>
        {chalk.dim("  ")}
        {chalk.bold("[y]es / [n]o / allow [t]ool / [a]llow all: ")}
      </Text>
    </Box>
  );
}
