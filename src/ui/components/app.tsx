/**
 * App — root Ink component.
 *
 * Uses <Static> for completed blocks (append-only, never re-rendered).
 * The live region contains:
 * - TextInput during "input" phase (user typing)
 * - Processing output during "processing" phase (spinner, streaming, tools)
 */

import React, { useReducer, useImperativeHandle, forwardRef, useEffect, useRef } from "react";
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
import { TextInput, type TextInputProps, type TextInputHandle } from "./text-input.js";
import { PermissionPrompt } from "./permission-prompt.js";
import { QuestionPrompt } from "./question-prompt.js";
import { SessionSelector } from "./session-selector.js";
import { ListSelector } from "./list-selector.js";
import { FileSelector } from "./file-selector.js";
import { WizardDialog } from "./wizard-dialog.js";

// ── App Handle (exposed to index.tsx) ──────────────────────────────

export interface AppHandle {
  dispatch: (action: AppAction) => void;
  getState: () => AppState;
}

// ── Props ──────────────────────────────────────────────────────────

export interface AppProps {
  /** Called when user submits text input. */
  onSubmit?: (value: string, mentions: string[]) => void;
  /** Called on Ctrl+C during input. */
  onInterrupt?: () => void;
  /** Called on Ctrl+C during processing (to abort the current operation). */
  onProcessingInterrupt?: () => void;
  /** Called on Ctrl+D (EOF). */
  onExit?: () => void;
  /** Tab completer for slash commands. */
  completer?: TextInputProps["completer"];
  /** Called when user types "@" to trigger file mention. */
  onFileMention?: () => void;
}

// ── Component ──────────────────────────────────────────────────────

export const App = forwardRef<AppHandle, AppProps>(function App(
  { onSubmit, onInterrupt, onProcessingInterrupt, onExit, completer, onFileMention },
  ref,
) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const textInputRef = useRef<TextInputHandle>(null);

  useImperativeHandle(ref, () => ({
    dispatch,
    getState: () => state,
  }), [state]);

  const isProcessing = state.phase === "processing" || state.phase === "permission" || state.phase === "question";
  const isInput = state.phase === "input";
  const isPermission = state.phase === "permission";
  const isQuestion = state.phase === "question";
  const isSessionSelect = state.phase === "session-select";
  const isListSelect = state.phase === "list-select";
  const isFileSelect = state.phase === "file-select";
  const isWizard = state.phase === "wizard";

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
  }, { isActive: isProcessing && !isPermission && !isQuestion });

  // Auto-dismiss interrupt hint after 3 seconds
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state.interruptHint) {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => {
        dispatch({ type: "HIDE_INTERRUPT_HINT" });
        hintTimerRef.current = null;
      }, 3000);
    }
    return () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
    };
  }, [state.interruptHint]);

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
          <StatusLine retryInfo={state.retryInfo} />

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

          {/* Question prompt */}
          {isQuestion && state.pendingQuestion && (
            <QuestionPrompt
              question={state.pendingQuestion}
              dispatch={dispatch}
            />
          )}
        </Box>
      )}

      {/* Region C: session selector */}
      {isSessionSelect && state.sessionList.length >= 0 && (
        <SessionSelector
          sessions={state.sessionList}
          onSelect={(id) => {
            state.sessionSelectResolve?.(id);
            dispatch({ type: "SESSION_SELECT_END" });
          }}
          onCancel={() => {
            state.sessionSelectResolve?.(null);
            dispatch({ type: "SESSION_SELECT_END" });
          }}
        />
      )}

      {/* Region C2: generic list selector */}
      {isListSelect && state.listSelectItems.length >= 0 && (
        <ListSelector
          items={state.listSelectItems}
          header={state.listSelectHeader}
          onSelect={(id) => {
            state.listSelectResolve?.(id);
            dispatch({ type: "LIST_SELECT_END" });
          }}
          onCancel={() => {
            state.listSelectResolve?.(null);
            dispatch({ type: "LIST_SELECT_END" });
          }}
        />
      )}

      {/* Region C3: file selector (@-mention) */}
      {isFileSelect && state.fileSelectCwd && (
        <FileSelector
          cwd={state.fileSelectCwd}
          onSelect={(filePath) => {
            // Insert @mention into TextInput, then return to input phase
            textInputRef.current?.insertMention(filePath);
            dispatch({ type: "FILE_SELECT_END" });
          }}
          onCancel={() => {
            dispatch({ type: "FILE_SELECT_END" });
          }}
        />
      )}

      {/* Region C4: wizard dialog */}
      {isWizard && state.wizardStep && (
        <WizardDialog
          step={state.wizardStep}
          title={state.wizardTitle}
          onComplete={(result) => {
            state.wizardResolve?.(result);
            dispatch({ type: "WIZARD_END" });
          }}
        />
      )}

      {/* Region D: always-visible input (kept mounted during file-select for state) */}
      {onSubmit && !isSessionSelect && !isListSelect && !isWizard && (
        <TextInput
          ref={textInputRef}
          onSubmit={onSubmit}
          onInterrupt={onInterrupt}
          onExit={onExit}
          completer={completer}
          onFileMention={onFileMention}
          isActive={isInput}
        />
      )}

      {/* Transient interrupt hint */}
      {state.interruptHint ? (
        <Text>{chalk.dim(`  ${state.interruptHint}`)}</Text>
      ) : /* Status hint below input */
      isProcessing ? (
        <Text>{chalk.dim("  esc to interrupt")}</Text>
      ) : isInput ? (
        <Text>{chalk.dim("  /help for commands \u00B7 @ to mention file")}</Text>
      ) : null}
    </Box>
  );
});
