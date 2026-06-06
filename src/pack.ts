import { packSchema } from "./schema.js";
import type { PackDefinition, Registry } from "./types.js";

export interface ComposePackOptions {
  id: string;
  agents: string[];
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
  frameworks?: string[];
  languages?: string[];
  files?: string[];
}

export function composePack(registry: Registry, options: ComposePackOptions): PackDefinition {
  const knownAgents = new Set(registry.agents.map((agent) => agent.id));
  const agents = unique(options.agents.map((agent) => slug(agent)));
  if (agents.length === 0) {
    throw new Error("At least one agent is required.");
  }
  const missing = agents.filter((agent) => !knownAgents.has(agent));
  if (missing.length > 0) {
    throw new Error(`Unknown agents: ${missing.join(", ")}`);
  }

  return packSchema.parse({
    id: slug(options.id),
    name: options.name ?? humanize(options.id),
    description: options.description ?? `Custom pack containing ${agents.length} selected agents.`,
    version: options.version ?? "0.1.0",
    tags: options.tags ?? ["custom"],
    agents,
    recommendedFor: {
      frameworks: options.frameworks,
      languages: options.languages,
      files: options.files
    }
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function slug(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanize(id: string): string {
  return slug(id)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
