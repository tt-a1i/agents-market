import type { AgentDefinition, GeneratedFile } from "../types.js";

function permissionBlock(agent: AgentDefinition): string {
  if (agent.permission === "readonly") {
    return `permission:
  edit: deny
  write: deny
  bash: deny`;
  }
  if (agent.permission === "safe-write") {
    return `permission:
  edit: ask
  write: ask
  bash: ask`;
  }
  return `permission:
  edit: ask
  write: ask
  bash: ask`;
}

export function generateOpenCodeAgent(agent: AgentDefinition): GeneratedFile {
  const model = agent.model?.opencode ?? "anthropic/claude-sonnet-4-5";
  const content = `---
description: ${agent.description}
mode: subagent
model: ${model}
${permissionBlock(agent)}
---

${agent.prompt}
`;

  return {
    path: `.opencode/agents/${agent.id}.md`,
    content
  };
}
