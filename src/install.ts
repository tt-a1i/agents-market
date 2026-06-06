import { generateAgent, expandTargets } from "./adapters/index.js";
import { getAgentsForPack, getPack } from "./registry.js";
import type { AgentDefinition, GeneratedFile, Registry, Target } from "./types.js";

export interface GeneratedPackFile extends GeneratedFile {
  target: Target;
  agent: AgentDefinition;
}

export interface InstallPlan {
  packId: string;
  target: Target | "all";
  fileCount: number;
  agentCount: number;
  files: Array<{
    path: string;
    target: Target;
    agentId: string;
  }>;
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

export function createInstallPlan(registry: Registry, packId: string, target: Target | "all"): InstallPlan {
  const files = generatePackFiles(registry, packId, target);
  const agentIds = new Set(files.map((file) => file.agent.id));
  return {
    packId,
    target,
    fileCount: files.length,
    agentCount: agentIds.size,
    files: files.map((file) => ({
      path: file.path,
      target: file.target,
      agentId: file.agent.id
    }))
  };
}
