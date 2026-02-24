/**
 * App State & Reducer — central state that drives all Ink rendering.
 *
 * The agent loop dispatches actions via EventBridge; components read state.
 */

import type { Usage } from "../core/types.js";
import type { SessionMetadata } from "../core/session.js";
import type { UserQuestion } from "../tools/tool-registry.js";
import type { ListItem } from "./components/list-selector.js";

// ── Types ──────────────────────────────────────────────────────────

export type AppPhase = "input" | "processing" | "permission" | "question" | "session-select" | "list-select" | "file-select" | "wizard";

// ── Wizard Step Types ───────────────────────────────────────────────

export interface WizardSelectStep {
  type: "select";
  header: string;
  subtitle?: string;
  items: { id: string; label: string; description?: string }[];
}

export interface WizardTextStep {
  type: "text";
  header: string;
  subtitle?: string;
  placeholder?: string;
  multiline?: boolean;
}

export interface WizardMultiselectStep {
  type: "multiselect";
  header: string;
  subtitle?: string;
  items: { id: string; label: string; checked?: boolean }[];
}

export interface WizardConfirmStep {
  type: "confirm";
  header: string;
  lines: string[];
  actions: { key: string; label: string }[];
}

export type WizardStep = WizardSelectStep | WizardTextStep | WizardMultiselectStep | WizardConfirmStep;

export interface CompletedBlock {
  id: string;
  text: string;  // Pre-rendered markdown text
  type: "assistant" | "tool_use" | "tool_result" | "thinking" | "system" | "command" | "user";
}

export interface ActiveTool {
  toolUseId: string;
  toolName: string;
  params?: string;
  startTime: number;
}

export interface RetryInfo {
  attempt: number;
  max: number;
  delayMs: number;
  error: string;
}

export interface CompactInfo {
  pre: number;
  post: number;
}

export interface TaskItem {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  blockedBy?: string[];
  completedAt?: number;
}

export interface AgentInfo {
  toolUseId: string;
  description: string;
  status: string;
  tokenCount: number;
  toolUseCount: number;
  startTime: number;
  lastUpdate: number;
}

export type ExpandedView = "none" | "tasks" | "agents";

export interface PermissionPending {
  toolName: string;
  params?: string;
  /** Resolved with the raw key: "y" | "n" | "t" | "a" */
  resolve: (key: string) => void;
}

export interface QuestionPending {
  questions: UserQuestion[];
  resolve: (answers: Record<string, string>) => void;
}

export interface TurnSummary {
  durationSec: number;
  totalTokens: number;
  costUsd: number;
}

export interface AppState {
  phase: AppPhase;

  // Completed content (drives <Static>)
  completedBlocks: CompletedBlock[];

  // Live streaming state (current turn)
  streamingLines: string[];
  thinkingText: string;
  isThinking: boolean;

  // Tool activity
  activeTools: ActiveTool[];
  toolProgress: Map<string, string>;

  // Spinner
  spinnerLabel: string;
  spinnerVisible: boolean;

  // Turn metadata
  turnStartTime: number;

  // Error/status
  retryInfo: RetryInfo | null;
  compactInfo: CompactInfo | null;
  commandOutput: string[];

  // Transient interrupt hint (auto-dismissed)
  interruptHint: string | null;

  // Permission
  pendingPermission: PermissionPending | null;

  // Question
  pendingQuestion: QuestionPending | null;

  // Session selector
  sessionList: SessionMetadata[];
  sessionSelectResolve: ((id: string | null) => void) | null;

  // List selector
  listSelectItems: ListItem[];
  listSelectHeader: string;
  listSelectResolve: ((id: string | null) => void) | null;

  // File selector (@-mention)
  fileSelectCwd: string;

  // Wizard
  wizardStep: WizardStep | null;
  wizardTitle: string;
  wizardResolve: ((result: string | string[] | null) => void) | null;

  // Turn summary (shown after each assistant turn)
  turnSummary: TurnSummary | null;

