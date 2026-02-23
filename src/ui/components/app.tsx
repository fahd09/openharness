/**
 * App — root Ink component.
 *
 * Uses <Static> for completed blocks (append-only, never re-rendered).
 * The live region contains:
 * - TextInput during "input" phase (user typing)
 * - Processing output during "processing" phase (spinner, streaming, tools)
 */

import React, { useReducer, useImperativeHandle, forwardRef } from "react";
import { Static, Box, Text, useInput } from "ink";
import chalk from "chalk";
import type { AppAction, AppState, CompletedBlock } from "../state.js";
import { appReducer, createInitialState } from "../state.js";
import { StaticBlock } from "./static-block.js";
import { StreamingText } from "./streaming-text.js";
import { ThinkingBlock } from "./thinking-block.js";
import { SpinnerWidget } from "./spinner-widget.js";
import { ToolProgress } from "./tool-progress.js";
import { StatusLine } from "./status-line.js";
import { TaskList } from "./task-list.js";
import { AgentTree } from "./agent-tree.js";
import { TextInput, type TextInputProps } from "./text-input.js";
import { PermissionPrompt } from "./permission-prompt.js";

// ── App Handle (exposed to index.tsx) ──────────────────────────────

export interface AppHandle {
  dispatch: (action: AppAction) => void;
  getState: () => AppState;
}

// ── Props ──────────────────────────────────────────────────────────

export interface AppProps {
  /** Called when user submits text input. */
  onSubmit?: (value: string) => void;
  /** Called on Ctrl+C during input. */
  onInterrupt?: () => void;
  /** Called on Ctrl+C during processing (to abort the current operation). */
  onProcessingInterrupt?: () => void;
  /** Called on Ctrl+D (EOF). */
  onExit?: () => void;
  /** Tab completer for slash commands. */
  completer?: TextInputProps["completer"];
}

// ── Component ──────────────────────────────────────────────────────

export const App = forwardRef<AppHandle, AppProps>(function App(
  { onSubmit, onInterrupt, onProcessingInterrupt, onExit, completer },
  ref,
) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);

  useImperativeHandle(ref, () => ({
    dispatch,
    getState: () => state,
  }), [state]);

  const isProcessing = state.phase === "processing" || state.phase === "permission";
  const isInput = state.phase === "input";
  const isPermission = state.phase === "permission";

  // Keyboard handling during processing (not during permission prompts)
  useInput((_input, key) => {
    if (key.ctrl && _input === "t") {
      dispatch({ type: "TOGGLE_PANEL" });
    }
    // Ctrl+C during processing — abort current operation
    if (key.ctrl && _input === "c") {
      onProcessingInterrupt?.();
    }
    // Escape during processing — also abort
    if (key.escape) {
      onProcessingInterrupt?.();
    }
  }, { isActive: isProcessing && !isPermission });

  return (
    <Box flexDirection="column">
      {/* Region A: frozen completed blocks — rendered once via Static */}
      <Static items={state.completedBlocks}>
        {(block: CompletedBlock) => (
          <StaticBlock key={block.id} block={block} />
        )}
      </Static>

      {/* Region B: live processing output (zero-height when idle) */}
      {isProcessing && (
        <Box flexDirection="column">
          {/* Thinking text */}
          {state.isThinking && state.thinkingText && (
            <ThinkingBlock text={state.thinkingText} isActive={state.isThinking} />
          )}

          {/* Streaming text */}
          <StreamingText lines={state.streamingLines} />

          {/* Tool progress */}
          <ToolProgress progress={state.toolProgress} />

          {/* Phase 2: Task list */}
          <TaskList
            tasks={state.tasks}
            visible={state.expandedView === "tasks" || state.tasks.some(t => t.status === "in_progress")}
          />

          {/* Phase 2: Agent tree */}
          <AgentTree
            agents={state.agents}
            visible={state.expandedView === "agents" || state.agents.length > 0}
          />

          {/* Status line */}
          <StatusLine
            retryInfo={state.retryInfo}
            compactInfo={state.compactInfo}
            turnSummary={state.turnSummary}
          />

          {/* Spinner */}
          <SpinnerWidget
            label={state.spinnerLabel}
            visible={state.spinnerVisible}
            showElapsed={true}
            startTime={state.turnStartTime}
          />

          {/* Permission prompt */}
          {isPermission && state.pendingPermission && (
            <PermissionPrompt
              permission={state.pendingPermission}
              dispatch={dispatch}
            />
          )}
        </Box>
      )}

      {/* Region C: always-visible input */}
      {onSubmit && (
        <TextInput
          onSubmit={onSubmit}
          onInterrupt={onInterrupt}
          onExit={onExit}
          completer={completer}
          isActive={isInput}
        />
      )}

      {/* Status hint below input */}
      {isProcessing ? (
        <Text>{chalk.dim("  esc to interrupt")}</Text>
      ) : isInput ? (
        <Text>{chalk.dim("  /help for commands")}</Text>
      ) : null}
    </Box>
  );
});
