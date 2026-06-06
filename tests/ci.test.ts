import { describe, expect, it } from "vitest";
import { defaultCiWorkflowOptions, generateCiWorkflow } from "../src/ci.js";

describe("ci workflow generation", () => {
  it("generates a GitHub Actions workflow for Agents Market maintenance", () => {
    const workflow = generateCiWorkflow();
    expect(workflow.path).toBe(".github/workflows/agents-market.yml");
    expect(workflow.content).toContain("name: Agents Market");
    expect(workflow.content).toContain("npx --yes github:tt-a1i/agents-market status --diff --json");
    expect(workflow.content).toContain("npx --yes github:tt-a1i/agents-market outdated --json");
    expect(workflow.content).toContain("npx --yes github:tt-a1i/agents-market doctor --strict --json");
    expect(workflow.content).toContain(".agents-market/**");
    expect(workflow.content).toContain(".claude/agents/**");
    expect(workflow.content).toContain(".codex/agents/**");
    expect(workflow.content).toContain(".opencode/agents/**");
  });

  it("can generate non-strict workflows with a custom package spec", () => {
    const workflow = generateCiWorkflow({
      ...defaultCiWorkflowOptions(),
      packageSpec: "@agents-market/cli",
      strict: false
    });
    expect(workflow.content).toContain("npx --yes @agents-market/cli doctor --json");
    expect(workflow.content).not.toContain("doctor --strict --json");
  });

  it("rejects unsafe package specs before rendering shell commands", () => {
    expect(() => generateCiWorkflow({ packageSpec: "github:owner/repo; echo token" })).toThrow(/Unsafe package spec/);
  });
});
