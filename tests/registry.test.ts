import { describe, expect, it } from "vitest";
import { createRegistryBundle, loadRegistry } from "../src/registry.js";
import { recommendPackDetails, recommendPacks } from "../src/recommend.js";
import { auditPack } from "../src/audit.js";
import { createInstallPlan } from "../src/install.js";
import { githubTreeUrl, parseGitHubRepository } from "../src/git-import.js";
import { searchRegistry } from "../src/search.js";

describe("registry", () => {
  it("loads bundled agents and packs", async () => {
    const registry = await loadRegistry();
    expect(registry.agents.length).toBeGreaterThanOrEqual(7);
    expect(registry.packs.map((pack) => pack.id)).toContain("starter-dev-pack");
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
  });
});
