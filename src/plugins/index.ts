/**
 * Built-in Plugins — barrel export.
 */

export { corePromptPlugin } from "./core-prompt-plugin.js";
export { memoryPlugin } from "./memory-plugin.js";
export { commandsPlugin } from "./commands-plugin.js";
export { skillsPlugin } from "./skills-plugin.js";

// CLI tool plugins (each wraps a single CLI tool)
export { cliRgPlugin } from "./cli-rg.js";
export { cliFdPlugin } from "./cli-fd.js";
export { cliFzfPlugin } from "./cli-fzf.js";
export { cliJqPlugin } from "./cli-jq.js";
export { cliYqPlugin } from "./cli-yq.js";
export { cliAstGrepPlugin } from "./cli-ast-grep.js";
export { cliBatPlugin } from "./cli-bat.js";
export { cliGitPlugin } from "./cli-git.js";
export { cliDeltaPlugin } from "./cli-delta.js";
export { cliGhPlugin } from "./cli-gh.js";
