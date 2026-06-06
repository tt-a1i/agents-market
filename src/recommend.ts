import type { PackDefinition, ProjectSignals, Registry } from "./types.js";

function scorePack(pack: PackDefinition, signals: ProjectSignals): number {
  let score = 0;
  for (const framework of pack.recommendedFor.frameworks ?? []) {
    if (signals.frameworks.includes(framework)) score += 4;
  }
  for (const language of pack.recommendedFor.languages ?? []) {
    if (signals.languages.includes(language)) score += 3;
  }
  for (const file of pack.recommendedFor.files ?? []) {
    if (signals.files.includes(file)) score += 2;
  }
  if (pack.id === "starter-dev-pack") score += 1;
  return score;
}

export function recommendPacks(registry: Registry, signals: ProjectSignals): PackDefinition[] {
  return registry.packs
    .map((pack) => ({ pack, score: scorePack(pack, signals) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.pack.id.localeCompare(b.pack.id))
    .map(({ pack }) => pack);
}
