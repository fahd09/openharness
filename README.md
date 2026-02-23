# Claude Code Core

A lightweight, extensible AI-powered coding assistant CLI written in TypeScript. Provides interactive terminal access to multiple LLM providers (Anthropic, OpenAI, OpenAI-compatible, Google Gemini) with 19 built-in tools, 30+ slash commands, session management, MCP integration, and a plugin ecosystem — all in ~14,000 lines with zero heavy dependencies.

## Supported LLM Providers

- **Anthropic Claude** (default) — Claude 4 Opus, Claude 4 Sonnet, Claude 4.5 Haiku
- **OpenAI** — GPT-4o, GPT-4o-mini, GPT-4 Turbo, o1, o3
- **Google Gemini** — Gemini 2.5 Flash/Pro, Gemini 3 Flash/Pro, Gemini 3.1 Pro
- **OpenAI-Compatible APIs** — Any OpenAI-compatible endpoint:
  - Azure OpenAI, Together AI, Groq, Mistral, Qwen
  - Ollama, LM Studio, vLLM, text-generation-inference (local)

## Features

### Core Capabilities
- **Interactive REPL** with tab completion, multi-line input (backslash continuation), and Escape to clear
- **One-shot mode** — Execute single prompts with formatted markdown output
- **19 built-in tools** — Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task (subagents with custom agent support), NotebookEdit, TodoWrite, EnterPlanMode, ExitPlanMode, and more
- **Session management** — Save, resume, search, tag, rename, and list conversations
- **Streaming output** — Real-time text + thinking display with syntax-highlighted code blocks

### 30+ Slash Commands
- **Session**: `/exit`, `/clear`, `/sessions [query]`, `/resume`, `/rename`, `/tag`
- **Model**: `/model [name]`, `/fast` (toggle haiku), `/thinking [on|off]`, `/output-style`, `/config`
- **Info**: `/help`, `/cost`, `/status`, `/diff`, `/memory`, `/doctor`, `/hooks`, `/agents`
- **Actions**: `/compact [instructions]`, `/plan`, `/init`, `/copy`, `/undo`, `/skills`, `/plugin`, `/feedback`, `/login`

### Advanced Features
- **Smart permissions** — 4 modes: default, acceptEdits, bypassPermissions, plan
- **Context management** — Auto-compaction at 80% context window; manual `/compact` with custom preservation instructions
- **Extended thinking** — Configurable budget with toggleable display (`/thinking`)
- **Fast mode** — One-command toggle to faster model variant (`/fast`)
- **Syntax highlighting** — 15+ languages in code blocks (TS/JS, Python, Rust, Go, Bash, SQL, JSON, YAML, CSS, etc.)
- **Rich markdown** — Tables with box-drawing borders, clickable hyperlinks (OSC 8), strikethrough
- **Memory system** — Persistent project-scoped notes with topic files and compaction
- **File history & undo** — Pre-edit snapshots with `/undo`, auto-cleanup on session end
- **Cost tracking** — Per-turn display + per-model breakdown via `/cost`
- **10 lifecycle hooks** — PreToolUse, PostToolUse, PostToolUseFailure, Stop (blockable), SubagentStop, Notification, SessionStart, SessionEnd, UserPromptSubmit, PreCompact — with shell, LLM prompt, and programmatic handlers
- **Custom agents** — Define domain-specific agents via markdown files with tool restrictions, memory, and scoped hooks
- **Skills system** — Custom reusable commands via markdown files with `$ARGUMENTS` substitution, `!`command`` preprocessing, fork context, and once-per-session support
- **MCP integration** — Connect to Model Context Protocol servers (stdio + SSE transports)
- **Plugin system** — Installable plugins with custom tools and hooks
- **Claude Code compatibility** — Read-only import of sessions, memory, commands, MCP configs, hooks, and permissions from the official Claude Code CLI (`~/.claude/` and `.claude/`)
- **Diagnostics** — `/doctor` checks Node.js, API keys, CLI tools, network, MCP servers, plugins
- **Shell completions** — bash, zsh, and fish completion scripts
- **Project scaffolding** — `/init` generates CLAUDE.md from detected project type
- **Clipboard** — `/copy` copies code blocks to clipboard (macOS/Linux/Windows)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env: ANTHROPIC_API_KEY=sk-ant-...

