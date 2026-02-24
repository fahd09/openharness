/**
 * SessionSelector — interactive session picker with arrow-key navigation.
 *
 * Rendered during "session-select" phase. Uses useInput for keyboard
 * handling: up/down arrows navigate, Enter selects, Esc cancels.
 * Shows a scrolling viewport of ~10 sessions at a time.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import type { SessionMetadata } from "../../core/session.js";

const VIEWPORT_SIZE = 10;

interface SessionSelectorProps {
  sessions: SessionMetadata[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

export function SessionSelector({ sessions, onSelect, onCancel }: SessionSelectorProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (sessions.length > 0) {
        onSelect(sessions[cursor].id);
      }
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(sessions.length - 1, c + 1));
      return;
    }
  }, { isActive: true });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>{chalk.dim("No saved sessions.")}</Text>
      </Box>
    );
  }

  // Compute viewport window
  const half = Math.floor(VIEWPORT_SIZE / 2);
  let start = Math.max(0, cursor - half);
  let end = start + VIEWPORT_SIZE;
  if (end > sessions.length) {
    end = sessions.length;
    start = Math.max(0, end - VIEWPORT_SIZE);
  }
  const visible = sessions.slice(start, end);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{chalk.dim("Select a session to resume (\u2191\u2193 navigate, Enter select, Esc cancel)")}</Text>
      <Text>{""}</Text>
      {start > 0 && (
        <Text>{chalk.dim(`  \u2191 ${start} more above`)}</Text>
      )}
      {visible.map((s, i) => {
        const idx = start + i;
        const isSelected = idx === cursor;
        const title = s.customTitle || s.title;
        const date = s.updatedAt.slice(0, 10);
        const source = s.source === "claude-code" ? chalk.dim(" [cc]") : "";
        const line = `${title}  ${chalk.dim(date)}  ${chalk.dim(`${s.messageCount} msgs`)}${source}`;

        if (isSelected) {
          return (
            <Text key={s.id}>{"  "}{chalk.bgBlue.white(`\u276f ${line}`)}</Text>
          );
        }
        return (
          <Text key={s.id}>{"    "}{chalk.dim(line)}</Text>
        );
      })}
      {end < sessions.length && (
        <Text>{chalk.dim(`  \u2193 ${sessions.length - end} more below`)}</Text>
      )}
    </Box>
  );
}
