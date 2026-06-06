import { satisfiesVersionRange } from "./version.js";
import type { PackDefinition } from "./types.js";

export interface CompatibilityFinding {
  severity: "error" | "warning";
  code: string;
  subject: string;
  message: string;
}

export interface PackCompatibilityReport {
  ok: boolean;
  packId: string;
  cliVersion: string;
  requirements: PackDefinition["requires"];
  findings: CompatibilityFinding[];
}

export function checkPackCompatibility(pack: PackDefinition, cliVersion: string): PackCompatibilityReport {
  const findings: CompatibilityFinding[] = [];
  const agentsMarketRange = pack.requires?.agentsMarket;
  const satisfies = satisfiesVersionRange(cliVersion, agentsMarketRange);

  if (satisfies === false) {
    findings.push({
      severity: "error",
      code: "agents-market-version-not-supported",
      subject: `pack:${pack.id}`,
      message: `Pack requires Agents Market ${agentsMarketRange}, but current CLI version is ${cliVersion}.`
    });
  } else if (satisfies === undefined) {
    findings.push({
      severity: "error",
      code: "invalid-agents-market-version-range",
      subject: `pack:${pack.id}`,
      message: `Pack declares an invalid Agents Market version requirement: ${agentsMarketRange}.`
    });
  }

  return {
    ok: findings.every((finding) => finding.severity !== "error"),
    packId: pack.id,
    cliVersion,
    requirements: pack.requires,
    findings
  };
}
