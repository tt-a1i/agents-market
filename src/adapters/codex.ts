import type { AgentDefinition, AgentContextReference, AgentRenderOptions, GeneratedFile } from "../types.js";

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sandboxMode(agent: AgentDefinition): string {
  if (agent.permission === "readonly") return "read-only";
  return "workspace-write";
}

function reasoningEffort(agent: AgentDefinition): string {
  if (agent.category === "review" || agent.category === "architecture") return "high";
  return "medium";
}

function contextBlock(references: AgentContextReference[] | undefined): string {
  if (!references || references.length === 0) return "";
  return [
    "Before acting, read and follow these project-local references:",
    ...references.map((reference) => `- ${reference.path}`),
    ""
  ].join("\n");
}

export function generateCodexAgent(agent: AgentDefinition, options: AgentRenderOptions = {}): GeneratedFile {
  const localName = options.localName ?? agent.id;
  const nicknames = [
    `${agent.name.replace(/\s+/g, "")}`,
    `${localName}-agent`,
    `${localName}-worker`
  ];
  const content = `name = "${escapeTomlString(localName)}"
description = "${escapeTomlString(agent.description)}"
developer_instructions = """
${contextBlock(options.contextReferences)}
${agent.prompt.replace(/"""/g, '\\"\\"\\"')}
"""
model = "${escapeTomlString(agent.model?.codex ?? "gpt-5.5")}"
model_reasoning_effort = "${reasoningEffort(agent)}"
sandbox_mode = "${sandboxMode(agent)}"
nickname_candidates = [${nicknames.map((name) => `"${escapeTomlString(name)}"`).join(", ")}]
`;

  return {
    path: `.codex/agents/${localName}.toml`,
    content
  };
}
