/**
 * Commands Plugin — registers all built-in slash commands.
 *
 * Registers all commands except:
 * - /help (created separately since it needs the final CommandRegistry)
 * - /memory (registered by memory-plugin)
 * - /skills (registered by skills-plugin)
 */

import type { Plugin } from "../core/plugins/types.js";
import { exitCommand, clearCommand } from "../commands/session.js";
import { modelCommand } from "../commands/model.js";
import { costCommand } from "../commands/cost.js";
import { compactCommand } from "../commands/compact.js";
import { statusCommand } from "../commands/status.js";
import { resumeCommand } from "../commands/resume.js";
import { planCommand } from "../commands/plan.js";
import { doctorCommand } from "../commands/doctor.js";
import { diffCommand } from "../commands/diff.js";
import { renameCommand, tagCommand } from "../commands/organize.js";
import { outputStyleCommand } from "../commands/output-style.js";
import { undoCommand } from "../commands/undo.js";
import { loginCommand, logoutCommand } from "../commands/auth.js";
import { pluginCommand } from "../commands/plugin.js";
import { initCommand } from "../commands/init.js";
import { thinkingCommand } from "../commands/thinking.js";
import { fastCommand } from "../commands/fast.js";
import { configCommand } from "../commands/config.js";
import { hooksCommand } from "../commands/hooks-cmd.js";
import { feedbackCommand } from "../commands/feedback.js";
import { copyCommand } from "../commands/copy.js";
import { agentsCommand } from "../commands/agents-cmd.js";
import { todosCommand } from "../commands/todos.js";
import { contextCommand } from "../commands/context.js";
import { exportCommand } from "../commands/export.js";
import { forkCommand } from "../commands/fork.js";
import { tasksCommand } from "../commands/tasks.js";
import { permissionsCommand } from "../commands/permissions.js";
import { rewindCommand } from "../commands/rewind.js";
import { mcpCommand } from "../commands/mcp-cmd.js";

export const commandsPlugin: Plugin = {
  descriptor: {
    name: "commands",
    version: "1.0.0",
    description: "Built-in slash commands (session, model, info, tools)",
  },

  init(ctx) {
    // Session commands
    ctx.registerCommand(exitCommand);
    ctx.registerCommand(clearCommand);
    ctx.registerCommand(resumeCommand);
    ctx.registerCommand(renameCommand);
    ctx.registerCommand(tagCommand);

    // Model & config
    ctx.registerCommand(modelCommand);
    ctx.registerCommand(outputStyleCommand);
    ctx.registerCommand(thinkingCommand);
    ctx.registerCommand(fastCommand);
    ctx.registerCommand(configCommand);

    // Info commands
    ctx.registerCommand(costCommand);
    ctx.registerCommand(statusCommand);
    ctx.registerCommand(diffCommand);
    ctx.registerCommand(doctorCommand);
    ctx.registerCommand(agentsCommand);

    // Tools & actions
    ctx.registerCommand(compactCommand);
    ctx.registerCommand(planCommand);
    ctx.registerCommand(undoCommand);
    ctx.registerCommand(pluginCommand);
    ctx.registerCommand(loginCommand);
    ctx.registerCommand(logoutCommand);
    ctx.registerCommand(initCommand);
    ctx.registerCommand(hooksCommand);
    ctx.registerCommand(feedbackCommand);
    ctx.registerCommand(copyCommand);

    // New commands
    ctx.registerCommand(todosCommand);
    ctx.registerCommand(contextCommand);
    ctx.registerCommand(exportCommand);
    ctx.registerCommand(forkCommand);
    ctx.registerCommand(tasksCommand);
    ctx.registerCommand(permissionsCommand);
    ctx.registerCommand(rewindCommand);
    ctx.registerCommand(mcpCommand);
  },
};
