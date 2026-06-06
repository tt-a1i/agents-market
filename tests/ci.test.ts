import { describe, expect, it } from "vitest";
import { defaultCiWorkflowOptions, generateCiWorkflow } from "../src/ci.js";

describe("ci workflow generation", () => {
  it("generates a GitHub Actions workflow for Agents Market maintenance", () => {
    const workflow = generateCiWorkflow();
    expect(workflow.path).toBe(".github/workflows/agents-market.yml");
    expect(workflow.content).toContain("name: Agents Market");
    expect(workflow.content).toContain("npx --yes @agents-market/cli@0.1.0 status --diff --json");
    expect(workflow.content).toContain("npx --yes @agents-market/cli@0.1.0 outdated --fail-on-outdated --json");
    expect(workflow.content).toContain("npx --yes @agents-market/cli@0.1.0 update --dry-run --fail-on-skipped --json");
    expect(workflow.content).toContain("npx --yes @agents-market/cli@0.1.0 doctor --strict --json");
    expect(workflow.content).toContain("group: agents-market-${{ github.ref }}");
    expect(workflow.content).toContain("cancel-in-progress: true");
    expect(workflow.content).toContain("timeout-minutes: 10");
    expect(workflow.content).toContain("persist-credentials: false");
    expect(workflow.content).toContain(".agents-market/**");
    expect(workflow.content).toContain(".claude/agents/**");
    expect(workflow.content).toContain(".codex/agents/**");
    expect(workflow.content).toContain(".opencode/agents/**");
  });

  it("can generate non-strict workflows with a custom package spec", () => {
    const workflow = generateCiWorkflow({
      ...defaultCiWorkflowOptions(),
      packageSpec: "github:tt-a1i/agents-market#preview-0.1.0",
      strict: false
    });
    expect(workflow.content).toContain("npx --yes github:tt-a1i/agents-market#preview-0.1.0 doctor --json");
    expect(workflow.content).not.toContain("doctor --strict --json");
  });

  it("rejects unsafe package specs before rendering shell commands", () => {
    expect(() => generateCiWorkflow({ packageSpec: "github:owner/repo; echo token" })).toThrow(/Unsafe package spec/);
  });
});