# 3. Start the REPL
npm start

# 4. Or one-shot
npm start -- -p "Explain this codebase"
npm start -- -m opus -p "Review this code for security issues"
```

## Usage

### Interactive Mode
```
$ npm start

claude-code-core v0.1.0
  Model:    claude-sonnet-4-20250514 (anthropic)
  Mode:     default
  CWD:      /Users/you/project
  Branch:   main
  Session:  a1b2c3d4

  Try:
    > Explain the architecture of this project
    > Fix the failing tests in src/
    > Add input validation to the API endpoints

Type your message. /help for commands. Ctrl+C to interrupt.

❯ _
```

### One-Shot Mode
```bash
# Anthropic Claude (default)
npm start -- -p "Create a simple Express server"
npm start -- -m haiku -p "What's in package.json?"

# OpenAI
LLM_PROVIDER=openai npm start -- -m gpt-4o -p "Create a REST API"

# Google Gemini
LLM_PROVIDER=gemini npm start -- -m gemini-2.5-flash -p "Create a REST API"

# Local Ollama
LLM_PROVIDER=openai-compat OPENAI_BASE_URL=http://localhost:11434/v1 npm start -- -m llama3.2
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-m, --model <model>` | Model (opus/sonnet/haiku, or full ID like gpt-4o) |
| `-p, --prompt <text>` | One-shot mode: run prompt and exit |
| `--max-turns <n>` | Maximum agentic turns per interaction |
| `--thinking-budget <n>` | Extended thinking budget in tokens (min 1024, Claude only) |
| `--permission-mode <mode>` | default / acceptEdits / bypassPermissions / plan |
| `-r, --resume <id>` | Resume a previous session by ID |
| `--system-prompt <text>` | Custom system prompt override |
| `-v, --verbose` | Show detailed token usage and costs |

### Slash Commands Reference

**Session Management:**
| Command | Description |
|---------|-------------|
| `/exit`, `/quit` | Save session and exit |
| `/clear` | Clear conversation history |
| `/sessions [query]`, `/history` | List or search saved sessions |
| `/resume [id]`, `/r` | Resume a previous session |
| `/rename <name>` | Rename the current session |
| `/tag <tag>` | Add a tag to the current session |

**Model & Configuration:**
| Command | Description |
|---------|-------------|
| `/model [name]`, `/m` | View available models or switch (interactive menu if no arg) |
| `/fast` | Toggle fast mode (sonnet ↔ haiku, gpt-4o ↔ gpt-4o-mini) |
| `/thinking [on\|off]` | Toggle extended thinking display |
| `/output-style [mode]`, `/style` | Set response style (concise/detailed/markdown/plain) |
| `/config`, `/settings` | View provider, model, API keys, config file locations |

**Information:**
| Command | Description |
|---------|-------------|
| `/help`, `/h`, `/?` | Show all commands grouped by category |
| `/cost` | Per-model token usage and cost breakdown |
| `/status` | Session overview: model, context usage, cost, files changed |
| `/diff` | File changes made during this session (with +/- counts) |
| `/memory [topics\|compact\|<topic>]` | View/manage persistent memory and topic files |
| `/doctor` | Environment diagnostics (Node, API, tools, network, MCP, plugins) |
| `/hooks` | View configured hooks (global + project) |
| `/agents` | List built-in and custom agents |

**Tools & Actions:**
| Command | Description |
|---------|-------------|
| `/compact [instructions]` | Manually compact context with optional preservation hints |
| `/plan [description]` | Enter plan mode for structured task planning |
| `/init` | Generate CLAUDE.md from detected project type |
| `/copy [number\|all]` | Copy code blocks or full response to clipboard |
| `/undo [path]` | Revert last file edit from pre-edit snapshot |
| `/skills` | List loaded custom skill commands |
| `/plugin list\|install\|enable\|disable` | Manage plugins |
| `/feedback`, `/bug` | Submit feedback or report a bug |
| `/login` / `/logout` | Manage authentication tokens |

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | `anthropic` (default), `openai`, `openai-compat`, or `gemini` |
| `ANTHROPIC_API_KEY` | **Required** for Anthropic |
| `OPENAI_API_KEY` | **Required** for OpenAI (optional for local endpoints) |
| `OPENAI_BASE_URL` | Custom API endpoint for OpenAI-compatible providers |
| `GEMINI_API_KEY` | **Required** for Gemini (alias: `GOOGLE_API_KEY`) |
| `BRAVE_SEARCH_API_KEY` | For web search (optional) |
| `SERPER_API_KEY` | Alternative web search provider (optional) |
| `CLAUDE_CODE_THINKING_BUDGET` | Extended thinking token budget (Claude only) |
| `CLAUDE_CODE_MAX_RETRIES` | API retry limit (default: 10) |
| `CLAUDE_CODE_OUTPUT_STYLE` | Default output style (concise/detailed/markdown/plain) |
| `API_TIMEOUT_MS` | API timeout in milliseconds (default: 600000) |

### Config Files

| File | Location | Purpose |
|------|----------|---------|
| `CLAUDE.md` | Project root, `.claude/` | Project-specific instructions for the AI |
| `hooks.json` | `~/.claude-code-core/` or `.claude-code-core/` | Lifecycle hook handlers |
| `mcp.json` | `~/.claude-code-core/` or project root | MCP server configuration |
| `settings.json` | `~/.claude-code-core/` | Global settings |
| `MEMORY.md` | `~/.claude-code-core/projects/{hash}/memory/` | Persistent memory per project |
| `auth.json` | `~/.claude-code-core/` | Auth tokens (0600 perms) |
| `*.md` | `~/.claude-code-core/agents/` or `.claude-code-core/agents/` | Custom agent definitions |
| `*.md` | `~/.claude-code-core/skills/` or `.claude-code-core/skills/` | Custom skill commands |

> **Claude Code Compatibility:** The following files from the official Claude Code CLI are also discovered (read-only). See [Claude Code Compatibility](#claude-code-compatibility) for details.

| File | Location | Purpose |
|------|----------|---------|
| `*.jsonl` | `~/.claude/projects/{dirName}/` | Session transcripts (JSONL format) |
| `MEMORY.md` | `~/.claude/projects/{dirName}/memory/` | Project memory (fallback) |
| `*.md` | `<cwd>/.claude/commands/` | Custom slash commands |
| `mcp.json` | `~/.claude/` or `<cwd>/.claude/` | MCP server configuration |
| `settings.local.json` | `<cwd>/.claude/` | Hooks and tool permissions |

### Skills System

Create custom commands via markdown files in `~/.claude-code-core/skills/` (user) or `.claude-code-core/skills/` (project):

```markdown
---
name: commit
description: Create a git commit with a good commit message
command: /commit
---

