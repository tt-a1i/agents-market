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

  it("warns for imported provenance without source checksums", () => {
    const report = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          provenance: {
            source: "https://example.com/reviewer.md",
            repository: "example/agents",
            license: "MIT"
          }
        }
      ]
    });
    expect(report.findings.some((finding) => finding.code === "missing-source-checksum")).toBe(true);
  });

  it("warns for GitHub provenance without source commits", () => {
    const missing = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          provenance: {
            source: "https://github.com/example/agents/tree/main/reviewer.md",
            repository: "example/agents",
            license: "MIT",
            sourceSha256: "a".repeat(64)
          }
        }
      ]
    });
    expect(missing.findings.some((finding) => finding.code === "missing-source-commit")).toBe(true);

    const present = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          provenance: {
            source: "https://github.com/example/agents/tree/abcdef123456/reviewer.md",
            repository: "example/agents",
            license: "MIT",
            sourceCommit: "abcdef123456",
            sourceSha256: "a".repeat(64)
          }
        }
      ]
    });
    expect(present.findings.some((finding) => finding.code === "missing-source-commit")).toBe(false);
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

  it("reports community low prompt quality as info without failing strict lint", () => {
    const report = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          tier: "community",
          prompt: "You are a helper."
        }
      ]
    });

    const finding = report.findings.find((finding) => finding.code === "prompt-quality-low");
    expect(finding?.severity).toBe("info");
    expect(report.infoCount).toBeGreaterThanOrEqual(1);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.score).toBe(100);
  });

  it("holds core agents to the strict prompt quality bar", () => {
    const report = lintRegistry({
      ...baseRegistry,
      agents: [
        {
          ...baseRegistry.agents[0]!,
          tier: "core",
          prompt: "Help with code."
        }
      ]
    });

    const finding = report.findings.find((finding) => finding.code === "prompt-quality-low");
    expect(finding?.severity === "warning" || finding?.severity === "error").toBe(true);
  });

  it("warns when a core pack references community agents", () => {
    const report = lintRegistry({
      ...baseRegistry,
      agents: [{ ...baseRegistry.agents[0]!, tier: "community" }],
      packs: [{ ...baseRegistry.packs[0]!, tier: "core" }]
    });

    const finding = report.findings.find((finding) => finding.code === "core-pack-community-agent");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("reviewer");
  });

  it("reports shared boilerplate as an info finding", () => {
    const guardrails =
      "Before acting, read the relevant project files, diffs, and logs. Avoid broad rewrites unless explicitly confirmed. Report findings with evidence and verify claims against sources.";
    const report = lintRegistry({
      ...baseRegistry,
      agents: Array.from({ length: 6 }, (_, index) => ({
        ...baseRegistry.agents[0]!,
        id: `imported-${index}`,
        name: `Imported ${index}`,
        prompt: `You are Imported ${index}, focused on the area-${index} domain with ${index + 2} review specialties covering security and tests.\n\n${guardrails}`
      })),
      packs: [{ ...baseRegistry.packs[0]!, agents: ["imported-0"] }]
    });

    const finding = report.findings.find((finding) => finding.code === "prompt-boilerplate");
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("6 agents affected");
    expect(report.promptQuality.boilerplate.paragraphCount).toBe(1);
  });
});
