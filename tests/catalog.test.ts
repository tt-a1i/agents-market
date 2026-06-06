import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog.js";
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
    expect(html).toContain("Source");
    expect(html).toContain("risk:");
    expect(html).toContain("https://example.com/agents-market/registry.bundle.json");
    expect(html).toContain(
      "npx @agents-market/cli install starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced"
    );
    expect(html).toContain(
      "npx @agents-market/cli audit starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --json"
    );
    expect(html).toContain(
      "npx @agents-market/cli policy check starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --preset balanced --json"
    );
    expect(html).toContain("data-copy=");
    expect(html).toContain("navigator.clipboard.writeText");

    const catalog = JSON.parse(await readFile(join(cleanupPath, "catalog.json"), "utf8")) as {
      packCount: number;
      agentCount: number;
      registryBundleUrl: string;
      packs: Array<{
        id: string;
        installCommand: string;
        auditCommand: string;
        policyCommand: string;
        diffCommand: string;
        workflowCommands: Array<{ label: string; command: string }>;
        audit: {
          risk: string;
          fileCount: number;
        };
      }>;
    };
    expect(catalog.packCount).toBeGreaterThan(0);
    expect(catalog.agentCount).toBeGreaterThan(0);
    expect(catalog.registryBundleUrl).toBe("https://example.com/agents-market/registry.bundle.json");
    const starterPack = catalog.packs.find((pack) => pack.id === "starter-dev-pack");
    expect(starterPack?.installCommand).toContain(
      "npx @agents-market/cli install starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --policy-preset balanced"
    );
    expect(starterPack?.auditCommand).toContain(
      "npx @agents-market/cli audit starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --json"
    );
    expect(starterPack?.policyCommand).toContain(
      "npx @agents-market/cli policy check starter-dev-pack --target all --registry https://example.com/agents-market/registry.bundle.json --preset balanced --json"
    );
    expect(starterPack?.diffCommand).toContain("--json");
    expect(starterPack?.workflowCommands.map((command) => command.label)).toEqual(["Audit", "Policy Check", "Diff", "Install"]);
    expect(starterPack?.audit.risk).toBe("high");
    expect(starterPack?.audit.fileCount).toBe(12);
  });
});