Please create a git commit for the current staged changes.
```

#### Skill Frontmatter Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | *required* | Skill name |
| `description` | string | `""` | Short description (shown in system prompt) |
| `command` | string | *required* | Slash command (e.g., `/commit`) |
| `context` | `inline\|fork` | `inline` | `fork` delegates to a subagent for isolated execution |
| `agent` | string | `general-purpose` | Agent type when `context: fork` |
| `once` | `true\|false` | `false` | Only allow one invocation per session |
| `disable-model-invocation` | `true\|false` | `false` | Prevent the model from auto-invoking this skill |
| `user-invocable` | `true\|false` | `true` | Whether the user can invoke via slash command |
| `allowed-tools` | string (CSV) | all | Restrict tools during execution (e.g., `Read,Grep,Glob`) |

#### `$ARGUMENTS` Substitution

Skills support argument placeholders that are replaced before execution:

```markdown
---
name: review
command: /review
---

Review the file at $ARGUMENTS[0] focusing on $ARGUMENTS[1].

Full arguments: $ARGUMENTS
```

- `$ARGUMENTS` — replaced with the full args string
- `$ARGUMENTS[0]`, `$ARGUMENTS[1]`, ... — replaced with positional args
- If no placeholders found and args present, appended as `ARGUMENTS: ...`

#### Shell Command Preprocessing

Skills can inject dynamic data using `` !`command` `` syntax. Commands are executed before the prompt reaches the model:

```markdown
---
name: deploy
command: /deploy
context: fork
---

