import { generateAgent, expandTargets } from "./adapters/index.js";
import { getAgentsForPack, getPack } from "./registry.js";
import type { AgentDefinition, GeneratedFile, Registry, Target } from "./types.js";

export interface GeneratedPackFile extends GeneratedFile {
  target: Target;
  agent: AgentDefinition;
}

export function generatePackFiles(registry: Registry, packId: string, target: Target | "all"): GeneratedPackFile[] {
  const pack = getPack(registry, packId);
  const agents = getAgentsForPack(registry, pack);
  const targets = expandTargets(target);

  return agents.flatMap((agent) =>
    targets.map((currentTarget) => ({
      ...generateAgent(agent, currentTarget),
      target: currentTarget,
      agent
    }))
  );
}