  // Phase 2: Tasks & Agents
  tasks: TaskItem[];
  agents: AgentInfo[];
  expandedView: ExpandedView;
}

// ── Initial State ──────────────────────────────────────────────────

export function createInitialState(): AppState {
  return {
    phase: "input",
    completedBlocks: [],
    streamingLines: [],
    thinkingText: "",
    isThinking: false,
    activeTools: [],
    toolProgress: new Map(),
    spinnerLabel: "",
    spinnerVisible: false,
    turnStartTime: 0,
    retryInfo: null,
    compactInfo: null,
    commandOutput: [],
    interruptHint: null,
    pendingPermission: null,
    pendingQuestion: null,
    sessionList: [],
    sessionSelectResolve: null,
    listSelectItems: [],
    listSelectHeader: "",
    listSelectResolve: null,
    fileSelectCwd: "",
    wizardStep: null,
    wizardTitle: "",
    wizardResolve: null,
    turnSummary: null,
    tasks: [],
    agents: [],
    expandedView: "none",
  };
}

// ── Actions ────────────────────────────────────────────────────────

export type AppAction =
  | { type: "SET_PHASE"; phase: AppPhase }
  | { type: "TEXT_DELTA"; line: string }
  | { type: "THINKING_DELTA"; text: string }
  | { type: "THINKING_END" }
  | { type: "TOOL_USE_START"; toolUseId: string; toolName: string; params?: string; displayText?: string }
  | { type: "TOOL_RESULT"; toolUseId: string; toolName: string; displayText: string }
  | { type: "TOOL_PROGRESS"; toolUseId: string; content: string }
  | { type: "ASSISTANT_COMPLETE"; usage?: Usage; costUsd?: number }
  | { type: "TURN_COMPLETE"; summary?: TurnSummary }
  | { type: "RETRY"; info: RetryInfo }
  | { type: "COMPACT"; pre: number; post: number }
  | { type: "COMMAND_OUTPUT"; text: string }
  | { type: "REQUEST_PERMISSION"; permission: PermissionPending }
  | { type: "PERMISSION_RESOLVED" }
  | { type: "ASK_USER_QUESTION"; question: QuestionPending }
  | { type: "QUESTION_RESOLVED" }
  | { type: "SPINNER_START"; label: string }
  | { type: "SPINNER_STOP" }
  | { type: "SHOW_INTERRUPT_HINT"; text: string }
  | { type: "HIDE_INTERRUPT_HINT" }
  | { type: "CLEAR_STREAMING" }
  | { type: "FREEZE_BLOCK"; block: CompletedBlock }
  | { type: "PROCESSING_COMPLETE" }
  // Session selector
  | { type: "SESSION_SELECT_START"; sessions: SessionMetadata[]; resolve: (id: string | null) => void }
  | { type: "SESSION_SELECT_END" }
  // List selector
  | { type: "LIST_SELECT_START"; items: ListItem[]; header: string; resolve: (id: string | null) => void }
  | { type: "LIST_SELECT_END" }
  // File selector
  | { type: "FILE_SELECT_START"; cwd: string }
  | { type: "FILE_SELECT_END" }
  // Wizard
  | { type: "WIZARD_STEP"; step: WizardStep; title: string; resolve: (result: string | string[] | null) => void }
  | { type: "WIZARD_END" }
  // Phase 2
  | { type: "TASK_UPDATE"; task: TaskItem }
  | { type: "AGENT_UPDATE"; agent: AgentInfo }
  | { type: "AGENT_REMOVE"; toolUseId: string }
  | { type: "TOGGLE_PANEL" };

// ── Reducer ────────────────────────────────────────────────────────

