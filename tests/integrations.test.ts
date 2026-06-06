import { describe, expect, it } from "vitest";
import { generateIntegrations } from "../src/integrations.js";

describe("agent-native integrations", () => {
  it("generates integration files for every target", () => {
    const files = generateIntegrations("all");
    expect(files.map((file) => file.path)).toEqual([
      ".claude/skills/agents-market-installer/SKILL.md",
      ".agents/skills/agents-market-installer/SKILL.md",
      ".opencode/commands/agents-market.md"
    ]);
  });

  it("instructs integrations to preview before installing", () => {
    const files = generateIntegrations("all");
    for (const file of files) {
      expect(file.content).toContain("agents-market diff");
      expect(file.content).toContain("agents-market install");
      expect(file.content).toContain("agents-market status");
    }
  });
});
