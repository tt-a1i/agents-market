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
      baseUrl: "https://example.com/agents-market"
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
    expect(html).toContain("requires Agents Market &gt;=0.1.0");
    expect(html).toContain("https://example.com/agents-market/registry.bundle.json");
    expect(html).toContain(
      "npx @agents-market/cli apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --json"
    );
    expect(html).toContain(
      "npx @agents-market/cli apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --yes"
    );
    expect(html).toContain(
      "npx @agents-market/cli audit starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --json"
    );
    expect(html).toContain("data-copy=");
    expect(html).toContain("navigator.clipboard.writeText");

    const catalog = JSON.parse(await readFile(join(cleanupPath, "catalog.json"), "utf8")) as {
      packCount: number;
      agentCount: number;
      registryBundleUrl: string;
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
      }>;
    };
    expect(catalog.packCount).toBeGreaterThan(0);
    expect(catalog.agentCount).toBeGreaterThan(0);
    expect(catalog.changelog[0]?.version).toBe("0.1.0");
    expect(catalog.changelog[0]?.summary).toContain("Initial public registry");
    expect(catalog.registryBundleUrl).toBe("https://example.com/agents-market/registry.bundle.json");
    const starterPack = catalog.packs.find((pack) => pack.id === "starter-dev-pack");
    expect(starterPack?.previewCommand).toContain(
      "npx @agents-market/cli apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --json"
    );
    expect(starterPack?.installCommand).toContain(
      "npx @agents-market/cli apply starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced --yes"
    );
    expect(starterPack?.auditCommand).toContain(
      "npx @agents-market/cli audit starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --json"
    );
    expect(starterPack?.diffCommand).toContain("--json");
    expect(starterPack?.workflowCommands.map((command) => command.label)).toEqual(["Preview", "Audit", "Diff", "Install"]);
    expect(starterPack?.requires?.agentsMarket).toBe(">=0.1.0");
    expect(starterPack?.audit.risk).toBe("high");
    expect(starterPack?.audit.fileCount).toBe(12);

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
    starterPack.previewCommand = "npx @agents-market/cli apply wrong-pack";
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

    const report = await verifyCatalog(cleanupPath);
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("preview-command-mismatch");
  });
});