Deploy the current branch. Here's the current state:

Git status:
!`git status --short`

Current branch:
!`git rev-parse --abbrev-ref HEAD`

Last 3 commits:
!`git log --oneline -3`
```

Commands run with a 10-second timeout and 1MB buffer. `$ARGUMENTS` substitution applies inside commands too.

### Custom Agents

Define domain-specific agents via markdown files in `~/.claude-code-core/agents/` (user) or `.claude-code-core/agents/` (project). Project agents override user agents with the same name.

```markdown
---
name: db-reader
description: Safe database query agent
tools: ["Read", "Bash", "Grep"]
disallowedTools: ["Write", "Edit"]
model: haiku
maxTurns: 10
memory: project
---

You are a database query specialist. You can only run SELECT queries.
Never modify data. Always explain query results clearly.
```

#### Agent Frontmatter Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | *required* | Agent name (used as `subagent_type` in Task tool) |
| `description` | string | `""` | Short description |
| `tools` | JSON array | `["*"]` | Allowed tools (e.g., `["Read", "Bash", "Grep"]`) |
| `disallowedTools` | JSON array | none | Tools to explicitly remove |
| `model` | string | parent model | Model alias (`opus`, `sonnet`, `haiku`) or full ID |
| `maxTurns` | number | 30 | Maximum agentic turns |
| `forkContext` | boolean | `false` | Whether the agent receives parent conversation context |
| `memory` | `user\|project\|local` | none | Enable persistent memory for this agent |
| `hooks` | JSON array | none | Agent-scoped lifecycle hooks (see below) |
| `skills` | JSON array | none | Skills available to this agent |

#### Agent Memory

Agents with `memory` configured accumulate knowledge across sessions. Memory is stored as `MEMORY.md` and loaded into the agent's system prompt on each invocation.

| Scope | Location | Shared? |
|-------|----------|---------|
| `user` | `~/.claude-code-core/agent-memory/{name}/` | Across all projects |
| `project` | `<cwd>/.claude-code-core/agent-memory/{name}/` | Within the project |
| `local` | `<cwd>/.claude-code-core/agent-memory-local/{name}/` | Gitignored, local only |

The agent receives Read/Write/Edit tools automatically when memory is enabled, even if not in its `tools` list.

#### Agent-Scoped Hooks

Agents can define lifecycle hooks in their frontmatter. These hooks are active only while the agent is running and are automatically cleaned up when it finishes.

```markdown
---
name: linted-coder
description: Code agent with automatic linting
hooks: [{"event":"PostToolUse","command":"npx eslint --fix $HOOK_TOOL_NAME","toolFilter":["Write","Edit"]}]
---

