import { describe, expect, it } from "vitest";
import { buildBoilerplateIndex, scorePromptQuality, scoreRegistryPrompts } from "../src/prompt-quality.js";
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
    expect(report.boilerplate.paragraphCount).toBe(0);
  });

  it("excludes paragraphs shared across many agents from scoring", () => {
    const guardrails =
      "Before acting, read the relevant project files, diffs, and logs. Avoid broad rewrites unless explicitly confirmed. Report findings with evidence and verify claims against sources.";
    const agents = Array.from({ length: 6 }, (_, index) => ({
      ...agent,
      id: `imported-${index}`,
      name: `Imported ${index}`,
      // unique body has no role framing or constraints; only the shared block provides them
      prompt: `# Imported ${index}\n\nHandles area ${index} of the product with deep review and security focus on tests.\n\n${guardrails}`
    }));

    const report = scoreRegistryPrompts(agents);
    expect(report.boilerplate.paragraphCount).toBe(1);
    expect(report.boilerplate.affectedAgentCount).toBe(6);
    expect(report.boilerplate.topParagraphs[0]?.agents).toBe(6);

    // with the shared block stripped, the role/constraints dimensions must fail
    const score = report.agents[0]!;
    expect(score.score).toBeLessThan(100);
    expect(score.boilerplate?.paragraphs).toBe(1);
    expect(score.boilerplate?.ratio).toBeGreaterThan(0);
    expect(score.dimensions.find((dimension) => dimension.id === "constraints")?.passed).toBe(false);
  });

  it("normalizes agent names inside shared template paragraphs", () => {
    const agents = Array.from({ length: 5 }, (_, index) => ({
      ...agent,
      id: `templated-${index}`,
      name: `Specialist ${index}`,
      prompt: `You are Specialist ${index}. Read the relevant project context and user request before acting carefully.\n\nUnique body ${index} reviewing security and tests in depth for this domain.`
    }));
    const index = buildBoilerplateIndex(agents);
    expect(index.paragraphs.size).toBe(1);
  });

  it("does not strip paragraphs shared by fewer agents than the threshold", () => {
    const shared = "Read the relevant diffs and files before judging anything. Do not rewrite code unless asked. Verify claims with evidence.";
    const agents = Array.from({ length: 4 }, (_, index) => ({
      ...agent,
      id: `pair-${index}`,
      prompt: `You are reviewer ${index} focused on review, security, and tests.\n\n${shared}`
    }));
    const report = scoreRegistryPrompts(agents);
    expect(report.boilerplate.paragraphCount).toBe(0);
    expect(report.agents[0]?.boilerplate?.paragraphs).toBe(0);
  });
});
