import type { AgentDefinition, GeneratedFile } from "../types.js";

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

export function generateCodexAgent(agent: AgentDefinition): GeneratedFile {
  const nicknames = [
    `${agent.name.replace(/\s+/g, "")}`,
    `${agent.id}-agent`,
    `${agent.id}-worker`
  ];
  const content = `name = "${escapeTomlString(agent.id)}"
description = "${escapeTomlString(agent.description)}"
developer_instructions = """
${agent.prompt.replace(/"""/g, '\\"\\"\\"')}
"""
model = "${escapeTomlString(agent.model?.codex ?? "gpt-5.5")}"
model_reasoning_effort = "${reasoningEffort(agent)}"
sandbox_mode = "${sandboxMode(agent)}"
nickname_candidates = [${nicknames.map((name) => `"${escapeTomlString(name)}"`).join(", ")}]
`;

  return {
    path: `.codex/agents/${agent.id}.toml`,
    content
  };
}
