import { generateAgent, expandTargets } from "./adapters/index.js";
import { getAgentsForPack, getPack } from "./registry.js";
import type { GeneratedFile, Registry, Target } from "./types.js";

export function generatePackFiles(registry: Registry, packId: string, target: Target | "all"): GeneratedFile[] {
  const pack = getPack(registry, packId);
  const agents = getAgentsForPack(registry, pack);
  const targets = expandTargets(target);

  return agents.flatMap((agent) => targets.map((currentTarget) => generateAgent(agent, currentTarget)));
}
