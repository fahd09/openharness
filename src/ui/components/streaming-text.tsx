/**
 * StreamingText — renders live streaming markdown output.
 *
 * Shows only the last N lines (based on terminal height) so the live region
 * stays compact and the input box remains fixed at the bottom.
 * All lines are preserved in state for freezing to Static on completion.
 */

import React from "react";
import { Text } from "ink";

interface Props {
  lines: string[];
  maxVisible?: number;
}

export function StreamingText({ lines, maxVisible }: Props): React.ReactElement | null {
  if (lines.length === 0) return null;

  // Keep the live region compact: show at most half the terminal height
  const termHeight = process.stdout.rows || 24;
  const limit = maxVisible ?? Math.max(Math.floor(termHeight / 2), 6);

  const visibleLines = lines.length > limit
    ? lines.slice(-limit)
    : lines;

  return <Text>{visibleLines.join("")}</Text>;
}
