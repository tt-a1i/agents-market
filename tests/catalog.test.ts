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
      title: "Agents Market Test"
    });

    expect(files.map((file) => file.split("/").pop()).sort()).toEqual([
      "catalog.json",
      "index.html",
      "registry.bundle.json"
    ]);

    const html = await readFile(join(cleanupPath, "index.html"), "utf8");
    expect(html).toContain("Agents Market Test");
    expect(html).toContain("starter-dev-pack");

    const catalog = JSON.parse(await readFile(join(cleanupPath, "catalog.json"), "utf8")) as {
      packCount: number;
      agentCount: number;
    };
    expect(catalog.packCount).toBeGreaterThan(0);
    expect(catalog.agentCount).toBeGreaterThan(0);
  });
});
