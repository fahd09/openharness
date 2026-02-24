# CLAUDE.md

## Project Overview

OpenHarness — extensible AI coding assistant CLI in TypeScript. Multi-provider (Anthropic, OpenAI, Gemini, OpenAI-compatible), plugin architecture, 30+ slash commands, MCP integration.

## Commands

```bash
npm start                    # Interactive REPL
npm run dev                  # Watch mode (tsx watch)
npm start -- -p "prompt"     # One-shot mode
npm start -- -m haiku        # Specify model
npm start -- -r <id>         # Resume session
```

No build step — uses `tsx` directly. No test framework configured yet.

## Architecture (high-level)

- **Entry**: `src/index.tsx` — Ink-based terminal UI, plugin init, REPL loop
- **Agent loop**: `src/core/agent-loop.ts` — message → LLM → tool execution → loop
- **Providers**: `src/core/providers/` — Anthropic, OpenAI-compat, Gemini. All internals Anthropic-shaped; providers translate at API boundary
- **Tools**: `src/tools/` — async generators yielding `{ type: "progress"|"result", content }`. Registry does Zod → JSON Schema conversion
- **Commands**: `src/commands/` — `SlashCommand` interface, registered via plugins
- **Plugins**: `src/plugins/` — registration layer. `Plugin.init(ctx)` calls `registerTool/Command/Hook/PromptSegment`
- **Prompt**: `src/prompt/` — multi-segment system prompt with cache hints, built from plugin-registered segments

## Key Conventions

- ES modules with `.js` extension on all local imports
- TypeScript strict mode, target ES2022
- Zod for tool input schemas
- Tools are async generators (not plain async functions)
- No external deps for markdown rendering or syntax highlighting
- Config dir: `~/.openharness/`

## Adding Extensions

- **Command**: create file in `src/commands/`, implement `SlashCommand`, register in a plugin via `ctx.registerCommand()`
- **Tool**: create file in `src/tools/`, implement `Tool` interface, export from `src/tools/all.ts`
- **Plugin**: implement `Plugin` (descriptor + init), register in `src/index.tsx`
- **CLI tool plugin**: use `createCliToolPlugin()` factory from `src/plugins/cli-tool.ts`
