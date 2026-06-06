import { describe, expect, it } from "vitest";
import { reviewRegistry, renderRegistryReviewMarkdown } from "../src/registry-review.js";
import { loadRegistryWithInfo } from "../src/registry.js";
import type { Registry } from "../src/types.js";

describe("registry review", () => {
  it("creates a submission review report for the bundled registry", async () => {
    const loaded = await loadRegistryWithInfo("./registry");
    const report = await reviewRegistry({
      loaded,
      catalogBaseUrl: "https://example.com/agents-market"
    });

    expect(report.ok).toBe(true);
    expect(report.lint?.score).toBe(100);
    expect(report.inventory?.packCount).toBeGreaterThanOrEqual(4);
    expect(report.inventory?.agentCount).toBeGreaterThanOrEqual(10);
    expect(report.packs.map((pack) => pack.id)).toContain("starter-dev-pack");
    expect(report.catalog?.ok).toBe(true);
    expect(report.checks).toContain("Registry catalog verify");

    const markdown = renderRegistryReviewMarkdown(report);
    expect(markdown).toContain("<!-- agents-market-registry-review -->");
    expect(markdown).toContain("## Registry Review");
    expect(markdown).toContain("| `starter-dev-pack` |");
  });

  it("returns a failed report for invalid registry content", async () => {
    const invalidRegistry: Registry = {
      agents: [],
      packs: [],
      changelog: []
    };
    const report = await reviewRegistry({
      loaded: {
        registry: invalidRegistry,
        source: { kind: "directory", value: "/tmp/invalid-registry" }
      }
    });

    expect(report.ok).toBe(false);
    expect(report.failure).toContain("Registry must contain at least one pack");
    expect(renderRegistryReviewMarkdown(report)).toContain("- Status: fail");
  });
});
