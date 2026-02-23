/**
 * ToolProgress — renders transient progress lines for active tools.
 */

import React from "react";
import { Text } from "ink";
import chalk from "chalk";

interface Props {
  progress: Map<string, string>;
}

export function ToolProgress({ progress }: Props): React.ReactElement | null {
  if (progress.size === 0) return null;

  const entries = Array.from(progress.entries());
  const cols = process.stdout.columns || 80;

  return (
    <Text>
      {entries.map(([_id, content], i) => {
        const truncated = content.length > cols - 4
          ? content.slice(0, cols - 7) + "..."
          : content;
        return chalk.dim(`  \u22EF ${truncated}`) + (i < entries.length - 1 ? "\n" : "");
      }).join("")}
    </Text>
  );
}
