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
    // Accept y/n/t/a, default to "y" for anything else
    const resolved = ["y", "n", "t", "a"].includes(ch) ? ch : "y";
    permission.resolve(resolved);
    dispatch({ type: "PERMISSION_RESOLVED" });
  }, { isActive: true });

  return (
    <Box>
      <Text>
        {chalk.dim(`  Allow ${permission.toolName}? `)}
        {chalk.bold("[y]es / [n]o / allow [t]ool / [a]llow all: ")}
      </Text>
    </Box>
  );
}
