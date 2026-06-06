import { generateClaudeAgent } from "./claude.js";
import { generateCodexAgent } from "./codex.js";
import { generateOpenCodeAgent } from "./opencode.js";
import type { AgentDefinition, GeneratedFile, Target } from "../types.js";

export function generateAgent(agent: AgentDefinition, target: Target): GeneratedFile {
  if (target === "claude") return generateClaudeAgent(agent);
  if (target === "codex") return generateCodexAgent(agent);
  return generateOpenCodeAgent(agent);
}

export function expandTargets(target: Target | "all"): Target[] {
  if (target === "all") return ["claude", "codex", "opencode"];
  return [target];
}