You are a code agent. Write clean, well-structured code.
```

Agent `Stop` hooks are automatically converted to `SubagentStop` hooks (since they apply to the agent, not the parent loop).

#### Using Custom Agents

Custom agents are invoked through the Task tool like built-in agents:

```
Use the Task tool with subagent_type "db-reader" to query the database.
```

List all agents with `/agents`.

### Hook System

10 lifecycle events with three handler types: **shell commands**, **LLM prompts**, and **programmatic handlers**. Configure in `hooks.json` (global: `~/.claude-code-core/hooks.json`, project: `.claude-code-core/hooks.json`):

```json
[
  {
    "event": "PreToolUse",
    "command": "echo '{\"action\":\"continue\"}'",
    "toolFilter": ["Bash"]
  },
  {
    "event": "Stop",
    "type": "prompt",
    "prompt": "Check if all tasks are complete given this context: $ARGUMENTS"
  }
]
```

#### Hook Events

| Event | When | Can Block? | Context Fields |
|-------|------|-----------|----------------|
| `PreToolUse` | Before a tool executes | Yes (+ `updatedInput`) | `toolName`, `toolInput` |
| `PostToolUse` | After a tool succeeds | `additionalContext` | `toolName`, `toolInput`, `toolResult` |
| `PostToolUseFailure` | After a tool fails | `additionalContext` | `toolName`, `toolInput`, `error`, `isInterrupt` |
| `Stop` | Agent loop wants to stop | Yes (continues loop) | `lastAssistantMessage`, `stopReason` |
| `SubagentStop` | Subagent completes | No | `agentId`, `lastAssistantMessage`, `stopReason` |
| `Notification` | Background agent notification | No | `prompt` |
| `UserPromptSubmit` | User submits a prompt | Yes | `prompt` |
| `SessionStart` | Session begins | No | `sessionId` |
| `SessionEnd` | Session ends | No | `sessionId` |
| `PreCompact` | Before context compaction | Yes | `sessionId` |

#### Hook Handler Types

**Shell command hooks** (default) — Execute a shell command. Context is passed as JSON via stdin. Environment variables `HOOK_EVENT`, `HOOK_TOOL_NAME`, `HOOK_SESSION_ID` are also set.

```json
{"event": "PreToolUse", "command": "python3 validate_tool.py", "toolFilter": ["Bash"]}
```

The command's stdout is parsed as JSON. Supported response fields:
- `{"action": "block", "message": "reason"}` — block the action
- `{"action": "continue"}` — allow the action
- `{"action": "modify", "data": {...}}` — modify tool input (backward compat)
- `{"updatedInput": {...}}` — replace tool input with new values
- `{"additionalContext": ["extra info"]}` — inject context into conversation

**Prompt hooks** — Evaluate using a fast LLM (default: `claude-haiku-4-5-20251001`). The `$ARGUMENTS` placeholder is replaced with the hook context JSON. The model must respond with `{"ok": true/false, "reason": "..."}`.

```json
{
  "event": "Stop",
  "type": "prompt",
  "prompt": "Are all tasks in the following context complete? $ARGUMENTS",
  "model": "claude-haiku-4-5-20251001",
  "timeout": 10000
}
```

Prompt hooks fail-open: on timeout or parse error, they return `{ok: true}`.

**Programmatic hooks** — Register via `registerHook()` in plugins or code:

```typescript
import { registerHook } from "./core/hooks.js";

registerHook({
  event: "PreToolUse",
  handler: async (context) => {
    if (context.toolName === "Bash" && String(context.toolInput).includes("rm -rf")) {
      return { action: "block", message: "Dangerous command blocked" };
    }
    return { action: "continue" };
  },
});
```

#### Stop Hook (Blockable)

The Stop hook is the most powerful quality gate. When the agent loop wants to stop (end_turn or stop_sequence), the Stop hook fires. If a hook returns `"block"`, the loop injects a continuation message and keeps going.

This prevents the #1 model quality failure mode: premature stopping. A prompt hook like *"are all tasks complete?"* works regardless of model quality.

```json
[
  {
    "event": "Stop",
    "type": "prompt",
    "prompt": "Review this assistant response. Are all requested tasks fully complete? Context: $ARGUMENTS"
  }
]
```

A stop guard prevents infinite loops — once a Stop hook blocks, it won't fire again until the model makes a new stop attempt.

Informational (non-blockable) Stop hooks also fire for max_turns, budget_exhausted, and max_tokens stops.

#### `updatedInput` — Runtime Tool Input Modification

PreToolUse hooks can modify tool input before execution. Return `updatedInput` in the hook response:

```bash
#!/bin/bash
# prepend-set-e.sh — Auto-add `set -e` to all Bash commands
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.toolInput.command')
echo "{\"updatedInput\": {\"command\": \"set -e\\n$COMMAND\"}}"
```

```json
[{"event": "PreToolUse", "command": "bash prepend-set-e.sh", "toolFilter": ["Bash"]}]
```

The modified input is re-validated against the tool's Zod schema before execution.

#### `additionalContext` — Post-Execution Context Injection

PostToolUse and PostToolUseFailure hooks can inject additional context strings into the conversation. These are appended as user messages after tool results:

```json
[
  {
    "event": "PostToolUseFailure",
    "command": "echo '{\"additionalContext\": [\"Hint: check file permissions and try again\"]}'",
    "toolFilter": ["Bash"]
  }
]
```

### MCP (Model Context Protocol)

Connect to MCP servers for extended tool capabilities:

```json
{
  "servers": {
    "my-server": {
      "transport": "stdio",
      "command": "node",
      "args": ["./mcp-server.js"],
      "enabled": true
    }
  }
}
```

Supports **stdio** (child process) and **SSE** (HTTP) transports. Tools auto-registered as `mcp__serverName__toolName`.

### Claude Code Compatibility

Claude Code Core includes a **read-only compatibility layer** that seamlessly discovers and loads data from the official Claude Code CLI's directories (`~/.claude/` and `<cwd>/.claude/`). This means users who already use Claude Code can access their existing sessions, memory, commands, and settings without any migration. All writes stay in `~/.claude-code-core/` — we never modify `.claude/` directories.

#### Sessions

Claude Code sessions stored as JSONL files in `~/.claude/projects/` are automatically discovered and merged with native sessions. Use `/sessions` to see both, with Claude Code sessions tagged `[cc]`:

```
/sessions
  a1b2c3d4  2026-02-21  12 msgs  My native session
  84a12a2c  2026-02-01   5 msgs  Bank Data Integration [cc]
