import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRegistryBundle,
  loadRegistry,
  signRegistryBundle,
  summarizeRegistry,
  verifyRegistryBundleSignature,
  verifyRegistryLock
} from "../src/registry.js";
import { recommendPackDetails, recommendPacks } from "../src/recommend.js";
import { auditPack } from "../src/audit.js";
import { runDoctor } from "../src/doctor.js";
import { createInstallPlan, generatePackFiles } from "../src/install.js";
import { githubTreeUrl, isCommitLike, parseGitHubRepository } from "../src/git-import.js";
import { saveManifest, saveRegistryLock, upsertInstall } from "../src/manifest.js";
import { composePack } from "../src/pack.js";
import { searchRegistry } from "../src/search.js";
import { writeGeneratedFiles } from "../src/files.js";
import { createPolicyPreset, savePolicy, policyPath } from "../src/policy.js";
import type { Registry } from "../src/types.js";

describe("registry", () => {
  it("loads bundled agents and packs", async () => {
    const registry = await loadRegistry();
    expect(registry.agents.length).toBeGreaterThanOrEqual(10);
    expect(registry.packs.map((pack) => pack.id)).toContain("starter-dev-pack");
    expect(registry.packs.map((pack) => pack.id)).toContain("security-pack");
    expect(registry.changelog?.[0]?.summary).toContain("marketplace");
    expect(registry.changelog?.some((entry) => entry.version === "0.1.1")).toBe(true);
    expect(registry.changelog?.some((entry) => entry.version === "0.1.0")).toBe(true);
  });

  it("recommends security pack for security-sensitive signals", async () => {
    const registry = await loadRegistry();
    const packs = recommendPacks(registry, {
      root: "/tmp/project",
      languages: ["typescript"],
      frameworks: ["express"],
      files: ["package.json", "package-lock.json", ".env.example", "Dockerfile"]
    });
    expect(packs[0]?.id).toBe("security-pack");
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
    expect(pack.requires?.agentsMarket).toBe(">=0.1.0");
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

  it("audits missing source commits for GitHub-imported agents", () => {
    const registry: Registry = {
      agents: [
        {
          id: "imported-reviewer",
          name: "Imported Reviewer",
          description: "Reviews imported community agents for provenance, quality, permissions, and publication readiness.",
          version: "0.1.0",
          category: "review",
          tags: ["imported", "review"],
          permission: "readonly",
          recommendedTargets: ["claude", "codex", "opencode"],
          prompt: "You are an imported reviewer. Inspect source provenance, permissions, and prompt quality before publishing.",
          tools: { read: true, bash: "safe" },
          provenance: {
            source: "https://github.com/example/agents/tree/main/imported-reviewer.md",
            repository: "example/agents",
            license: "MIT",
            sourceSha256: "a".repeat(64)
          }
        }
      ],
      packs: [
        {
          id: "imported-pack",
          name: "Imported Pack",
          description: "Imported pack for reviewing community agent provenance.",
          version: "0.1.0",
          tags: ["imported"],
          agents: ["imported-reviewer"],
          recommendedFor: { languages: ["typescript"] },
          requires: { agentsMarket: ">=0.1.0" }
        }
      ]
    };

    const audit = auditPack(registry, "imported-pack", "all");
    expect(audit.provenance.missingCommit).toEqual(["imported-reviewer"]);
    expect(audit.provenance.withCommit).toBe(0);
    expect(audit.warnings.some((warning) => warning.includes("missing source commit"))).toBe(true);
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

  it("filters marketplace search by tier and boosts core results", async () => {
    const registry = await loadRegistry();
    const coreOnly = searchRegistry(registry, { query: "review", tier: "core" });
    expect(coreOnly.length).toBeGreaterThan(0);
    expect(coreOnly.every((result) => result.tier === "core")).toBe(true);
    expect(coreOnly.every((result) => result.reasons.includes("tier:core"))).toBe(true);

    const communityOnly = searchRegistry(registry, { query: "review", tier: "community" });
    expect(communityOnly.length).toBeGreaterThan(0);
    expect(communityOnly.every((result) => result.tier === "community")).toBe(true);
  });

  it("ranks core packs above community packs in recommendations", async () => {
    const registry = await loadRegistry();
    const recommendations = recommendPackDetails(registry, {
      root: "/tmp/project",
      languages: ["typescript", "javascript"],
      frameworks: [],
      files: ["package.json", "README.md"]
    });
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]?.tier).toBe("core");
    const firstCommunity = recommendations.findIndex((recommendation) => recommendation.tier === "community");
    if (firstCommunity !== -1) {
      expect(recommendations.slice(firstCommunity).every((recommendation) => recommendation.tier === "community")).toBe(true);
    }
  });

  it("parses GitHub repositories for import", () => {
    const repo = parseGitHubRepository("owner/example-agents");
    expect(repo.repository).toBe("owner/example-agents");
    expect(repo.cloneUrl).toBe("https://github.com/owner/example-agents.git");
    expect(githubTreeUrl(repo, "main", "agents/claude")).toBe(
      "https://github.com/owner/example-agents/tree/main/agents/claude"
    );
    expect(githubTreeUrl(repo, "abcdef1234567890", "agents/claude")).toBe(
      "https://github.com/owner/example-agents/tree/abcdef1234567890/agents/claude"
    );
    expect(isCommitLike("abcdef1")).toBe(true);
    expect(isCommitLike("main")).toBe(false);

    const urlRepo = parseGitHubRepository("https://github.com/acme/templates.git");
    expect(urlRepo.repository).toBe("acme/templates");
  });

  it("creates and parses portable registry bundles", async () => {
    const registry = await loadRegistry();
    const bundle = createRegistryBundle(registry, "0.1.0", "test-registry", {
      homepage: "https://example.com/agents-market",
      repository: "https://github.com/example/agents-market",
      catalogUrl: "https://example.com/agents-market",
      releaseUrl: "https://github.com/example/agents-market/releases/tag/v0.1.0",
      packageSpec: "@agents-market/cli",
      commit: "abcdef1234567890"
    });
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.sha256).toHaveLength(64);
    expect(bundle.metadata?.repository).toBe("https://github.com/example/agents-market");
    expect(bundle.metadata?.commit).toBe("abcdef1234567890");
    expect(bundle.packs.length).toBe(registry.packs.length);
    expect(bundle.changelog?.[0]?.summary).toContain("marketplace");
    expect(bundle.changelog?.some((entry) => entry.summary.includes("Expanded the bundled registry"))).toBe(true);
    expect(bundle.changelog?.some((entry) => entry.summary.includes("Initial public registry"))).toBe(true);
  });

  it("signs and verifies portable registry bundles", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const registry = await loadRegistry();
    const bundle = createRegistryBundle(registry, "0.1.0", "test-registry");
    const signed = signRegistryBundle(bundle, privateKeyPem, "test-key");

    expect(signed.signatures?.[0]?.keyId).toBe("test-key");
    expect(signed.sha256).toBe(bundle.sha256);
    expect(verifyRegistryBundleSignature(signed, publicKeyPem, "test-key")).toMatchObject({
      ok: true,
      keyId: "test-key",
      algorithm: "ed25519"
    });
    expect(verifyRegistryBundleSignature(signed, publicKeyPem, "missing-key")).toMatchObject({
      ok: false
    });
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
    expect(summary.packs.find((pack) => pack.id === "starter-dev-pack")?.requires?.agentsMarket).toBe(">=0.1.0");
    expect(summary.changelog.count).toBeGreaterThan(0);
    expect(summary.changelog.latest?.summary).toContain("marketplace");
    expect(summary.targets.claude).toBeGreaterThan(0);
    expect(summary.targets.codex).toBeGreaterThan(0);
    expect(summary.targets.opencode).toBeGreaterThan(0);

    const bundle = createRegistryBundle(registry, "0.1.0", "test-registry", {
      homepage: "https://example.com/agents-market",
      repository: "https://github.com/example/agents-market"
    });
    const bundleSummary = summarizeRegistry({
      registry: bundle,
      source: { kind: "file", value: "/tmp/registry.bundle.json", version: bundle.version, sha256: bundle.sha256 }
    });
    expect(bundleSummary.metadata?.homepage).toBe("https://example.com/agents-market");
    expect(bundleSummary.metadata?.repository).toBe("https://github.com/example/agents-market");
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

    await expect(
      verifyRegistryLock(loaded, {
        schemaVersion: 1,
        source: "/tmp/registry.bundle.json",
        version: bundle.version,
        sha256: bundle.sha256,
        lockedAt: "2026-06-06T00:00:00.000Z"
      })
    ).resolves.toBeUndefined();

    await expect(
      verifyRegistryLock(loaded, {
        schemaVersion: 1,
        source: "/tmp/registry.bundle.json",
        version: bundle.version,
        sha256: "bad-checksum",
        lockedAt: "2026-06-06T00:00:00.000Z"
      })
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("verifies signed registry locks", async () => {
    const root = await mkdtemp(join(tmpdir(), "agents-market-signed-lock-"));
    try {
      const registry = await loadRegistry();
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
      const publicKeyPath = join(root, "registry-public.pem");
      await writeFile(publicKeyPath, publicKeyPem, "utf8");
      const signed = signRegistryBundle(
        createRegistryBundle(registry, "0.1.0", "test-registry"),
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        "test-key"
      );
      const loaded = {
        registry: signed,
        source: {
          kind: "file" as const,
          value: "/tmp/registry.bundle.json",
          version: signed.version,
          sha256: signed.sha256
        }
      };

      await expect(
        verifyRegistryLock(
          loaded,
          {
            schemaVersion: 1,
            source: "/tmp/registry.bundle.json",
            version: signed.version,
            sha256: signed.sha256,
            signature: {
              publicKey: "registry-public.pem",
              keyId: "test-key",
              algorithm: "ed25519"
            },
            lockedAt: "2026-06-06T00:00:00.000Z"
          },
          { root }
        )
      ).resolves.toBeUndefined();

      await expect(
        verifyRegistryLock(
          loaded,
          {
            schemaVersion: 1,
            source: "/tmp/registry.bundle.json",
            version: signed.version,
            sha256: signed.sha256,
            signature: {
              publicKey: "registry-public.pem",
              keyId: "missing-key",
              algorithm: "ed25519"
            },
            lockedAt: "2026-06-06T00:00:00.000Z"
          },
          { root }
        )
      ).rejects.toThrow(/signature mismatch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
