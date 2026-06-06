import { describe, expect, it } from "vitest";
import { loadRegistry } from "../src/registry.js";
import { recommendPacks } from "../src/recommend.js";

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
});
