/**
 * AgentTree — shows running subagents spawned by the Task tool.
 *
 * ❯ ╒═ main: Thinking…  · 1.2k tokens  · shift + ↑/↓
 *   ├─ @researcher: Reading files…  · 3 tool uses · 450 tokens
 *   └─ @implementer: Idle for 5s
 */

import React from "react";
import { Text, Box } from "ink";
import chalk from "chalk";
import type { AgentInfo } from "../state.js";
import { icons, agentColor } from "../theme.js";

interface Props {
  agents: AgentInfo[];
  visible: boolean;
  selectedIndex?: number;
}

export function AgentTree({ agents, visible, selectedIndex = 0 }: Props): React.ReactElement | null {
  if (!visible || agents.length === 0) return null;

  const now = Date.now();

  return (
    <Box flexDirection="column" marginTop={1}>
      {agents.map((agent, i) => {
        const isLast = i === agents.length - 1;
        const isSelected = i === selectedIndex;
        const color = agentColor(i);

        // Tree connector
        let connector: string;
        if (isSelected) {
          connector = `${icons.pointer} \u2552\u2550`;
        } else if (isLast) {
          connector = `  \u2514\u2500`;
        } else {
          connector = `  \u251C\u2500`;
        }

        // Status text
        let statusText = agent.status || "Idle";
        const idleTime = Math.floor((now - agent.lastUpdate) / 1000);
        if (idleTime > 5 && !agent.status) {
          statusText = `Idle for ${idleTime}s`;
        }

        // Token display
        const tokenDisplay = agent.tokenCount >= 1000
          ? `${(agent.tokenCount / 1000).toFixed(1)}k`
          : String(agent.tokenCount);

        // Tool use count
        const toolInfo = agent.toolUseCount > 0
          ? ` \u00B7 ${agent.toolUseCount} tool use${agent.toolUseCount !== 1 ? "s" : ""}`
          : "";

        const desc = agent.description
          ? agent.description.slice(0, 40)
          : "subagent";

        return (
          <Text key={agent.toolUseId}>
            {connector} {color(`@${desc}`)}{chalk.dim(`: ${statusText}${toolInfo} \u00B7 ${tokenDisplay} tokens`)}
          </Text>
        );
      })}
    </Box>
  );
}
