import type { RegistryTier } from "./types.js";

// Missing tier = community: third-party registry content must opt into the curated core tier explicitly.
export function resolveTier(value: { tier?: RegistryTier }): RegistryTier {
  return value.tier ?? "community";
}

export function parseTier(value: string): RegistryTier | "all" {
  if (value === "core" || value === "community" || value === "all") return value;
  throw new Error(`Invalid tier: ${value}. Use core, community, or all.`);
}
