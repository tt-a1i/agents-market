import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { checkPackPolicy, createPolicyPreset, loadPolicy, policyPath, savePolicy } from "../src/policy.js";
import { loadRegistry } from "../src/registry.js";

let cleanupPath: string | undefined;

afterEach(async () => {
  if (cleanupPath) {
    await rm(cleanupPath, { recursive: true, force: true });
    cleanupPath = undefined;
  }
});

describe("policy", () => {
  it("creates, saves, and loads a balanced project policy", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-policy-"));
    const path = policyPath(cleanupPath);
    const policy = createPolicyPreset("balanced");

    await savePolicy(path, policy);
    await expect(loadPolicy(path)).resolves.toEqual(policy);
  });

  it("allows the starter pack under the balanced preset", async () => {
    const registry = await loadRegistry();
    const report = checkPackPolicy(registry, "starter-dev-pack", "all", createPolicyPreset("balanced"));

    expect(report.ok).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it("rejects command and web agents under the strict preset", async () => {
    const registry = await loadRegistry();
    const report = checkPackPolicy(registry, "starter-dev-pack", "all", createPolicyPreset("strict"));

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("permission-exceeds-policy");
    expect(report.findings.map((finding) => finding.code)).toContain("web-not-allowed");
  });

  it("rejects blocked packs and blocked agents", async () => {
    const registry = await loadRegistry();
    const policy = {
      ...createPolicyPreset("balanced"),
      blockedPacks: ["starter-dev-pack"],
      blockedAgents: ["code-reviewer"]
    };
    const report = checkPackPolicy(registry, "starter-dev-pack", "claude", policy);

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("blocked-pack");
    expect(report.findings.map((finding) => finding.code)).toContain("blocked-agent");
  });
});
