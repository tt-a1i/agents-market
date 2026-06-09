import { generateClaudeAgent } from "./claude.js";
import { generateCodexAgent } from "./codex.js";
import { generateOpenCodeAgent } from "./opencode.js";
import type { AgentDefinition, AgentRenderOptions, GeneratedFile, Target } from "../types.js";

export function generateAgent(agent: AgentDefinition, target: Target, options: AgentRenderOptions = {}): GeneratedFile {
  if (target === "claude") return generateClaudeAgent(agent, options);
  if (target === "codex") return generateCodexAgent(agent, options);
  return generateOpenCodeAgent(agent, options);
}

export function expandTargets(target: Target | "all"): Target[] {
  if (target === "all") return ["claude", "codex", "opencode"];
  return [target];
}
