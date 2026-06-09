import type { AgentDefinition, AgentContextReference, AgentRenderOptions, GeneratedFile } from "../types.js";

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

function contextBlock(references: AgentContextReference[] | undefined): string {
  if (!references || references.length === 0) return "";
  return [
    "Before acting, read and follow these project-local references:",
    ...references.map((reference) => `- ${reference.path}`),
    ""
  ].join("\n");
}

export function generateOpenCodeAgent(agent: AgentDefinition, options: AgentRenderOptions = {}): GeneratedFile {
  const localName = options.localName ?? agent.id;
  const model = agent.model?.opencode ?? "anthropic/claude-sonnet-4-5";
  const content = `---
description: ${agent.description}
mode: subagent
model: ${model}
${permissionBlock(agent)}
---

${contextBlock(options.contextReferences)}
${agent.prompt}
`;

  return {
    path: `.opencode/agents/${localName}.md`,
    content
  };
}
