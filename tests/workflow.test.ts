import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createPolicyPreset } from "../src/policy.js";
import { loadRegistry } from "../src/registry.js";
import { defaultApplyPolicy, runApplyWorkflow } from "../src/workflow.js";

let cleanupPath: string | undefined;

afterEach(async () => {
  if (cleanupPath) {
    await rm(cleanupPath, { recursive: true, force: true });
    cleanupPath = undefined;
  }
});

describe("apply workflow", () => {
  it("previews the recommended pack without writing files", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-apply-"));

    const result = await runApplyWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { value: "bundled" },
      target: "claude",
      mode: "preview",
      policy: defaultApplyPolicy(),
      policySource: "preset",
      policyCommandArg: " --policy-preset balanced"
    });

    expect(result.installed).toBe(false);
    expect(result.pack.id).toBe("starter-dev-pack");
    expect(result.pack.explicit).toBe(false);
    expect(result.policy?.ok).toBe(true);
    expect(result.changes.length).toBe(4);
    expect(result.changes.every((change) => change.state === "create")).toBe(true);
    await expect(readFile(join(cleanupPath, ".agents-market/manifest.json"), "utf8")).rejects.toThrow();
    expect(result.nextCommands[0]).toContain("agents-market apply starter-dev-pack --target claude --policy-preset balanced --yes");
  });

  it("blocks installation when policy rejects the selected pack", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-apply-blocked-"));

    const result = await runApplyWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { value: "bundled" },
      packId: "starter-dev-pack",
      target: "all",
      mode: "install",
      policy: createPolicyPreset("strict"),
      policySource: "preset",
      policyCommandArg: " --policy-preset strict"
    });

    expect(result.installed).toBe(false);
    expect(result.policy?.ok).toBe(false);
    expect(result.policy?.findings.map((finding) => finding.code)).toContain("permission-exceeds-policy");
    await expect(readFile(join(cleanupPath, ".agents-market/manifest.json"), "utf8")).rejects.toThrow();
  });

  it("installs after the workflow passes with explicit confirmation", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-apply-install-"));

    const result = await runApplyWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { value: "bundled" },
      packId: "starter-dev-pack",
      target: "claude",
      mode: "install",
      policy: defaultApplyPolicy(),
      policySource: "preset",
      policyCommandArg: " --policy-preset balanced"
    });

    expect(result.installed).toBe(true);
    const manifest = JSON.parse(await readFile(join(cleanupPath, ".agents-market/manifest.json"), "utf8")) as {
      installs: Array<{ packId: string; packVersion?: string; target: string; files: unknown[] }>;
    };
    expect(manifest.installs[0]?.packId).toBe("starter-dev-pack");
    expect(manifest.installs[0]?.packVersion).toBe("0.1.0");
    expect(manifest.installs[0]?.target).toBe("claude");
    expect(manifest.installs[0]?.files.length).toBe(4);
  });
});
