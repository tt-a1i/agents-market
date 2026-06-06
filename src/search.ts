import type { AgentDefinition, PackDefinition, Registry, Target } from "./types.js";

export type SearchKind = "all" | "agents" | "packs";

export interface SearchOptions {
  query?: string;
  kind?: SearchKind;
  target?: Target;
  tag?: string;
  category?: string;
  limit?: number;
}

export type SearchResult =
  | {
      kind: "agent";
      id: string;
      name: string;
      description: string;
      score: number;
      reasons: string[];
      agent: AgentDefinition;
    }
  | {
      kind: "pack";
      id: string;
      name: string;
      description: string;
      score: number;
      reasons: string[];
      pack: PackDefinition;
    };

export function searchRegistry(registry: Registry, options: SearchOptions): SearchResult[] {
  const kind = options.kind ?? "all";
  const queryTerms = tokenize(options.query);
  const limit = options.limit && options.limit > 0 ? options.limit : 20;
  const results: SearchResult[] = [];

  if (kind === "all" || kind === "packs") {
    for (const pack of registry.packs) {
      const result = scorePack(pack, registry, queryTerms, options);
      if (result) results.push(result);
    }
  }

  if (kind === "all" || kind === "agents") {
    for (const agent of registry.agents) {
      const result = scoreAgent(agent, queryTerms, options);
      if (result) results.push(result);
    }
  }

  return results.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).slice(0, limit);
}

function scorePack(
  pack: PackDefinition,
  registry: Registry,
  queryTerms: string[],
  options: SearchOptions
): SearchResult | undefined {
  if (options.tag && !hasValue(pack.tags, options.tag)) return undefined;

  const packAgents = pack.agents
    .map((id) => registry.agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentDefinition => Boolean(agent));
  if (options.target && !packAgents.some((agent) => agent.recommendedTargets.includes(options.target!))) return undefined;
  if (options.category && !packAgents.some((agent) => same(agent.category, options.category!))) return undefined;

  const haystack = [
    pack.id,
    pack.name,
    pack.description,
    ...pack.tags,
    ...pack.agents,
    ...packAgents.flatMap((agent) => [agent.category, ...agent.tags])
  ];
  const scored = scoreText(haystack, queryTerms);
  if (!scored && queryTerms.length > 0) return undefined;

  const reasons = [...(scored?.reasons ?? [])];
  let score = scored?.score ?? 1;
  if (options.target) {
    score += 2;
    reasons.push(`target:${options.target}`);
  }
  if (options.category) {
    score += 2;
    reasons.push(`category:${options.category}`);
  }
  if (options.tag) {
    score += 2;
    reasons.push(`tag:${options.tag}`);
  }

  return {
    kind: "pack",
    id: pack.id,
    name: pack.name,
    description: pack.description,
    score,
    reasons,
    pack
  };
}

function scoreAgent(agent: AgentDefinition, queryTerms: string[], options: SearchOptions): SearchResult | undefined {
  if (options.target && !agent.recommendedTargets.includes(options.target)) return undefined;
  if (options.category && !same(agent.category, options.category)) return undefined;
  if (options.tag && !hasValue(agent.tags, options.tag)) return undefined;

  const haystack = [agent.id, agent.name, agent.description, agent.category, agent.permission, ...agent.tags, agent.prompt.slice(0, 500)];
  const scored = scoreText(haystack, queryTerms);
  if (!scored && queryTerms.length > 0) return undefined;

  const reasons = [...(scored?.reasons ?? [])];
  let score = scored?.score ?? 1;
  if (options.target) {
    score += 2;
    reasons.push(`target:${options.target}`);
  }
  if (options.category) {
    score += 2;
    reasons.push(`category:${options.category}`);
  }
  if (options.tag) {
    score += 2;
    reasons.push(`tag:${options.tag}`);
  }

  return {
    kind: "agent",
    id: agent.id,
    name: agent.name,
    description: agent.description,
    score,
    reasons,
    agent
  };
}

function scoreText(values: string[], terms: string[]): { score: number; reasons: string[] } | undefined {
  if (terms.length === 0) return undefined;
  let score = 0;
  const reasons: string[] = [];
  const fields = values.map((value) => value.toLowerCase());

  for (const term of terms) {
    let matched = false;
    for (const field of fields) {
      if (field === term) {
        score += 6;
        matched = true;
        break;
      }
      if (field.split(/[^a-z0-9]+/).includes(term)) {
        score += 4;
        matched = true;
        break;
      }
      if (field.includes(term)) {
        score += 2;
        matched = true;
        break;
      }
    }
    if (matched) reasons.push(`query:${term}`);
  }

  return reasons.length === terms.length ? { score, reasons } : undefined;
}

function tokenize(query?: string): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function hasValue(values: string[], expected: string): boolean {
  return values.some((value) => same(value, expected));
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
