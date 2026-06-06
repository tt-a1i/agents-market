import { describe, expect, it } from "vitest";
import { lintRegistry } from "../src/registry-lint.js";
import type { Registry } from "../src/types.js";

const baseRegistry: Registry = {
  agents: [
    {
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews code changes for correctness, security, regressions, maintainability, and missing tests.",
      version: "0.1.0",
      category: "review",
      tags: ["review"],
      permission: "readonly",
      recommendedTargets: ["claude", "codex", "opencode"],
      tools: { read: true, edit: false, write: false, bash: "safe" },
      prompt: "You are a senior reviewer. Report correctness, security, and test coverage findings with file paths."
    }
  ],
  packs: [
    {
      id: "starter",
      name: "Starter",
      description: "Starter pack for coding review and verification.",
      version: "0.1.0",
      tags: ["starter"],
      agents: ["reviewer"],
      requires: { agentsMarket: ">=0.1.0" },
      recommendedFor: { languages: ["typescript"] }
    }
  ]
};

describe("registry lint", () => {
  it("passes a healthy registry", () => {
    const report = lintRegistry(baseRegistry);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.score).toBe(100);
    expect(report.promptQuality.averageScore).toBeGreaterThanOrEqual(70);
    expect(report.promptQuality.agents[0]?.dimensions.length).toBeGreaterThan(0);
  });

  it("flags unsafe readonly write tools", () => {
    const report = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          tools: { read: true, write: true }
        }
      ]
    });
    expect(report.findings.some((finding) => finding.code === "readonly-write-tools")).toBe(true);
    expect(report.errorCount).toBe(1);
  });

  it("warns when packs cannot be recommended", () => {
    const report = lintRegistry({
      ...baseRegistry,
      packs: [
        {
          ...baseRegistry.packs[0]!,
          recommendedFor: {}
        }
      ]
    });
    expect(report.findings.some((finding) => finding.code === "no-recommendation-signals")).toBe(true);
    expect(report.warningCount).toBe(1);
  });

  it("requires packs to declare valid Agents Market version constraints", () => {
    const missing = lintRegistry({
      ...baseRegistry,
      packs: [{ ...baseRegistry.packs[0]!, requires: undefined }]
    });
    expect(missing.findings.some((finding) => finding.code === "missing-agents-market-version-constraint")).toBe(true);

    const invalid = lintRegistry({
      ...baseRegistry,
      packs: [{ ...baseRegistry.packs[0]!, requires: { agentsMarket: "latest" } }]
    });
    expect(invalid.findings.some((finding) => finding.code === "invalid-agents-market-version-constraint")).toBe(true);
  });

  it("warns for imported agents without provenance", () => {
    const report = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          tags: ["imported"]
        }
      ]
    });
    expect(report.findings.some((finding) => finding.code === "missing-provenance")).toBe(true);
  });

  it("flags low-quality prompts with suggestions", () => {
    const report = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          prompt: "Help with code."
        }
      ]
    });

    expect(report.findings.some((finding) => finding.code === "prompt-quality-low")).toBe(true);
    expect(report.promptQuality.agents[0]?.score).toBeLessThan(70);
    expect(report.promptQuality.agents[0]?.suggestions.length).toBeGreaterThan(0);
  });
});
