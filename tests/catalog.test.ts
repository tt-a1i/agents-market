import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog, verifyCatalog } from "../src/catalog.js";
import { loadRegistry } from "../src/registry.js";

let cleanupPath: string | undefined;

afterEach(async () => {
  if (cleanupPath) {
    await rm(cleanupPath, { recursive: true, force: true });
    cleanupPath = undefined;
  }
});

describe("catalog", () => {
  it("builds a static catalog site and registry bundle", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-catalog-"));
    const files = await buildCatalog(registry, {
      outDir: cleanupPath,
      version: "0.1.0",
      title: "Agents Market Test",
      baseUrl: "https://example.com/agents-market",
      repository: "https://github.com/example/agents-market",
      releaseUrl: "https://github.com/example/agents-market/releases/tag/v0.1.0",
      commit: "abcdef1234567890"
    });

    expect(files.map((file) => file.split("/").pop()).sort()).toEqual([
      "catalog.json",
      "index.html",
      "registry.bundle.json"
    ]);

    const html = await readFile(join(cleanupPath, "index.html"), "utf8");
    expect(html).toContain("Agents Market Test");
    expect(html).toContain("starter-dev-pack");
    expect(html).toContain("Changelog");
    expect(html).toContain("Initial public registry");
    expect(html).toContain("Source");
    expect(html).toContain("risk:");
    expect(html).toContain("quality:");
    expect(html).toContain("average prompt quality");
    expect(html).toContain("Import Workflows");
    expect(html).toContain("Import GitHub Repository");
    expect(html).toContain("Filter by target");
    expect(html).toContain("requires Agents Market &gt;=0.1.0");
    expect(html).toContain("https://example.com/agents-market/registry.bundle.json");
    expect(html).toContain(
      "npx github:tt-a1i/agents-market apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --json"
    );
    expect(html).toContain(
      "npx github:tt-a1i/agents-market apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --yes"
    );
    expect(html).toContain(
      "npx github:tt-a1i/agents-market audit starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --json"
    );
    expect(html).toContain("data-copy=");
    expect(html).toContain("navigator.clipboard.writeText");
    expect(html).toContain("href=\"https://github.com/example/agents-market\"");
    expect(html).toContain("href=\"https://github.com/example/agents-market/releases/tag/v0.1.0\"");
    expect(html).toContain("commit <code>abcdef123456</code>");

    const catalog = JSON.parse(await readFile(join(cleanupPath, "catalog.json"), "utf8")) as {
      packCount: number;
      agentCount: number;
      packageSpec: string;
      metadata: {
        homepage?: string;
        repository?: string;
        catalogUrl?: string;
        releaseUrl?: string;
        packageSpec?: string;
        commit?: string;
      };
      registryBundleUrl: string;
      promptQuality: { averageScore: number; minScore: number };
      provenance: { withProvenance: number; withChecksum: number };
      importWorkflows: Array<{ label: string; command: string }>;
      changelog: Array<{ version: string; summary: string }>;
      packs: Array<{
        id: string;
        previewCommand: string;
        installCommand: string;
        auditCommand: string;
        diffCommand: string;
        workflowCommands: Array<{ label: string; command: string }>;
        requires?: { agentsMarket?: string };
        audit: {
          risk: string;
          fileCount: number;
        };
        quality: {
          averageScore: number;
          grade: string;
        };
        rating: {
          score: number;
          max: number;
          label: string;
        };
        targetCoverage: string[];
        provenance: {
          withChecksum: number;
        };
      }>;
      agents: Array<{ id: string; quality: { score: number; grade: string }; rating: { score: number } }>;
    };
    expect(catalog.packCount).toBeGreaterThan(0);
    expect(catalog.agentCount).toBeGreaterThan(0);
    expect(catalog.changelog[0]?.version).toBe("0.1.0");
    expect(catalog.changelog[0]?.summary).toContain("Initial public registry");
    expect(catalog.promptQuality.averageScore).toBeGreaterThanOrEqual(90);
    expect(catalog.promptQuality.minScore).toBeGreaterThanOrEqual(80);
    expect(catalog.packageSpec).toBe("github:tt-a1i/agents-market");
    expect(catalog.metadata.homepage).toBe("https://example.com/agents-market");
    expect(catalog.metadata.repository).toBe("https://github.com/example/agents-market");
    expect(catalog.metadata.catalogUrl).toBe("https://example.com/agents-market");
    expect(catalog.metadata.releaseUrl).toBe("https://github.com/example/agents-market/releases/tag/v0.1.0");
    expect(catalog.metadata.packageSpec).toBe("github:tt-a1i/agents-market");
    expect(catalog.metadata.commit).toBe("abcdef1234567890");
    expect(catalog.provenance.withProvenance).toBe(0);
    expect(catalog.importWorkflows.map((workflow) => workflow.label)).toContain("Import GitHub Repository");
    expect(catalog.importWorkflows.map((workflow) => workflow.command).join("\n")).toContain("import repo owner/community-agents");
    expect(catalog.registryBundleUrl).toBe("https://example.com/agents-market/registry.bundle.json");
    const bundle = JSON.parse(await readFile(join(cleanupPath, "registry.bundle.json"), "utf8")) as {
      metadata: { repository?: string; releaseUrl?: string; packageSpec?: string; commit?: string };
    };
    expect(bundle.metadata.repository).toBe("https://github.com/example/agents-market");
    expect(bundle.metadata.releaseUrl).toBe("https://github.com/example/agents-market/releases/tag/v0.1.0");
    expect(bundle.metadata.packageSpec).toBe("github:tt-a1i/agents-market");
    expect(bundle.metadata.commit).toBe("abcdef1234567890");
    const starterPack = catalog.packs.find((pack) => pack.id === "starter-dev-pack");
    expect(starterPack?.previewCommand).toContain(
      "npx github:tt-a1i/agents-market apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --json"
    );
    expect(starterPack?.installCommand).toContain(
      "npx github:tt-a1i/agents-market apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --yes"
    );
    expect(starterPack?.auditCommand).toContain(
      "npx github:tt-a1i/agents-market audit starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --json"
    );
    expect(starterPack?.diffCommand).toContain("--json");
    expect(starterPack?.workflowCommands.map((command) => command.label)).toEqual(["Preview", "Audit", "Diff", "Install"]);
    expect(starterPack?.requires?.agentsMarket).toBe(">=0.1.0");
    expect(starterPack?.audit.risk).toBe("high");
    expect(starterPack?.audit.fileCount).toBe(12);
    expect(starterPack?.quality.averageScore).toBeGreaterThanOrEqual(90);
    expect(starterPack?.quality.grade).toBe("excellent");
    expect(starterPack?.rating.score).toBeGreaterThanOrEqual(4.5);
    expect(starterPack?.rating.max).toBe(5);
    expect(starterPack?.targetCoverage).toEqual(["claude", "codex", "opencode"]);
    expect(starterPack?.provenance.withChecksum).toBe(0);
    expect(catalog.agents.find((agent) => agent.id === "code-reviewer")?.quality.grade).toBe("excellent");

    const validReport = await verifyCatalog(cleanupPath);
    expect(validReport.ok).toBe(true);
    expect(validReport.findings).toEqual([]);
  });

  it("fails verification when catalog commands drift from the bundle", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-catalog-"));
    await buildCatalog(registry, {
      outDir: cleanupPath,
      version: "0.1.0",
      title: "Agents Market Test",
      baseUrl: "https://example.com/agents-market"
    });

    const catalogPath = join(cleanupPath, "catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      packs: Array<{ id: string; previewCommand: string }>;
    };
    const starterPack = catalog.packs.find((pack) => pack.id === "starter-dev-pack");
    if (!starterPack) throw new Error("starter-dev-pack missing from test catalog");
    starterPack.previewCommand = "npx github:tt-a1i/agents-market apply wrong-pack";
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

    const report = await verifyCatalog(cleanupPath);
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("preview-command-mismatch");
  });

  it("supports npm package command generation for production catalogs", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-catalog-"));
    await buildCatalog(registry, {
      outDir: cleanupPath,
      version: "0.1.0",
      title: "Agents Market Test",
      baseUrl: "https://example.com/agents-market",
      packageSpec: "@agents-market/cli"
    });

    const catalog = JSON.parse(await readFile(join(cleanupPath, "catalog.json"), "utf8")) as {
      packageSpec: string;
      packs: Array<{ id: string; previewCommand: string }>;
    };
    const starterPack = catalog.packs.find((pack) => pack.id === "starter-dev-pack");
    expect(catalog.packageSpec).toBe("@agents-market/cli");
    expect(starterPack?.previewCommand).toContain("npx @agents-market/cli apply starter-dev-pack");
    const report = await verifyCatalog(cleanupPath);
    expect(report.ok).toBe(true);
  });
});