```

Resume any Claude Code session by its full UUID:
```
/resume 84a12a2c-6135-4504-867e-f6629ba29aab
```

The JSONL parser streams events line-by-line, collecting `user` and `assistant` messages while skipping internal events (`file-history-snapshot`, `queue-operation`, etc.). If a `sessions-index.json` exists, metadata is loaded from it; otherwise, files are scanned directly.

#### Memory

When loading project memory, `loadMemory()` checks the native path first (`~/.claude-code-core/projects/{hash}/memory/MEMORY.md`), then falls back to Claude Code's path (`~/.claude/projects/{dirName}/memory/MEMORY.md`). If both exist, the native version takes precedence. All writes go to the native path.

#### Commands

Slash commands defined in `<cwd>/.claude/commands/` are loaded alongside native skills. Each `.md` file becomes a command:

- **Filename** becomes the command name: `research.md` -> `/research`
- **File content** is the prompt template (`$ARGUMENTS` substitution works)
- Files with YAML frontmatter (`---`) are parsed like native skills
- Native skills take precedence over Claude Code commands with the same name

Example: if your project has `.claude/commands/deploy.md`, type `/deploy staging` to invoke it.

#### MCP Configuration

MCP server discovery checks these paths in order (last wins for servers with the same name):

1. `~/.claude-code-core/mcp.json` (native user-level)
2. `~/.claude/mcp.json` (Claude Code user-level)
3. `<cwd>/.claude-code-core/mcp.json` (native project-level)
4. `<cwd>/.claude/mcp.json` (Claude Code project-level)
5. `<cwd>/mcp.json` (project root)

#### Hooks

Hooks from `<cwd>/.claude/settings.local.json` are loaded in addition to native hooks. The `hooks` key should be an object keyed by event name:

```json
{
  "hooks": {
    "PreToolUse": [
      { "command": "echo '{\"action\":\"continue\"}'", "matcher": ["Bash"] }
    ]
  }
}
```

The `matcher` field maps to `toolFilter` in the native hook system.

#### Tool Permissions

Project-level permissions from `<cwd>/.claude/settings.local.json` are loaded at startup. Matching tools are auto-approved without prompting the user.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm install:*)",
      "Bash(npx tsx:*)",
      "Bash(python3:*)",
      "WebSearch",
      "WebFetch(domain:docs.example.com)"
    ],
    "deny": []
  }
}
```

**Permission pattern syntax:**

| Pattern | Matches |
|---------|---------|
| `"ToolName"` | Any invocation of that tool |
| `"Bash(prefix:*)"` | Bash commands starting with `prefix` |
| `"WebFetch(domain:example.com)"` | WebFetch requests to that domain |

Deny patterns take precedence over allow patterns. Tools not matching any pattern fall through to the normal permission prompt.

### Shell Completions

```bash
# Bash — add to ~/.bashrc
source /path/to/claude-code-core/src/completions/bash.sh

# Zsh — add to ~/.zshrc
source /path/to/claude-code-core/src/completions/zsh.sh

# Fish — copy to completions directory
cp src/completions/fish.sh ~/.config/fish/completions/claude-core.fish
```

## Provider Comparison

