# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Core is a lightweight, extensible AI-powered coding assistant CLI written in TypeScript. It provides interactive terminal access to multiple LLM providers (Anthropic, OpenAI, OpenAI-compatible) with file operations, shell commands, web search, task delegation, session management, a plugin/MCP ecosystem, and 30+ slash commands.

**Stats**: 91 source files (88 TypeScript + 3 shell), ~13,000 lines across `src/`.

## Commands

```bash
npm start                    # Run interactive REPL
npm run dev                  # Watch mode with hot reload (tsx watch)
npm start -- -p "prompt"     # One-shot mode
npm start -- -m haiku -p "prompt"  # Specify model
npm start -- -r <id>         # Resume a session
npm start -- -v              # Verbose output (token details)
```

No build step required — uses `tsx` for direct TypeScript execution. No test framework or linter is configured yet.

## Architecture

### Entry Point

`src/index.ts` (~1,075 lines) — CLI argument parsing, REPL loop with tab completion, multi-line input (backslash continuation), Escape key handling, command dispatch via `CommandRegistry`, session management, permission prompts, welcome banner, per-turn token/cost display, file snapshot saving for undo, image path detection, and lifecycle hook firing.

### Command System (`src/commands/`, `src/core/commands.ts`)

26 slash commands managed by `CommandRegistry`. Each command implements `SlashCommand` { name, description, category, aliases?, execute(args, ctx) }. Commands receive `CommandContext` with mutable session state (messages, model, costTracker, fileTracker, systemPrompt, rl, cwd, sessionId, toolRegistry, permissionMode, runPrompt).

**Commands by category:**
- **Session**: exit/quit, clear, sessions/history, resume, rename, tag
- **Model & config**: model, fast, thinking, output-style, config
- **Info**: help, cost, status, diff, memory, doctor, hooks, agents
- **Tools & actions**: compact, plan, init, copy, undo, skills, plugin, feedback/bug, login, logout

**Adding a new command:**
1. Create `src/commands/your-command.ts` implementing `SlashCommand`
2. Import and register it in `src/commands/index.ts`

### Agent Loop (`src/core/agent-loop.ts`)

The core loop that drives all interactions:
1. Sends user message + tool schemas to the LLM provider
2. Receives streaming response (text, thinking, tool calls)
3. Executes tool calls via `ToolRegistry` (with concurrency control and permissions)
4. Injects tool results back into the conversation
5. Auto-compacts when context limits are reached
6. Loops until `end_turn` or max turns exhausted

Yields typed `LoopEvent`s (text_delta, thinking_delta, tool_use_start, tool_result, assistant, system/compact_boundary, retry, result) consumed by `index.ts` for display.

Exports `messagesToApi()` for use by the `/compact` command.

### LLM Provider Abstraction (`src/core/providers/`)

All providers implement `LLMProvider` from `base.ts` with two methods: `streamOnce()` (streaming) and `complete()` (non-streaming for compaction). Internal message format is Anthropic-shaped; each provider translates at the API boundary.

- `anthropic.ts` — Claude API with prompt caching, extended thinking, and per-env cache disabling
- `openai-compat.ts` — Shared implementation for both OpenAI and any OpenAI-compatible endpoint
- `index.ts` — Factory that selects provider based on `LLM_PROVIDER` env var
- `base.ts` — `LLMProvider` interface, `ProviderStreamParams` (includes `responseSchema` for structured output), `ProviderStreamYield`

### Tool System (`src/tools/`)

19 tool files. Tools implement the `Tool` interface from `tool-registry.ts`. Each tool is an async generator yielding `ToolOutput` (`progress` for transient display, `result` for final AI-visible output).

**Built-in tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, TodoWrite, NotebookEdit, EnterPlanMode, ExitPlanMode, BashOutput, KillShell, ShellRegistry, plus MCP stub tools.

**Key interfaces:**
- `Tool` — name, description, inputSchema (Zod), call(), isReadOnly(), isConcurrencySafe()
- `ToolRegistry` — registration, schema conversion (Zod → JSON Schema), concurrency queue, permission checking
- `ToolContext` — cwd, abortSignal, agentId, parentMessages, permission callback

**Adding a new tool:**
1. Create `src/tools/your-tool.ts` implementing the `Tool` interface
2. Export it from `src/tools/all.ts` (the barrel file)

### Markdown & Syntax Highlighting (`src/core/markdown.ts`, `src/core/syntax-highlight.ts`)

- `renderMarkdown(text)` — Full markdown → chalk-formatted text. Handles headers, bold/italic/strikethrough, code blocks with syntax highlighting, tables with box-drawing borders, clickable hyperlinks (OSC 8), blockquotes, lists, horizontal rules.
- `StreamingRenderer` — Line-buffered streaming renderer used during `onTextDelta`. Accumulates table rows, flushes on block boundaries.
- `highlightLine(line, lang)` — Keyword-based syntax highlighting for 15+ languages (TS/JS, Python, Rust, Go, Bash, SQL, JSON, YAML, CSS, etc.). Keywords → blue, strings → yellow, comments → dim green, numbers → magenta, types → cyan. Zero external dependencies.

### Permission Modes (`src/core/permission-modes.ts`)

