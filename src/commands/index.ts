/**
 * Commands Barrel — creates and populates the CommandRegistry.
 *
 * Registers all built-in slash commands. New commands should be
 * imported and registered here.
 */

import { CommandRegistry } from "../core/commands.js";
import { createHelpCommand } from "./help.js";
import { exitCommand, clearCommand, sessionsCommand } from "./session.js";
import { skillsCommand } from "./skills-cmd.js";
import { modelCommand } from "./model.js";
import { costCommand } from "./cost.js";
import { compactCommand } from "./compact.js";
import { statusCommand } from "./status.js";
import { resumeCommand } from "./resume.js";
import { memoryCommand } from "./memory.js";
import { planCommand } from "./plan.js";
import { doctorCommand } from "./doctor.js";
import { diffCommand } from "./diff.js";
import { renameCommand, tagCommand } from "./organize.js";
import { outputStyleCommand } from "./output-style.js";
import { undoCommand } from "./undo.js";
import { loginCommand, logoutCommand } from "./auth.js";
import { pluginCommand } from "./plugin.js";
import { initCommand } from "./init.js";
import { thinkingCommand } from "./thinking.js";
import { fastCommand } from "./fast.js";
import { configCommand } from "./config.js";
import { hooksCommand } from "./hooks-cmd.js";
import { feedbackCommand } from "./feedback.js";
import { copyCommand } from "./copy.js";
import { agentsCommand } from "./agents-cmd.js";

/**
 * Create and populate the command registry with all built-in commands.
 */
export function createCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  // Session commands
  registry.register(exitCommand);
  registry.register(clearCommand);
  registry.register(sessionsCommand);
  registry.register(resumeCommand);
  registry.register(renameCommand);
  registry.register(tagCommand);

  // Model & config
  registry.register(modelCommand);
  registry.register(outputStyleCommand);
  registry.register(thinkingCommand);
  registry.register(fastCommand);
  registry.register(configCommand);

  // Info commands
  registry.register(costCommand);
  registry.register(statusCommand);
  registry.register(diffCommand);
  registry.register(memoryCommand);
  registry.register(doctorCommand);
  registry.register(agentsCommand);

  // Tools & actions
  registry.register(compactCommand);
  registry.register(planCommand);
  registry.register(skillsCommand);
  registry.register(undoCommand);
  registry.register(pluginCommand);
  registry.register(loginCommand);
  registry.register(logoutCommand);
  registry.register(initCommand);
  registry.register(hooksCommand);
  registry.register(feedbackCommand);
  registry.register(copyCommand);

  // Help must be last — it needs the registry to list all commands
  registry.register(createHelpCommand(registry));

  return registry;
}