| Feature | Anthropic Claude | OpenAI | Google Gemini | OpenAI-Compatible |
|---------|------------------|---------|---------------|-------------------|
| Tool Use | Full support | Full support | Full support | Full support |
| Extended Thinking | Configurable budget | (o1/o3 internal) | Configurable budget | No |
| Prompt Caching | Automatic | No | No | No |
| Streaming | Text + thinking | Text only | Text + thinking | Text only |
| Local/Self-hosted | No | No | No | Yes (Ollama, etc.) |

## Architecture

```
src/                           # 92 files, ~14,000 lines
├── index.ts                   # CLI entry point, REPL loop (~1,075 lines)
├── utils.ts                   # Shared utilities
├── commands/                  # 26 slash command files
│   ├── index.ts               # Command registry barrel
│   ├── agents-cmd.ts          # /agents — list built-in + custom agents
│   ├── init.ts                # /init — project scaffolding
│   ├── model.ts               # /model — interactive model menu
│   ├── fast.ts                # /fast — toggle fast mode
│   ├── thinking.ts            # /thinking — toggle thinking display
│   ├── config.ts              # /config — settings viewer
│   ├── copy.ts                # /copy — clipboard support
│   ├── compact.ts             # /compact — manual compaction
│   ├── doctor.ts              # /doctor — environment diagnostics
│   ├── memory.ts              # /memory — persistent memory
│   └── ...                    # 15 more command files
├── completions/               # Shell completion scripts
│   ├── bash.sh
│   ├── zsh.sh
│   └── fish.sh
├── core/
│   ├── agent-loop.ts          # Main conversation loop
│   ├── commands.ts            # CommandRegistry + SlashCommand interface
│   ├── context.ts             # Context management, compaction
│   ├── session.ts             # Session persistence + Claude Code JSONL import
│   ├── memory.ts              # Persistent memory (MEMORY.md + topic files)
│   ├── markdown.ts            # Streaming markdown renderer (tables, hyperlinks)
│   ├── syntax-highlight.ts    # Code block highlighting (15+ languages)
│   ├── cost.ts                # Token tracking and cost calculation
│   ├── hooks.ts               # 10 lifecycle event hooks (shell, prompt, programmatic)
│   ├── hook-prompt.ts         # LLM-based hook evaluation (prompt hooks)
│   ├── agents.ts              # Custom agent loading from markdown files
│   ├── skills.ts              # Custom skill loader with preprocessing
│   ├── file-tracker.ts        # File change tracking
│   ├── file-history.ts        # Pre-edit snapshots for undo
│   ├── image.ts               # Image support (base64, auto-detection)
│   ├── pdf.ts                 # PDF text extraction
│   ├── auth.ts                # Token storage (0600 perms)
│   ├── output-style.ts        # Response style presets
│   ├── suggestions.ts         # Context-aware prompt suggestions
│   ├── permission-modes.ts    # 4 permission modes + project permissions
│   ├── claude-compat.ts       # Claude Code read-only compatibility layer
│   ├── retry.ts               # Exponential backoff
│   ├── streaming.ts           # Provider streaming helpers
│   ├── bash-analyzer.ts       # Intelligent bash output summarization
│   ├── types.ts               # Type definitions
│   ├── providers/
│   │   ├── base.ts            # LLMProvider interface
│   │   ├── anthropic.ts       # Claude API (caching, thinking)
│   │   ├── openai-compat.ts   # OpenAI + compatible endpoints
│   │   ├── gemini.ts          # Google Gemini API (streaming, thinking)
│   │   └── index.ts           # Provider factory
│   ├── mcp/
│   │   ├── config.ts          # MCP server configuration loader
│   │   ├── transport.ts       # Stdio + SSE transports
│   │   ├── client.ts          # JSON-RPC client, tool discovery
│   │   └── index.ts           # Init/disconnect barrel
│   └── plugins/
│       ├── types.ts           # Plugin manifest interface
│       ├── loader.ts          # Dynamic import loader
│       ├── manager.ts         # Install/enable/disable/list
│       └── index.ts           # Singleton barrel
├── tools/                     # 19 tool files
│   ├── tool-registry.ts       # Registration, permissions, concurrency
│   ├── read.ts                # Read files (+ PDF routing)
│   ├── write.ts               # Write files
│   ├── edit.ts                # Edit files (string replacement)
│   ├── bash.ts                # Shell execution
│   ├── glob.ts                # File pattern matching
│   ├── grep.ts                # Content search (ripgrep)
│   ├── task.ts                # Subagent delegation
│   ├── notebook-edit.ts       # Jupyter notebook cell editing
│   ├── web-search.ts          # Web search (Brave/Serper)
│   ├── web-fetch.ts           # URL fetching
│   ├── todo-write.ts          # Todo/task writing
│   ├── enter-plan-mode.ts     # Plan mode entry
│   ├── exit-plan-mode.ts      # Plan mode exit
│   ├── bash-output.ts         # Bash output retrieval
│   ├── kill-shell.ts          # Shell process termination
│   ├── shell-registry.ts      # Persistent shell management
│   ├── mcp-stubs.ts           # MCP tool stubs
│   └── all.ts                 # Auto-discovery barrel
├── prompt/
│   ├── system-prompt.ts       # Multi-segment prompt assembly with cache hints
│   ├── agent-prompts.ts       # Subagent-specific prompts
│   └── claude-md.ts           # CLAUDE.md file loader
└── lib/
    ├── diff.ts                # Unified diff computation and formatting
    └── spinner.ts             # Braille spinner with context labels
```

