import type { AgentDefinition, AgentContextReference, AgentRenderOptions, GeneratedFile } from "../types.js";

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

function contextBlock(references: AgentContextReference[] | undefined): string {
  if (!references || references.length === 0) return "";
  return [
    "Before acting, read and follow these project-local references:",
    ...references.map((reference) => `- ${reference.path}`),
    ""
  ].join("\n");
}

export function generateClaudeAgent(agent: AgentDefinition, options: AgentRenderOptions = {}): GeneratedFile {
  const model = agent.model?.claude ?? "inherit";
  const localName = options.localName ?? agent.id;
  const content = `---
name: ${localName}
description: ${agent.description}
tools: ${claudeTools(agent)}
model: ${model}
---

${contextBlock(options.contextReferences)}
${agent.prompt}
`;

  return {
    path: `.claude/agents/${localName}.md`,
    content
  };
}
