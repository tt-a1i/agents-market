import { describe, expect, it } from "vitest";
import { scorePromptQuality, scoreRegistryPrompts } from "../src/prompt-quality.js";
import type { AgentDefinition } from "../src/types.js";

const agent: AgentDefinition = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews code changes for correctness, security, regressions, maintainability, and missing tests.",
  version: "0.1.0",
  category: "review",
  tags: ["review", "security", "tests"],
  permission: "readonly",
  recommendedTargets: ["claude", "codex", "opencode"],
  prompt:
    "You are a senior reviewer. Read the relevant diffs and files before judging. Report correctness, security, and test coverage findings with file paths. Do not rewrite code unless asked. Verify claims with evidence."
};

describe("prompt quality scoring", () => {
  it("scores strong prompts across explainable dimensions", () => {
    const score = scorePromptQuality(agent);
    expect(score.score).toBe(100);
    expect(score.grade).toBe("excellent");
    expect(score.dimensions.map((dimension) => dimension.id)).toEqual(["role", "task", "context", "constraints", "output", "domain", "verification"]);
    expect(score.suggestions).toEqual([]);
  });

  it("returns suggestions for vague prompts", () => {
    const score = scorePromptQuality({
      ...agent,
      prompt: "Help with code."
    });

    expect(score.score).toBeLessThan(70);
    expect(score.grade).toBe("poor");
    expect(score.suggestions.length).toBeGreaterThan(0);
    expect(score.dimensions.some((dimension) => dimension.id === "role" && !dimension.passed)).toBe(true);
  });

  it("summarizes registry prompt quality", () => {
    const report = scoreRegistryPrompts([agent, { ...agent, id: "weak", prompt: "Help with code." }]);
    expect(report.averageScore).toBeLessThan(100);
    expect(report.minScore).toBeLessThan(70);
    expect(report.agents).toHaveLength(2);
  });
});