let blockCounter = 0;

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_PHASE":
      return { ...state, phase: action.phase };

    case "TEXT_DELTA":
      return {
        ...state,
        streamingLines: [...state.streamingLines, action.line],
        spinnerVisible: false,
        isThinking: false,
      };

    case "THINKING_DELTA":
      return {
        ...state,
        thinkingText: state.thinkingText + action.text,
        isThinking: true,
        spinnerVisible: false,
      };

    case "THINKING_END":
      return {
        ...state,
        isThinking: false,
      };

    case "TOOL_USE_START": {
      const tool: ActiveTool = {
        toolUseId: action.toolUseId,
        toolName: action.toolName,
        params: action.params,
        startTime: Date.now(),
      };
      // Freeze any current streaming text and thinking
      const blocks = [...state.completedBlocks];
      if (state.streamingLines.length > 0) {
        blocks.push({
          id: `block-${blockCounter++}`,
          text: state.streamingLines.join(""),
          type: "assistant",
        });
      }
      if (state.thinkingText) {
        blocks.push({
          id: `block-${blockCounter++}`,
          text: state.thinkingText,
          type: "thinking",
        });
      }
      if (action.displayText) {
        blocks.push({
          id: `block-${blockCounter++}`,
          text: action.displayText,
          type: "tool_use",
        });
      }
      return {
        ...state,
        completedBlocks: blocks,
        streamingLines: [],
        thinkingText: "",
        isThinking: false,
        activeTools: [...state.activeTools, tool],
        spinnerVisible: true,
        spinnerLabel: `Running ${action.toolName}...`,
      };
    }

    case "TOOL_RESULT": {
      const newProgress = new Map(state.toolProgress);
      newProgress.delete(action.toolUseId);
      const blocks = [...state.completedBlocks];
      if (action.displayText) {
        blocks.push({
          id: `block-${blockCounter++}`,
          text: action.displayText,
          type: "tool_result",
        });
      }
      return {
        ...state,
        completedBlocks: blocks,
        activeTools: state.activeTools.filter(
          (t) => t.toolUseId !== action.toolUseId
        ),
        toolProgress: newProgress,
        spinnerVisible: true,
        spinnerLabel: "Thinking...",
      };
    }

    case "TOOL_PROGRESS": {
      const newProgress = new Map(state.toolProgress);
      newProgress.set(action.toolUseId, action.content);
      return { ...state, toolProgress: newProgress };
    }

    case "ASSISTANT_COMPLETE": {
      const blocks = [...state.completedBlocks];
      if (state.streamingLines.length > 0) {
        blocks.push({
          id: `block-${blockCounter++}`,
          text: state.streamingLines.join(""),
          type: "assistant",
        });
      }
      if (state.thinkingText) {
        blocks.push({
          id: `block-${blockCounter++}`,
          text: state.thinkingText,
          type: "thinking",
        });
      }
      return {
        ...state,
        completedBlocks: blocks,
        streamingLines: [],
        thinkingText: "",
        isThinking: false,
      };
    }

    case "TURN_COMPLETE":
      return {
        ...state,
        spinnerVisible: false,
        turnSummary: action.summary ?? null,
      };

    case "RETRY":
      return { ...state, retryInfo: action.info };

    case "COMPACT":
      return {
        ...state,
        compactInfo: { pre: action.pre, post: action.post },
      };

    case "COMMAND_OUTPUT": {
      // Freeze command output directly to Static blocks (append-only).
      const cmdBlock: CompletedBlock = {
        id: `cmd-${blockCounter++}`,
        text: action.text,
        type: "command",
      };
      return {
        ...state,
        completedBlocks: [...state.completedBlocks, cmdBlock],
      };
    }

    case "REQUEST_PERMISSION":
      return {
        ...state,
        pendingPermission: action.permission,
        spinnerVisible: false,
        phase: "permission",
      };

    case "PERMISSION_RESOLVED":
      return {
        ...state,
        pendingPermission: null,
        phase: "processing",
      };

    case "ASK_USER_QUESTION":
      return {
        ...state,
        pendingQuestion: action.question,
        spinnerVisible: false,
        phase: "question",
      };

    case "QUESTION_RESOLVED":
      return {
        ...state,
        pendingQuestion: null,
        phase: "processing",
      };

    case "SPINNER_START":
      return { ...state, spinnerVisible: true, spinnerLabel: action.label };

    case "SPINNER_STOP":
      return { ...state, spinnerVisible: false };

    case "SHOW_INTERRUPT_HINT":
      return { ...state, interruptHint: action.text };

    case "HIDE_INTERRUPT_HINT":
      return { ...state, interruptHint: null };

    case "CLEAR_STREAMING":
      return {
        ...state,
        streamingLines: [],
        thinkingText: "",
        commandOutput: [],
        turnSummary: null,
        retryInfo: null,
        compactInfo: null,
      };

    case "FREEZE_BLOCK":
      return {
        ...state,
        completedBlocks: [...state.completedBlocks, action.block],
      };

    case "PROCESSING_COMPLETE":
      // Reset all transient state and return to input phase.
      // TextInput will reappear for the next prompt.
      return {
        ...state,
        phase: "input",
        spinnerVisible: false,
        streamingLines: [],
        thinkingText: "",
        isThinking: false,
        toolProgress: new Map(),
        activeTools: [],
        retryInfo: null,
        compactInfo: null,
        turnSummary: null,
        commandOutput: [],
        pendingPermission: null,
        pendingQuestion: null,
        interruptHint: null,
      };

    // Session selector
    case "SESSION_SELECT_START":
      return {
        ...state,
        phase: "session-select",
        sessionList: action.sessions,
        sessionSelectResolve: action.resolve,
      };

    case "SESSION_SELECT_END":
      return {
        ...state,
        phase: "input",
        sessionList: [],
        sessionSelectResolve: null,
      };

    // List selector
    case "LIST_SELECT_START":
      return {
        ...state,
        phase: "list-select",
        listSelectItems: action.items,
        listSelectHeader: action.header,
        listSelectResolve: action.resolve,
      };

    case "LIST_SELECT_END":
      return {
        ...state,
        phase: "input",
        listSelectItems: [],
        listSelectHeader: "",
        listSelectResolve: null,
      };

    // File selector
    case "FILE_SELECT_START":
      return {
        ...state,
        phase: "file-select",
        fileSelectCwd: action.cwd,
      };

    case "FILE_SELECT_END":
      return {
        ...state,
        phase: "input",
        fileSelectCwd: "",
      };

    // Phase 2: Tasks
    case "TASK_UPDATE": {
      const existing = state.tasks.findIndex((t) => t.id === action.task.id);
      const newTasks = [...state.tasks];
      if (existing >= 0) {
        newTasks[existing] = action.task;
      } else {
        newTasks.push(action.task);
      }
      return { ...state, tasks: newTasks };
    }

    // Phase 2: Agents
    case "AGENT_UPDATE": {
      const existing = state.agents.findIndex(
        (a) => a.toolUseId === action.agent.toolUseId
      );
      const newAgents = [...state.agents];
      if (existing >= 0) {
        newAgents[existing] = action.agent;
      } else {
        newAgents.push(action.agent);
      }
      return { ...state, agents: newAgents };
    }

    case "AGENT_REMOVE":
      return {
        ...state,
        agents: state.agents.filter((a) => a.toolUseId !== action.toolUseId),
      };

    case "TOGGLE_PANEL": {
      const order: ExpandedView[] = ["none", "tasks", "agents"];
      const hasAgents = state.agents.length > 0;
      const idx = order.indexOf(state.expandedView);
      let next = order[(idx + 1) % order.length];
      // Skip agents panel if no agents running
      if (next === "agents" && !hasAgents) {
        next = "none";
      }
      return { ...state, expandedView: next };
    }

    // Wizard
    case "WIZARD_STEP":
      return {
        ...state,
        phase: "wizard",
        wizardStep: action.step,
        wizardTitle: action.title,
        wizardResolve: action.resolve,
      };

    case "WIZARD_END":
      return {
        ...state,
        phase: "input",
        wizardStep: null,
        wizardTitle: "",
        wizardResolve: null,
      };

    default:
      return state;
  }
}
