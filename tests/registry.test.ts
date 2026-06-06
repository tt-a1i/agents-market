import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRegistryBundle, loadRegistry, summarizeRegistry, verifyRegistryLock } from "../src/registry.js";
import { recommendPackDetails, recommendPacks } from "../src/recommend.js";
import { auditPack } from "../src/audit.js";
import { runDoctor } from "../src/doctor.js";
import { createInstallPlan, generatePackFiles } from "../src/install.js";
import { githubTreeUrl, parseGitHubRepository } from "../src/git-import.js";
import { saveManifest, saveRegistryLock, upsertInstall } from "../src/manifest.js";
import { composePack } from "../src/pack.js";
import { searchRegistry } from "../src/search.js";
import { writeGeneratedFiles } from "../src/files.js";
import { createPolicyPreset, savePolicy, policyPath } from "../src/policy.js";

describe("registry", () => {
  it("loads bundled agents and packs", async () => {
    const registry = await loadRegistry();
    expect(registry.agents.length).toBeGreaterThanOrEqual(7);
    expect(registry.packs.map((pack) => pack.id)).toContain("starter-dev-pack");
    expect(registry.changelog?.[0]?.version).toBe("0.1.0");
  });

  it("recommends Next.js pack for Next.js signals", async () => {
    const registry = await loadRegistry();
    const packs = recommendPacks(registry, {
      root: "/tmp/project",
      languages: ["typescript"],
      frameworks: ["nextjs", "react"],
      files: ["package.json", "next.config.mjs"]
    });
    expect(packs[0]?.id).toBe("nextjs-pack");
  });

  it("returns recommendation scores and reasons", async () => {
    const registry = await loadRegistry();
    const recommendations = recommendPackDetails(registry, {
      root: "/tmp/project",
      languages: ["typescript"],
      frameworks: ["nextjs", "react"],
      files: ["package.json", "next.config.mjs"]
    });
    expect(recommendations[0]?.pack.id).toBe("nextjs-pack");
    expect(recommendations[0]?.score).toBeGreaterThan(0);
    expect(recommendations[0]?.reasons).toContain("framework:nextjs");
  });

  it("creates install plans", async () => {
    const registry = await loadRegistry();
    const plan = createInstallPlan(registry, "starter-dev-pack", "all");
    expect(plan.agentCount).toBe(4);
    expect(plan.fileCount).toBe(12);
    expect(plan.files[0]).toHaveProperty("agentId");
  });

  it("composes custom packs from selected agents", async () => {
    const registry = await loadRegistry();
    const pack = composePack(registry, {
      id: "frontend-lite",
      agents: ["code-reviewer", "accessibility-auditor", "code-reviewer"],
      tags: ["custom", "frontend"],
      frameworks: ["react"],
      languages: ["typescript"]
    });
    expect(pack.id).toBe("frontend-lite");
    expect(pack.agents).toEqual(["code-reviewer", "accessibility-auditor"]);
    expect(pack.recommendedFor.frameworks).toEqual(["react"]);
    expect(pack.recommendedFor.languages).toEqual(["typescript"]);
  });

  it("rejects custom packs with unknown agents", async () => {
    const registry = await loadRegistry();
    expect(() => composePack(registry, { id: "bad-pack", agents: ["missing-agent"] })).toThrow(/Unknown agents/);
  });

  it("audits pack permissions and provenance", async () => {
    const registry = await loadRegistry();
    const audit = auditPack(registry, "frontend-pack", "all");
    expect(audit.agentCount).toBe(5);
    expect(audit.fileCount).toBe(15);
    expect(audit.permissions.readonly).toBeGreaterThan(0);
    expect(audit.tools.bashSafe).toBeGreaterThan(0);
    expect(audit.provenance.bundled).toBe(5);
    expect(audit.risk).toBe("high");
  });

  it("reports doctor health for empty and installed projects", async () => {
    const registry = await loadRegistry();
    const root = await mkdtemp(join(tmpdir(), "agents-market-doctor-"));
    try {
      const empty = await runDoctor(root);
      expect(empty.health).toBe("warning");
      expect(empty.installCount).toBe(0);

      const files = generatePackFiles(registry, "starter-dev-pack", "claude");
      await writeGeneratedFiles(root, files);
      await saveManifest(root, upsertInstall({ schemaVersion: 1, installs: [] }, "starter-dev-pack", "claude", files));

      const installed = await runDoctor(root);
      expect(installed.health).toBe("warning");
      expect(installed.installCount).toBe(1);
      expect(installed.fileCounts.clean).toBe(4);
      expect(installed.targets.claude).toBe(4);
      expect(installed.checks.some((check) => check.id === "registry-lock" && check.severity === "warn")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("checks installed packs against project policy in doctor", async () => {
    const registry = await loadRegistry();
    const root = await mkdtemp(join(tmpdir(), "agents-market-doctor-policy-"));
    try {
      const files = generatePackFiles(registry, "starter-dev-pack", "claude");
      await writeGeneratedFiles(root, files);
      await saveManifest(root, upsertInstall({ schemaVersion: 1, installs: [] }, "starter-dev-pack", "claude", files));
      await saveRegistryLock(root, { schemaVersion: 1, source: "bundled", lockedAt: "2026-01-01T00:00:00.000Z" });

      await savePolicy(policyPath(root), createPolicyPreset("balanced"));
      const balanced = await runDoctor(root);
      expect(balanced.health).toBe("ok");
      expect(balanced.policyChecks?.[0]?.ok).toBe(true);
      expect(balanced.checks.some((check) => check.id === "policy-installed-packs" && check.severity === "pass")).toBe(true);

      await savePolicy(policyPath(root), createPolicyPreset("strict"));
      const strict = await runDoctor(root);
      expect(strict.health).toBe("error");
      expect(strict.policyChecks?.[0]?.ok).toBe(false);
      expect(strict.policyChecks?.[0]?.findings.map((finding) => finding.code)).toContain("permission-exceeds-policy");
      expect(strict.checks.some((check) => check.id === "policy-installed-packs" && check.severity === "error")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("searches marketplace packs and agents", async () => {
    const registry = await loadRegistry();
    const results = searchRegistry(registry, { query: "accessibility", target: "claude" });
    expect(results.some((result) => result.id === "accessibility-auditor")).toBe(true);
    expect(results.some((result) => result.kind === "pack" && result.id === "frontend-pack")).toBe(true);
    expect(results.every((result) => result.reasons.length > 0)).toBe(true);
  });

  it("filters marketplace search by kind and category", async () => {
    const registry = await loadRegistry();
    const results = searchRegistry(registry, { kind: "agents", category: "frontend" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.kind === "agent")).toBe(true);
    expect(results.every((result) => result.kind === "agent" && result.agent.category === "frontend")).toBe(true);
  });

  it("parses GitHub repositories for import", () => {
    const repo = parseGitHubRepository("owner/example-agents");
    expect(repo.repository).toBe("owner/example-agents");
    expect(repo.cloneUrl).toBe("https://github.com/owner/example-agents.git");
    expect(githubTreeUrl(repo, "main", "agents/claude")).toBe(
      "https://github.com/owner/example-agents/tree/main/agents/claude"
    );

    const urlRepo = parseGitHubRepository("https://github.com/acme/templates.git");
    expect(urlRepo.repository).toBe("acme/templates");
  });

  it("creates and parses portable registry bundles", async () => {
    const registry = await loadRegistry();
    const bundle = createRegistryBundle(registry, "0.1.0", "test-registry");
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.sha256).toHaveLength(64);
    expect(bundle.packs.length).toBe(registry.packs.length);
    expect(bundle.changelog?.[0]?.summary).toContain("Initial public registry");
  });

  it("summarizes registry source and pack inventory", async () => {
    const registry = await loadRegistry();
    const summary = summarizeRegistry({
      registry,
      source: { kind: "bundled", value: "bundled" }
    });

    expect(summary.source.kind).toBe("bundled");
    expect(summary.packCount).toBe(registry.packs.length);
    expect(summary.agentCount).toBe(registry.agents.length);
    expect(summary.packs.map((pack) => pack.id)).toContain("starter-dev-pack");
    expect(summary.changelog.count).toBeGreaterThan(0);
    expect(summary.changelog.latest?.version).toBe("0.1.0");
    expect(summary.targets.claude).toBeGreaterThan(0);
    expect(summary.targets.codex).toBeGreaterThan(0);
    expect(summary.targets.opencode).toBeGreaterThan(0);
  });

  it("verifies locked registry checksums", async () => {
    const registry = await loadRegistry();
    const bundle = createRegistryBundle(registry, "0.1.0", "test-registry");
    const loaded = {
      registry,
      source: {
        kind: "file" as const,
        value: "/tmp/registry.bundle.json",
        version: bundle.version,
        sha256: bundle.sha256
      }
    };

    expect(() =>
      verifyRegistryLock(loaded, {
        schemaVersion: 1,
        source: "/tmp/registry.bundle.json",
        version: bundle.version,
        sha256: bundle.sha256,
        lockedAt: "2026-06-06T00:00:00.000Z"
      })
    ).not.toThrow();

    expect(() =>
      verifyRegistryLock(loaded, {
        schemaVersion: 1,
        source: "/tmp/registry.bundle.json",
        version: bundle.version,
        sha256: "bad-checksum",
        lockedAt: "2026-06-06T00:00:00.000Z"
      })
    ).toThrow(/checksum mismatch/);
  });
});
