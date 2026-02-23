/**
 * ThinkingBlock — renders thinking text with dim styling and indicator.
 */

import React from "react";
import { Text } from "ink";
import chalk from "chalk";

interface Props {
  text: string;
  isActive: boolean;
}

export function ThinkingBlock({ text, isActive }: Props): React.ReactElement | null {
  if (!text) return null;

  return (
    <Text>
      {chalk.dim("\n\uD83D\uDCAD ")}
      {chalk.dim(text)}
      {!isActive && chalk.dim("\n\u273B Thinking complete")}
    </Text>
  );
}
