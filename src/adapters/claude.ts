import type { AgentDefinition, GeneratedFile } from "../types.js";

function claudeTools(agent: AgentDefinition): string {
  const tools = agent.tools;
  if (!tools) return "Read, Grep, Glob";

  const allowed = ["Read", "Grep", "Glob"];
  if (tools.bash === "safe" || tools.bash === "full") allowed.push("Bash");
  if (tools.edit) allowed.push("Edit");
  if (tools.write) allowed.push("Write");
  if (tools.web) allowed.push("WebFetch", "WebSearch");
  return [...new Set(allowed)].join(", ");
}

export function generateClaudeAgent(agent: AgentDefinition): GeneratedFile {
  const model = agent.model?.claude ?? "inherit";
  const content = `---
name: ${agent.id}
description: ${agent.description}
tools: ${claudeTools(agent)}
model: ${model}
---

${agent.prompt}
`;

  return {
    path: `.claude/agents/${agent.id}.md`,
    content
  };
}
