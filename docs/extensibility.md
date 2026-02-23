# Extensibility Guide

Claude Code Core has 6 extension mechanisms, from zero-code configuration to full TypeScript plugins. This guide covers all of them, when to use each, and how they fit together.

## Quick Reference

| Mechanism | Effort | What It Extends | Format |
|-----------|--------|----------------|--------|
| [Skills](#skills) | Zero-code | Add slash commands | Markdown files |
| [Custom Agents](#custom-agents) | Zero-code | Add subagent types | Markdown files |
| [Hooks](#hooks) | Low-code | Intercept lifecycle events | JSON config + shell scripts |
| [MCP Servers](#mcp-servers) | Medium | Add external tools | MCP protocol (any language) |
| [Plugins](#plugins) | TypeScript | Register tools, commands, hooks, prompt segments | TypeScript module |
| [Prompt Overrides](#prompt-overrides) | Zero-code | Customize system prompt sections | Markdown files |

## Architecture: Plugins vs Core

```
src/plugins/              Registration layer (WHAT gets loaded)
  core-prompt-plugin.ts     Registers system prompt segments
  memory-plugin.ts          Registers /memory + memory prompt segment
  commands-plugin.ts        Registers 24 slash commands
  skills-plugin.ts          Registers /skills + loads skill files

src/commands/             Implementation layer (HOW commands work)
src/tools/                Implementation layer (HOW tools work)
src/prompt/               Implementation layer (HOW prompts are built)
src/prompts/              Content layer (markdown templates)
src/core/                 Core runtime (agent loop, hooks, sessions, etc.)
```

Plugins are a thin orchestration layer. They import from `src/commands/`, `src/tools/`, `src/core/`, and `src/prompt/`, then register everything through a unified `PluginContext`. The implementation files stay unchanged.

Built-in plugins ship with the CLI. External plugins are discovered from `~/.claude-code-core/plugins/`. Both use the same `Plugin` interface.

---

## Skills

**Best for:** Adding custom slash commands without writing TypeScript.

Skills are markdown files with YAML frontmatter. Drop a file in `~/.claude-code-core/skills/` (user-level) or `.claude-code-core/skills/` (project-level) and it becomes a slash command.

### Basic Skill

```markdown
---
name: commit
description: Create a git commit with a good message
command: /commit
---

Review the staged changes with `git diff --cached` and create a commit
with a clear, conventional commit message.
```

### Skill with Arguments

```markdown
---
name: review
description: Review a file for issues
command: /review
---

Review the file at $ARGUMENTS[0] focusing on: $ARGUMENTS

Look for bugs, security issues, and style problems.
```

- `$ARGUMENTS` -- full argument string
- `$ARGUMENTS[0]`, `$ARGUMENTS[1]` -- positional args
- If no placeholders found and args given, appended as `ARGUMENTS: ...`

### Skill with Dynamic Data

```markdown
---
name: deploy
command: /deploy
context: fork
---

Deploy the current branch. Current state:

Git status: !`git status --short`
Branch: !`git rev-parse --abbrev-ref HEAD`
Last commit: !`git log --oneline -1`
```

The `` !`command` `` syntax runs shell commands before the prompt reaches the model. 10-second timeout, 1MB buffer.

### Frontmatter Options

| Field | Default | Description |
|-------|---------|-------------|
| `name` | *required* | Skill name |
| `command` | *required* | Slash command (e.g., `/commit`) |
| `description` | `""` | Shown in `/skills` and system prompt |
| `context` | `inline` | `fork` delegates to a subagent |
| `agent` | `general-purpose` | Agent type when `context: fork` |
| `once` | `false` | Only allow one invocation per session |
| `disable-model-invocation` | `false` | Prevent AI from auto-invoking |
| `user-invocable` | `true` | Whether user can invoke via `/command` |
| `allowed-tools` | all | Restrict tools (CSV: `Read,Grep,Glob`) |

### Compatibility

Claude Code commands in `<cwd>/.claude/commands/*.md` are also loaded. Filename becomes the command name; content is the prompt. Native skills take precedence.

---

## Custom Agents

**Best for:** Creating domain-specific subagents with restricted tools and custom system prompts.

Agents are markdown files in `~/.claude-code-core/agents/` (user) or `.claude-code-core/agents/` (project). Invoked via the Task tool.

### Basic Agent

```markdown
---
name: db-reader
description: Safe database query agent
tools: ["Read", "Bash", "Grep"]
model: haiku
maxTurns: 10
---

You are a database query specialist. You can only run SELECT queries.
Never modify data. Always explain query results clearly.
```

### Agent with Memory

```markdown
---
name: research-assistant
description: Research agent that remembers across sessions
tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"]
memory: project
---

You are a research assistant. Save key findings to MEMORY.md.
```

Memory scopes: `user` (global), `project` (per-project), `local` (gitignored).

### Agent with Scoped Hooks

```markdown
---
name: linted-coder
description: Code agent with automatic linting
hooks: [{"event":"PostToolUse","command":"npx eslint --fix","toolFilter":["Write","Edit"]}]
---

You are a code agent. Write clean, well-structured code.
```

Scoped hooks are active only while the agent runs. `Stop` hooks are auto-converted to `SubagentStop`.

### Frontmatter Options

| Field | Default | Description |
|-------|---------|-------------|
| `name` | *required* | Agent name (used as `subagent_type` in Task tool) |
| `description` | `""` | Short description |
| `tools` | `["*"]` | Allowed tools |
| `disallowedTools` | none | Tools to remove |
| `model` | parent model | Model alias or full ID |
| `maxTurns` | 30 | Maximum agentic turns |
| `forkContext` | `false` | Receive parent conversation context |
| `memory` | none | `user`, `project`, or `local` |
| `hooks` | none | Agent-scoped lifecycle hooks |
| `skills` | none | Skills available to this agent |

---

## Hooks

**Best for:** Intercepting and modifying tool execution, enforcing policies, injecting context.

Configure in `hooks.json` at `~/.claude-code-core/` (global) or `.claude-code-core/` (project).

### Shell Command Hook

```json
[
  {
    "event": "PreToolUse",
    "command": "python3 validate.py",
    "toolFilter": ["Bash"]
  }
]
```

Context is passed as JSON via stdin. Environment variables: `HOOK_EVENT`, `HOOK_TOOL_NAME`, `HOOK_SESSION_ID`.

Response format (stdout):
- `{"action": "continue"}` -- allow
- `{"action": "block", "message": "reason"}` -- block
- `{"updatedInput": {...}}` -- modify tool input
- `{"additionalContext": ["extra info"]}` -- inject context

### Prompt Hook (LLM-evaluated)

```json
[
  {
    "event": "Stop",
    "type": "prompt",
    "prompt": "Are all tasks complete? Context: $ARGUMENTS",
    "model": "claude-haiku-4-5-20251001",
    "timeout": 10000
  }
]
```

The model responds with `{"ok": true/false, "reason": "..."}`. Fail-open on timeout.

### Programmatic Hook (via plugins)

```typescript
ctx.registerHook({
  event: "PreToolUse",
  handler: async (context) => {
    if (context.toolName === "Bash" && String(context.toolInput).includes("rm -rf")) {
      return { action: "block", message: "Dangerous command blocked" };
    }
    return { action: "continue" };
  },
});
```

### Events

| Event | When | Can Block? |
|-------|------|-----------|
| `PreToolUse` | Before tool executes | Yes (+ `updatedInput`) |
| `PostToolUse` | After tool succeeds | No (+ `additionalContext`) |
| `PostToolUseFailure` | After tool fails | No (+ `additionalContext`) |
| `Stop` | Agent loop wants to stop | Yes (continues loop) |
| `SubagentStop` | Subagent completes | No |
| `Notification` | Background notification | No |
| `UserPromptSubmit` | User submits prompt | Yes |
| `SessionStart` | Session begins | No |
| `SessionEnd` | Session ends | No |
| `PreCompact` | Before compaction | Yes |

---

## MCP Servers

**Best for:** Adding tools from external processes in any language.

Configure in `mcp.json` at `~/.claude-code-core/`, `.claude-code-core/`, or project root.

### Stdio Transport

```json
{
  "servers": {
    "my-tools": {
      "transport": "stdio",
      "command": "node",
      "args": ["./mcp-server.js"],
      "enabled": true
    }
  }
}
```

### SSE Transport

```json
{
  "servers": {
    "remote-tools": {
      "transport": "sse",
      "url": "http://localhost:3001/mcp",
      "enabled": true
    }
  }
}
```

Tools are auto-registered as `mcp__serverName__toolName`. MCP servers communicate via JSON-RPC over the chosen transport.

---

## Plugins

**Best for:** Composable TypeScript extensions that register tools, commands, hooks, and/or prompt segments through a unified interface.

### Plugin Interface

```typescript
import type { Plugin } from "./core/plugins/types.js";

export const myPlugin: Plugin = {
  descriptor: {
    name: "my-plugin",
    version: "1.0.0",
    description: "What this plugin does",
    dependencies: [],  // optional: other plugin names
  },

  async init(ctx) {
    // ctx.cwd — current working directory

    ctx.registerTool(myTool);
    ctx.registerCommand(myCommand);
    ctx.registerHook(myHook);
    ctx.registerPromptSegment({
      id: "my-segment",
      position: "dynamic",  // "static" | "dynamic" | "volatile"
      priority: 50,          // lower = earlier in prompt
      content: async ({ cwd, toolNames }) => {
        return "Text injected into the system prompt";
      },
    });
  },
};
```

### PluginContext Methods

| Method | What It Registers |
|--------|------------------|
| `registerTool(tool)` | A tool available to the AI model |
| `registerCommand(cmd)` | A `/slash` command |
| `registerHook(hook)` | A lifecycle hook handler |
| `registerPromptSegment(seg)` | A system prompt section |

### Prompt Segment Positions

| Position | Cache Behavior | Use For |
|----------|---------------|---------|
| `static` | Cached across all sessions | Stable content (identity, rules, guidelines) |
| `dynamic` | Cached within a session | Session-stable content (environment, project config, memory) |
| `volatile` | Never cached | Frequently changing content (output style) |

Lower `priority` values appear earlier within each position group.

### Built-in Plugins

| Plugin | What It Registers |
|--------|------------------|
| `core-prompt` | 8 prompt segments (identity, rules, tools, guidelines, environment, claude-md, output-style) |
| `memory` | `/memory` command + memory prompt segment |
| `commands` | 24 slash commands (all except `/help`, `/memory`, `/skills`) |
| `skills` | Skill loading + `/skills` command + skills-list prompt segment |

View with `/plugin list`.

### Registering a Built-in Plugin

In `src/index.tsx`:

```typescript
import { myPlugin } from "./plugins/my-plugin.js";

pluginManager.registerBuiltin(myPlugin);
```

### External (Legacy) Plugins

Plugins in `~/.claude-code-core/plugins/` with a `plugin.json` manifest are auto-discovered and wrapped into the new Plugin interface:

```
~/.claude-code-core/plugins/
  my-plugin/
    plugin.json    # { "name": "my-plugin", "version": "1.0.0", "description": "..." }
    index.js       # exports { tools: [...], hooks: [...] }
```

### Managing Plugins

```
/plugin list              Show all plugins with status
/plugin enable <name>     Enable a plugin
/plugin disable <name>    Disable a plugin
/plugin install <path>    Install from local path
```

---

## Prompt Overrides

**Best for:** Customizing system prompt sections without writing code.

System prompt templates are loaded from markdown files with a three-tier override hierarchy:

1. `.claude-code-core/prompts/{name}.md` (project-level, highest priority)
2. `~/.claude-code-core/prompts/{name}.md` (user-level)
3. `src/prompts/{name}.md` (built-in default)

### Available Prompt Files

| File | Section |
|------|---------|
| `system-identity.md` | AI identity and role |
| `system-rules.md` | Core behavioral rules |
| `system-tasks.md` | Task execution guidelines |
| `system-coding.md` | Coding conventions |
| `compaction.md` | Context compaction instructions |
| `bash-analyzer.md` | Bash output analysis prompt |
| `hook-evaluator.md` | Hook evaluation prompt |
| `agent-*.md` | Subagent prompts (explore, general, bash, security, default) |

### Example: Custom Coding Guidelines

Create `~/.claude-code-core/prompts/system-coding.md`:

```markdown
# Coding Guidelines

- Always use TypeScript strict mode
- Prefer functional style over classes
- Write tests for every new function
- Use JSDoc comments on all exports
```

This replaces the built-in `system-coding.md` for all your projects. For project-specific overrides, put the file in `.claude-code-core/prompts/` instead.

---

## Choosing the Right Mechanism

**"I want to add a custom slash command"**
Use a [Skill](#skills). Drop a markdown file, get a `/command`.

**"I want a specialized subagent for a domain"**
Use a [Custom Agent](#custom-agents). Markdown file with tool restrictions and custom prompt.

**"I want to validate/modify tool calls"**
Use a [Hook](#hooks). JSON config + shell script or prompt.

**"I want to add tools from an external service"**
Use an [MCP Server](#mcp-servers). Any language, stdio or SSE transport.

**"I want to register tools, commands, hooks, AND prompt segments together"**
Use a [Plugin](#plugins). TypeScript module with the unified Plugin interface.

**"I want to change the AI's personality or coding style"**
Use a [Prompt Override](#prompt-overrides). Drop a markdown file in the prompts directory.