### Key Design Decisions

- **Anthropic-shaped internals** — All internal message types match the Anthropic SDK format. Providers translate at the API boundary.
- **Async generator tools** — Tools yield `progress` (transient UI) and `result` (AI-visible). Enables streaming progress display.
- **No build step** — `tsx` runs TypeScript directly. No compilation, no bundling.
- **Zero-dependency features** — Syntax highlighting, markdown tables, hyperlinks, and diff formatting all built in-house with chalk. No heavy parser dependencies.
- **Provider-agnostic** — Switching providers is one env var change. All tools work identically.
- **Command registry pattern** — Replaces inline if/else with structured `SlashCommand` interface + `CommandRegistry` class.

### Adding New Tools

1. Create `src/tools/your-tool.ts` implementing `Tool`
2. Export from `src/tools/all.ts`

```typescript
async *call(input, context) {
  yield { type: "progress", content: "Working..." };
  yield { type: "result", content: "Final result" };
}
```

### Adding New Commands

1. Create `src/commands/your-command.ts` implementing `SlashCommand`
2. Import and register in `src/commands/index.ts`

```typescript
export const myCommand: SlashCommand = {
  name: "mycommand",
  description: "What it does",
  category: "tools",
  async execute(args, ctx) {
    console.log("Hello from /mycommand");
    return true; // re-prompt
  },
};
```

## Development

```bash
npm start              # Run interactive REPL
npm run dev            # Watch mode with hot reload
npm start -- -p "..."  # One-shot mode
npx tsc --noEmit       # Type-check (no build needed)
```

No test framework or linter is configured yet.

## Requirements

- **Node.js 18+** (ES modules)
- **TypeScript 5.6+**
- API key for your chosen provider
- `ripgrep` (`rg`) — **required** for the Grep tool

### Recommended CLI Tools

```bash
# Install all at once (macOS)
brew install ripgrep fd fzf jq yq ast-grep bat git git-delta gh
```

| Tool | Purpose | Status |
|------|---------|--------|
| `rg` (ripgrep) | Fast regex search. Powers the Grep tool. | **Required** |
| `git` | Version control. Required for repo operations. | **Required** |
| `fd` | Fast file finder (gitignore-aware) | Recommended |
| `fzf` | Fuzzy finder for interactive selection | Recommended |
| `jq` | JSON processing | Recommended |
| `gh` | GitHub CLI for PR/issue management | Recommended |
| `ast-grep` | Syntax-aware code search and refactoring | Recommended |
| `bat` | Better `cat` with syntax highlighting | Optional |
| `yq` | YAML/XML processing | Optional |
| `git-delta` | Enhanced diff output | Optional |

## License

This project is provided as-is for educational and development purposes.

---

*Claude Code Core — 93 source files, ~14,000 lines of TypeScript. Multi-provider LLM CLI with full tool use, 30+ commands, custom agents, 10 lifecycle hooks, MCP/plugin ecosystem, Claude Code compatibility, and developer-friendly controls.*
