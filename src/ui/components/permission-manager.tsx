/**
 * PermissionManager — interactive permission rules editor.
 *
 * Tabbed UI (Allow / Deny / Workspace) with search filtering,
 * scrollable list, inline add/remove of rules.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import {
  loadProjectPermissions,
  saveProjectPermission,
  saveProjectDenyPermission,
  removeProjectPermission,
  loadSharedProjectPermissions,
  saveSharedProjectPermission,
  saveSharedProjectDenyPermission,
  removeSharedProjectPermission,
  type ProjectPermissions,
} from "../../core/permission-modes.js";

// ── Types ───────────────────────────────────────────────────────────

interface Props {
  cwd: string;
  toolNames: string[];
  onClose: () => void;
}

type Mode = "browse" | "add" | "confirm-remove";

interface TabDef {
  label: string;
  description: string;
}

const TABS: TabDef[] = [
  { label: "Allow", description: "Auto-approved tools \u2014 won\u2019t prompt before use." },
  { label: "Deny", description: "Blocked tools \u2014 always denied." },
  { label: "Workspace", description: "Shared rules in .claude/settings.json for the team." },
];

const VISIBLE_ITEMS = 12;
const ADD_ITEM_LABEL = "Add a new rule\u2026";

// ── Component ───────────────────────────────────────────────────────

export function PermissionManager({ cwd, toolNames, onClose }: Props): React.ReactElement {
  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [addText, setAddText] = useState("");
  const [permissions, setPermissions] = useState<ProjectPermissions>({ allow: [], deny: [] });
  const [sharedPermissions, setSharedPermissions] = useState<ProjectPermissions>({ allow: [], deny: [] });
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  // Load permissions
  const reload = useCallback(async () => {
    const [local, shared] = await Promise.all([
      loadProjectPermissions(cwd),
      loadSharedProjectPermissions(cwd),
    ]);
    setPermissions(local);
    setSharedPermissions(shared);
  }, [cwd]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Build list items for current tab
  const getItems = useCallback((): string[] => {
    let items: string[];
    if (activeTab === 0) {
      items = permissions.allow;
    } else if (activeTab === 1) {
      items = permissions.deny;
    } else {
      // Workspace: combine allow and deny with prefix
      items = [
        ...sharedPermissions.allow.map((p) => `[allow] ${p}`),
        ...sharedPermissions.deny.map((p) => `[deny] ${p}`),
      ];
    }
    return items;
  }, [activeTab, permissions, sharedPermissions]);

  const allItems = getItems();

  // Filter by search
  const filteredItems = searchQuery
    ? allItems.filter((item) => item.toLowerCase().includes(searchQuery.toLowerCase()))
    : allItems;

  // Full display list: "Add a new rule..." first, then filtered items
  const displayList = [ADD_ITEM_LABEL, ...filteredItems];

  // Clamp cursor
  const clampedCursor = Math.min(cursor, displayList.length - 1);

  // Viewport for scrolling
  const scrollOffset = Math.max(0, clampedCursor - VISIBLE_ITEMS + 1);
  const visibleSlice = displayList.slice(scrollOffset, scrollOffset + VISIBLE_ITEMS);
  const hasMore = scrollOffset + VISIBLE_ITEMS < displayList.length;
  const hasLess = scrollOffset > 0;

  // ── Key handling ────────────────────────────────────────────────

  useInput((input, key) => {
    // ── Confirm-remove mode ──
    if (mode === "confirm-remove") {
      if (input === "y" || input === "Y") {
        handleRemove(confirmTarget!);
        setMode("browse");
        setConfirmTarget(null);
        return;
      }
      // Any other key cancels
      setMode("browse");
      setConfirmTarget(null);
      return;
    }

    // ── Add mode ──
    if (mode === "add") {
      if (key.escape) {
        setMode("browse");
        setAddText("");
        return;
      }
      if (key.return) {
        if (addText.trim()) {
          handleAdd(addText.trim());
        }
        setMode("browse");
        setAddText("");
        return;
      }
      if (key.backspace || key.delete) {
        setAddText((t) => t.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
        setAddText((t) => t + input);
      }
      return;
    }

    // ── Browse mode ──

    // Tab switching
    if (key.leftArrow) {
      setActiveTab((t) => (t > 0 ? t - 1 : TABS.length - 1));
      setCursor(0);
      setSearchQuery("");
      return;
    }
    if (key.rightArrow) {
      setActiveTab((t) => (t < TABS.length - 1 ? t + 1 : 0));
      setCursor(0);
      setSearchQuery("");
      return;
    }
    if (key.tab) {
      if (key.shift) {
        setActiveTab((t) => (t > 0 ? t - 1 : TABS.length - 1));
      } else {
        setActiveTab((t) => (t < TABS.length - 1 ? t + 1 : 0));
      }
      setCursor(0);
      setSearchQuery("");
      return;
    }

    // Navigation
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : displayList.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < displayList.length - 1 ? c + 1 : 0));
      return;
    }

    // Enter
    if (key.return) {
      if (clampedCursor === 0) {
        // "Add a new rule..."
        setMode("add");
        setAddText("");
      } else {
        // Existing rule — prompt for removal
        const item = displayList[clampedCursor];
        if (item) {
          setConfirmTarget(item);
          setMode("confirm-remove");
        }
      }
      return;
    }

    // Escape
    if (key.escape) {
      if (searchQuery) {
        setSearchQuery("");
        setCursor(0);
      } else {
        onClose();
      }
      return;
    }

    // Backspace in search
    if (key.backspace || key.delete) {
      if (searchQuery) {
        setSearchQuery((q) => q.slice(0, -1));
        setCursor(0);
      }
      return;
    }

    // Printable character — start/continue search
    if (input && !key.ctrl && !key.meta) {
      setSearchQuery((q) => q + input);
      setCursor(0);
      return;
    }
  });

  // ── Actions ─────────────────────────────────────────────────────

  const handleAdd = useCallback(async (pattern: string) => {
    if (activeTab === 0) {
      await saveProjectPermission(cwd, pattern);
    } else if (activeTab === 1) {
      await saveProjectDenyPermission(cwd, pattern);
    } else {
      // Workspace: default to allow
      await saveSharedProjectPermission(cwd, pattern);
    }
    await reload();
  }, [activeTab, cwd, reload]);

  const handleRemove = useCallback(async (item: string) => {
    if (activeTab === 0) {
      await removeProjectPermission(cwd, item, "allow");
    } else if (activeTab === 1) {
      await removeProjectPermission(cwd, item, "deny");
    } else {
      // Workspace: parse prefix
      if (item.startsWith("[allow] ")) {
        await removeSharedProjectPermission(cwd, item.slice(8), "allow");
      } else if (item.startsWith("[deny] ")) {
        await removeSharedProjectPermission(cwd, item.slice(7), "deny");
      }
    }
    await reload();
    setCursor((c) => Math.max(0, c - 1));
  }, [activeTab, cwd, reload]);

  // ── Render ──────────────────────────────────────────────────────

  const cols = process.stdout.columns || 80;
  const width = Math.min(cols - 4, 72);
  const innerWidth = width - 6; // border + padding

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      width={width}
    >
      {/* Title */}
      <Text>{chalk.bold.cyan("Permissions")}</Text>
      <Text>{chalk.dim("\u2500".repeat(innerWidth))}</Text>

      {/* Tabs */}
      <Box>
        {TABS.map((tab, i) => {
          const isActive = i === activeTab;
          const label = isActive ? chalk.bold.cyan(tab.label) : chalk.dim(tab.label);
          const sep = i < TABS.length - 1 ? "   " : "";
          return (
            <Text key={tab.label}>{label}{sep}</Text>
          );
        })}
        <Text>{chalk.dim("   (\u2190/\u2192 to switch)")}</Text>
      </Box>
      <Text>{""}</Text>

      {/* Tab description */}
      <Text>{chalk.dim(TABS[activeTab].description)}</Text>

      {/* Search box */}
      <Box borderStyle="round" borderColor={searchQuery ? "cyan" : "gray"} paddingX={1}>
        <Text>
          {chalk.dim("\u2315 ")}
          {searchQuery || chalk.dim("Search\u2026")}
        </Text>
      </Box>
      <Text>{""}</Text>

      {/* Add mode inline input */}
      {mode === "add" && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{chalk.cyan("  New rule: ")}{addText}{chalk.cyan("\u2588")}</Text>
          <Text>{chalk.dim("  Enter to save \u00B7 Esc to cancel")}</Text>
          <Text>{""}</Text>
        </Box>
      )}

      {/* Confirm-remove */}
      {mode === "confirm-remove" && confirmTarget && (
        <Box marginBottom={1}>
          <Text>{chalk.yellow(`  Remove "${confirmTarget}"? `)}(y/n)</Text>
        </Box>
      )}

      {/* List */}
      {hasLess && <Text>{chalk.dim("  \u2191 more")}</Text>}
      {visibleSlice.map((item, vi) => {
        const globalIdx = scrollOffset + vi;
        const isCurrent = globalIdx === clampedCursor;
        const isAddItem = globalIdx === 0;

        let prefix: string;
        let label: string;
        let number: string;

        if (isAddItem) {
          prefix = isCurrent ? chalk.cyan("\u276F") : " ";
          number = chalk.dim(`${globalIdx + 1}.`);
          label = isCurrent ? chalk.cyan.italic(item) : chalk.italic(item);
        } else {
          prefix = isCurrent ? chalk.cyan("\u276F") : " ";
          number = chalk.dim(`${globalIdx + 1}.`);
          if (activeTab === 0) {
            label = isCurrent ? chalk.cyan(item) : chalk.green(item);
          } else if (activeTab === 1) {
            label = isCurrent ? chalk.cyan(item) : chalk.red(item);
          } else {
            // Workspace items with [allow]/[deny] prefix
            if (item.startsWith("[allow]")) {
              label = isCurrent ? chalk.cyan(item) : chalk.green(item);
            } else {
              label = isCurrent ? chalk.cyan(item) : chalk.red(item);
            }
          }
        }

        return (
          <Text key={`${globalIdx}-${item}`}>{"  "}{prefix} {number}  {label}</Text>
        );
      })}
      {hasMore && <Text>{chalk.dim("  \u2193 more")}</Text>}

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <Text>{chalk.dim("  No rules configured.")}</Text>
      )}

      <Text>{""}</Text>

      {/* Help line */}
      <Text>
        {chalk.dim("  \u2191\u2193 navigate \u00B7 \u2190\u2192 tabs \u00B7 Enter select \u00B7 type to search \u00B7 Esc close")}
      </Text>
    </Box>
  );
}
