/**
 * /permissions command — view and edit permission allow/deny rules.
 */

import chalk from "chalk";
import {
  loadProjectPermissions,
  saveProjectPermission,
  saveProjectDenyPermission,
  removeProjectPermission,
  resetProjectPermissions,
} from "../core/permission-modes.js";
import { getClaudeProjectSettingsPath } from "../core/claude-compat.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const permissionsCommand: SlashCommand = {
  name: "permissions",
  description: "View and manage permission rules",
  category: "tools",
  completions: ["list", "add", "deny", "remove", "reset"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || "";
    const pattern = parts.slice(1).join(" ");
    const settingsPath = getClaudeProjectSettingsPath(ctx.cwd);

    // Interactive mode when no subcommand (or "list" with no args)
    if ((subcommand === "" || subcommand === "list") && ctx.dispatch) {
      const toolNames = ctx.toolRegistry.getAll().map((t) => t.name).sort();
      await new Promise<void>((resolve) => {
        ctx.dispatch!({
          type: "PERMISSION_MANAGER_START",
          cwd: ctx.cwd,
          toolNames,
          resolve,
        });
      });
      return true;
    }

    if (subcommand === "list" || subcommand === "") {
      const perms = await loadProjectPermissions(ctx.cwd);

      output(chalk.bold("\n  Permissions"));
      output(chalk.dim("  " + "─".repeat(50)));
      output(`  ${chalk.dim("Mode:")}     ${ctx.permissionMode}`);
      output(`  ${chalk.dim("Config:")}   ${settingsPath}`);

      if (perms.allow.length === 0 && perms.deny.length === 0) {
        output(chalk.dim("\n  No custom rules configured."));
        output("");
        return true;
      }

      if (perms.allow.length > 0) {
        output(chalk.bold("\n  Allow Rules"));
        for (let i = 0; i < perms.allow.length; i++) {
          output(`  ${chalk.green("✓")} ${chalk.dim(`[${i}]`)} ${perms.allow[i]}`);
        }
      }

      if (perms.deny.length > 0) {
        output(chalk.bold("\n  Deny Rules"));
        for (let i = 0; i < perms.deny.length; i++) {
          output(`  ${chalk.red("✗")} ${chalk.dim(`[${i}]`)} ${perms.deny[i]}`);
        }
      }

      output("");
      return true;
    }

    if (subcommand === "add") {
      if (!pattern) {
        output(chalk.red("Usage: /permissions add <pattern>"));
        return true;
      }
      await saveProjectPermission(ctx.cwd, pattern);
      output(chalk.green(`Added allow rule: ${pattern}`));
      return true;
    }

    if (subcommand === "deny") {
      if (!pattern) {
        output(chalk.red("Usage: /permissions deny <pattern>"));
        return true;
      }
      await saveProjectDenyPermission(ctx.cwd, pattern);
      output(chalk.green(`Added deny rule: ${pattern}`));
      return true;
    }

    if (subcommand === "remove") {
      if (!pattern) {
        output(chalk.red("Usage: /permissions remove <pattern>"));
        return true;
      }
      const removedAllow = await removeProjectPermission(ctx.cwd, pattern, "allow");
      const removedDeny = await removeProjectPermission(ctx.cwd, pattern, "deny");
      if (removedAllow || removedDeny) {
        output(chalk.green(`Removed rule: ${pattern}`));
      } else {
        output(chalk.yellow(`Pattern not found: ${pattern}`));
      }
      return true;
    }

    if (subcommand === "reset") {
      await resetProjectPermissions(ctx.cwd);
      output(chalk.green("All permission rules cleared."));
      return true;
    }

    output(chalk.yellow(`Unknown subcommand: ${subcommand}. Use list, add, deny, remove, or reset.`));
    return true;
  },
};
