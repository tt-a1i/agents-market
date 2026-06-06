import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { registryRoot } from "./paths.js";
import { agentSchema, packSchema } from "./schema.js";
import type { AgentDefinition, PackDefinition, Registry } from "./types.js";

async function readJsonFiles<T>(dir: string, parse: (value: unknown) => T): Promise<T[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const values: T[] = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf8");
    values.push(parse(JSON.parse(raw)));
  }
  return values;
}

export async function loadRegistry(root = registryRoot()): Promise<Registry> {
  const agents = await readJsonFiles<AgentDefinition>(join(root, "agents"), (value) =>
    agentSchema.parse(value)
  );
  const packs = await readJsonFiles<PackDefinition>(join(root, "packs"), (value) =>
    packSchema.parse(value)
  );

  const knownAgents = new Set(agents.map((agent) => agent.id));
  for (const pack of packs) {
    const missing = pack.agents.filter((id) => !knownAgents.has(id));
    if (missing.length > 0) {
      throw new Error(`Pack ${pack.id} references missing agents: ${missing.join(", ")}`);
    }
  }

  return { agents, packs };
}

export function getPack(registry: Registry, id: string): PackDefinition {
  const pack = registry.packs.find((candidate) => candidate.id === id);
  if (!pack) {
    throw new Error(`Unknown pack: ${id}`);
  }
  return pack;
}

export function getAgentsForPack(registry: Registry, pack: PackDefinition): AgentDefinition[] {
  return pack.agents.map((id) => {
    const agent = registry.agents.find((candidate) => candidate.id === id);
    if (!agent) {
      throw new Error(`Pack ${pack.id} references missing agent: ${id}`);
    }
    return agent;
  });
}
