import { describe, expect, it } from "vitest";
import { generateClaudeAgent } from "../src/adapters/claude.js";
import { generateCodexAgent } from "../src/adapters/codex.js";
import { generateOpenCodeAgent } from "../src/adapters/opencode.js";
import type { AgentDefinition } from "../src/types.js";

const agent: AgentDefinition = {
  id: "code-reviewer",
  name: "Code Reviewer",
  description: "Reviews code changes for correctness, security, regressions, maintainability, and missing tests.",
  version: "0.1.0",
  category: "review",
  tags: ["review"],
  permission: "readonly",
  recommendedTargets: ["claude", "codex", "opencode"],
  prompt: "You are a senior code reviewer. Return concise findings with file paths and remediation.",
  tools: {
    read: true,
    edit: false,
    write: false,
    bash: "safe"
  }
};

describe("adapters", () => {
  it("generates Claude Code markdown agents", () => {
    const file = generateClaudeAgent(agent);
    expect(file.path).toBe(".claude/agents/code-reviewer.md");
    expect(file.content).toContain("name: code-reviewer");
    expect(file.content).toContain("tools: Read, Grep, Glob, Bash");
  });

  it("generates Codex TOML agents", () => {
    const file = generateCodexAgent(agent);
    expect(file.path).toBe(".codex/agents/code-reviewer.toml");
    expect(file.content).toContain('name = "code-reviewer"');
    expect(file.content).toContain('sandbox_mode = "read-only"');
  });

  it("generates OpenCode markdown agents", () => {
    const file = generateOpenCodeAgent(agent);
    expect(file.path).toBe(".opencode/agents/code-reviewer.md");
    expect(file.content).toContain("mode: subagent");
    expect(file.content).toContain("edit: deny");
  });
});
