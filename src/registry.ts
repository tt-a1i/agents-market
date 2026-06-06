import { stat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { registryRoot } from "./paths.js";
import { agentSchema, changelogEntrySchema, packSchema, registryBundleSchema } from "./schema.js";
import { sha256 } from "./hash.js";
import type { AgentDefinition, PackDefinition, Registry, RegistryBundle, RegistryLock } from "./types.js";

export interface LoadedRegistry {
  registry: Registry;
  source: {
    kind: "bundled" | "directory" | "file" | "url";
    value: string;
    version?: string;
    sha256?: string;
  };
}

export interface RegistrySummary {
  source: LoadedRegistry["source"];
  packCount: number;
  agentCount: number;
  packs: Array<{
    id: string;
    name: string;
    version: string;
    agentCount: number;
    tags: string[];
  }>;
  changelog: {
    count: number;
    latest?: {
      version: string;
      date: string;
      summary: string;
    };
  };
  targets: Record<"claude" | "codex" | "opencode", number>;
}

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
  const changelog = await readChangelog(root);

  const knownAgents = new Set(agents.map((agent) => agent.id));
  for (const pack of packs) {
    const missing = pack.agents.filter((id) => !knownAgents.has(id));
    if (missing.length > 0) {
      throw new Error(`Pack ${pack.id} references missing agents: ${missing.join(", ")}`);
    }
  }

  return { agents, packs, changelog };
}

export function validateRegistry(registry: Registry): Registry {
  const knownAgents = new Set(registry.agents.map((agent) => agent.id));
  for (const pack of registry.packs) {
    const missing = pack.agents.filter((id) => !knownAgents.has(id));
    if (missing.length > 0) {
      throw new Error(`Pack ${pack.id} references missing agents: ${missing.join(", ")}`);
    }
  }
  return registry;
}

async function loadRegistryBundleFromFile(path: string): Promise<RegistryBundle> {
  const raw = await readFile(path, "utf8");
  const parsed = registryBundleSchema.parse(JSON.parse(raw));
  if (parsed.sha256 && registryBundleHash(parsed) !== parsed.sha256) {
    throw new Error(`Registry bundle checksum mismatch: ${path}`);
  }
  validateRegistry(parsed);
  return parsed;
}

async function loadRegistryBundleFromUrl(url: string): Promise<RegistryBundle> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch registry bundle ${url}: ${response.status} ${response.statusText}`);
  }
  const raw = await response.text();
  const parsed = registryBundleSchema.parse(JSON.parse(raw));
  if (parsed.sha256 && registryBundleHash(parsed) !== parsed.sha256) {
    throw new Error(`Registry bundle checksum mismatch: ${url}`);
  }
  validateRegistry(parsed);
  return parsed;
}

export async function loadRegistryFromSource(source?: string): Promise<Registry> {
  return (await loadRegistryWithInfo(source)).registry;
}

export async function loadRegistryWithInfo(source?: string): Promise<LoadedRegistry> {
  if (!source || source === "bundled") {
    return {
      registry: await loadRegistry(),
      source: { kind: "bundled", value: "bundled" }
    };
  }
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const bundle = await loadRegistryBundleFromUrl(source);
    return {
      registry: bundle,
      source: { kind: "url", value: source, version: bundle.version, sha256: bundle.sha256 }
    };
  }

  const path = isAbsolute(source) ? source : resolve(process.cwd(), source);
  const info = await stat(path);
  if (info.isDirectory()) {
    return {
      registry: await loadRegistry(path),
      source: { kind: "directory", value: path }
    };
  }
  const bundle = await loadRegistryBundleFromFile(path);
  return {
    registry: bundle,
    source: { kind: "file", value: path, version: bundle.version, sha256: bundle.sha256 }
  };
}

export function summarizeRegistry(loaded: LoadedRegistry): RegistrySummary {
  const targets: RegistrySummary["targets"] = {
    claude: 0,
    codex: 0,
    opencode: 0
  };
  for (const agent of loaded.registry.agents) {
    for (const target of agent.recommendedTargets) {
      targets[target] += 1;
    }
  }
  return {
    source: loaded.source,
    packCount: loaded.registry.packs.length,
    agentCount: loaded.registry.agents.length,
    packs: loaded.registry.packs.map((pack) => ({
      id: pack.id,
      name: pack.name,
      version: pack.version,
      agentCount: pack.agents.length,
      tags: pack.tags
    })),
    changelog: {
      count: loaded.registry.changelog?.length ?? 0,
      latest: loaded.registry.changelog?.[0]
        ? {
            version: loaded.registry.changelog[0].version,
            date: loaded.registry.changelog[0].date,
            summary: loaded.registry.changelog[0].summary
          }
        : undefined
    },
    targets
  };
}

export function createRegistryBundle(registry: Registry, version: string, name = "agents-market"): RegistryBundle {
  const bundleWithoutHash = {
    schemaVersion: 1 as const,
    name,
    version,
    exportedAt: new Date().toISOString(),
    agents: registry.agents,
    packs: registry.packs,
    changelog: registry.changelog
  };
  return {
    ...bundleWithoutHash,
    sha256: registryBundleHash(bundleWithoutHash)
  };
}

export function verifyRegistryLock(loaded: LoadedRegistry, lock: RegistryLock): void {
  if (loaded.source.value !== lock.source) {
    throw new Error(`Registry lock source mismatch: expected ${lock.source}, loaded ${loaded.source.value}`);
  }
  if (lock.version && loaded.source.version && loaded.source.version !== lock.version) {
    throw new Error(`Registry lock version mismatch: expected ${lock.version}, loaded ${loaded.source.version}`);
  }
  if (lock.sha256 && loaded.source.sha256 !== lock.sha256) {
    throw new Error(
      `Registry lock checksum mismatch: expected ${lock.sha256}, loaded ${loaded.source.sha256 ?? "none"}`
    );
  }
}

function registryBundleHash(bundle: Omit<RegistryBundle, "sha256">): string {
  return sha256(
    JSON.stringify({
      schemaVersion: bundle.schemaVersion,
      name: bundle.name,
      version: bundle.version,
      exportedAt: bundle.exportedAt,
      agents: bundle.agents,
      packs: bundle.packs,
      changelog: bundle.changelog
    })
  );
}

async function readChangelog(root: string): Promise<Registry["changelog"]> {
  try {
    const raw = await readFile(join(root, "changelog.json"), "utf8");
    return changelogEntrySchema.array().parse(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
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
