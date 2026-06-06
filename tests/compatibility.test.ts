import { describe, expect, it } from "vitest";
import { checkPackCompatibility } from "../src/compatibility.js";
import type { PackDefinition } from "../src/types.js";

const basePack: PackDefinition = {
  id: "example-pack",
  name: "Example Pack",
  description: "Example pack for compatibility testing.",
  version: "0.1.0",
  tags: ["example"],
  agents: ["example-agent"],
  recommendedFor: {}
};

describe("pack compatibility", () => {
  it("passes when the CLI satisfies the pack requirement", () => {
    const report = checkPackCompatibility({ ...basePack, requires: { agentsMarket: ">=0.1.0" } }, "0.2.0");
    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("blocks when the pack requires a newer CLI", () => {
    const report = checkPackCompatibility({ ...basePack, requires: { agentsMarket: ">=9.0.0" } }, "0.2.0");
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe("agents-market-version-not-supported");
  });
});
