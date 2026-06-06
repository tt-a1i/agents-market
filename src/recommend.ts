import type { PackDefinition, ProjectSignals, Registry } from "./types.js";

export interface PackRecommendation {
  pack: PackDefinition;
  score: number;
  reasons: string[];
}

function scorePack(pack: PackDefinition, signals: ProjectSignals): PackRecommendation {
  let score = 0;
  const reasons: string[] = [];
  for (const framework of pack.recommendedFor.frameworks ?? []) {
    if (signals.frameworks.includes(framework)) {
      score += 4;
      reasons.push(`framework:${framework}`);
    }
  }
  for (const language of pack.recommendedFor.languages ?? []) {
    if (signals.languages.includes(language)) {
      score += 3;
      reasons.push(`language:${language}`);
    }
  }
  for (const file of pack.recommendedFor.files ?? []) {
    if (signals.files.includes(file)) {
      score += 2;
      reasons.push(`file:${file}`);
    }
  }
  if (pack.id === "starter-dev-pack") {
    score += 1;
    reasons.push("baseline");
  }
  return { pack, score, reasons };
}

export function recommendPacks(registry: Registry, signals: ProjectSignals): PackDefinition[] {
  return recommendPackDetails(registry, signals).map((recommendation) => recommendation.pack);
}

export function recommendPackDetails(registry: Registry, signals: ProjectSignals): PackRecommendation[] {
  return registry.packs
    .map((pack) => scorePack(pack, signals))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.pack.id.localeCompare(b.pack.id))
}
