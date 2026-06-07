import { resolveTier } from "./tier.js";
import type { PackDefinition, ProjectSignals, Registry, RegistryTier } from "./types.js";

export interface PackRecommendation {
  pack: PackDefinition;
  tier: RegistryTier;
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
  return { pack, tier: resolveTier(pack), score, reasons };
}

export function recommendPacks(registry: Registry, signals: ProjectSignals): PackDefinition[] {
  return recommendPackDetails(registry, signals).map((recommendation) => recommendation.pack);
}

export function recommendPackDetails(registry: Registry, signals: ProjectSignals): PackRecommendation[] {
  // Core packs always rank above community packs: recommendations are an endorsement,
  // and `apply` without a pack id auto-selects the top entry.
  return registry.packs
    .map((pack) => scorePack(pack, signals))
    .filter(({ score }) => score > 0)
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.score - a.score || a.pack.id.localeCompare(b.pack.id));
}

function tierRank(tier: RegistryTier): number {
  return tier === "core" ? 0 : 1;
}