Four modes: `default` (prompt for non-read-only), `acceptEdits` (auto-approve Write/Edit), `bypassPermissions` (approve all), `plan` (block all writes except ExitPlanMode).

### Session Management (`src/core/session.ts`)

Sessions stored as JSON in `~/.claude-code-core/sessions/`. Supports save, load, list, search (by title/tags/cwd/id), rename, tag, delete.

### Memory System (`src/core/memory.ts`)

Project-scoped via MD5 hash of cwd. Stored in `~/.claude-code-core/projects/{hash}/memory/`. Supports MEMORY.md (loaded into system prompt, truncated to 200 lines), topic-specific files (debugging.md, patterns.md, etc.), listing, and compaction.

### Context & Compaction (`src/core/context.ts`)

Estimates tokens, checks compaction thresholds (80% of context window), and compacts via LLM summarization. Supports custom preservation instructions passed from `/compact <instructions>`.

### MCP Client (`src/core/mcp/`)

- `config.ts` — Loads `mcp.json` from `~/.claude-code-core/`, `<cwd>/.claude-code-core/`, `<cwd>/`
- `transport.ts` — Stdio (child process) and SSE (fetch) transports
- `client.ts` — JSON-RPC client, tool discovery, converts MCP JSON Schema → Zod → internal Tool interface
- `index.ts` — `initializeMcpServers()` and `disconnectMcpServers()`

Tools registered as `mcp__serverName__toolName`.

### Plugin System (`src/core/plugins/`)

- `types.ts` — Plugin manifest interface
- `loader.ts` — Dynamic import from `~/.claude-code-core/plugins/`
- `manager.ts` — Install, enable, disable, list
- `index.ts` — Singleton `PluginManager`

### Other Core Modules

- `src/core/cost.ts` — Token tracking and cost calculation per model, per-model breakdown
- `src/core/retry.ts` — Exponential backoff, error classification, context overflow detection
- `src/core/hooks.ts` — 10 lifecycle events (PreToolUse, PostToolUse, PostToolUseFailure, Notification, UserPromptSubmit, SessionStart, SessionEnd, Stop, SubagentStop, PreCompact). Shell command, LLM prompt, or programmatic handlers. Scoped hooks for per-agent lifecycle. updatedInput/additionalContext support.
- `src/core/hook-prompt.ts` — LLM-based hook evaluation (prompt hooks via fast model)
- `src/core/agents.ts` — Custom agent loading from markdown files with YAML frontmatter. Agent registry with memory, hooks, tool restrictions.
- `src/core/skills.ts` — Custom commands loaded from `.claude-code-core/skills/` markdown files. $ARGUMENTS substitution, !`command` preprocessing, fork context, once tracking.
- `src/core/file-tracker.ts` — Records Write/Edit operations with lines added/removed
- `src/core/file-history.ts` — Pre-edit snapshots for `/undo`. Cleaned up on session end.
- `src/core/image.ts` — Image detection, base64 encoding, media type detection (png, jpg, gif, webp, svg, bmp)
- `src/core/pdf.ts` — PDF text extraction via `pdftotext` with fallback
- `src/core/auth.ts` — Token storage in `~/.claude-code-core/auth.json` (0600 perms)
- `src/core/output-style.ts` — 4 response styles (concise, detailed, markdown, plain)
- `src/core/suggestions.ts` — Context-aware prompt suggestions based on project type
- `src/core/bash-analyzer.ts` — Intelligent summarization of large bash outputs
- `src/core/streaming.ts` — Provider streaming helpers

### System Prompt (`src/prompt/`)

- `system-prompt.ts` — Builds multi-segment system prompt with cache hints. Segment 1 (cached): identity, system, tool instructions, task/coding guidelines. Segment 2 (cached): environment (platform, git, CLI tools), CLAUDE.md, MEMORY.md. Segment 3 (uncached): output style.
- `agent-prompts.ts` — Subagent-specific prompts (code, research, creative, fork)
- `claude-md.ts` — CLAUDE.md file loader from project directories

### Shell Completions (`src/completions/`)

bash.sh, zsh.sh, fish.sh — Complete CLI flags (--model, --permission-mode, etc.), model names, permission modes.

### Lib (`src/lib/`)

- `diff.ts` — Unified diff computation and formatting for Edit tool preview
- `spinner.ts` — Braille spinner with context labels ("Thinking...", "Running Bash...")

## Compatible Models

- **Anthropic Claude API** (default)
- **OpenAI GPT-4**
- **OpenAI GPT-3** (including variations like `o1`, `o3`, etc.)
- **OpenAI-Compatible APIs** (any API that adheres to OpenAI's API specifications)

## Conventions

- ES modules throughout (`"type": "module"` in package.json). All local imports use `.js` extension.
- TypeScript strict mode. Target ES2022, module ESNext, bundler resolution.
- Zod for tool input validation; JSON Schema derived from Zod schemas for the LLM API.
- No compilation step — `tsx` runs TypeScript directly.
- `ripgrep` (`rg`) is required on the system for the Grep tool.
- Commands use `SlashCommand` interface with category-based grouping.
- Tools are async generators yielding `{ type: "progress" | "result", content: string }`.
- Providers translate at the API boundary — all internals are Anthropic-shaped.
- Zero external dependencies for syntax highlighting, markdown rendering, and table formatting.
