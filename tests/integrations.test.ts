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
      expect(file.content).toContain("agents-market apply --target all --json");
      expect(file.content).toContain("agents-market apply <pack-id> --target all --json");
      expect(file.content).toContain("agents-market apply <pack-id> --target all --yes");
      expect(file.content).toContain("agents-market registry info --registry <source> --json");
      expect(file.content).toContain("agents-market pack create");
      expect(file.content).toContain("agents-market status --json");
      expect(file.content).toContain("agents-market outdated --json");
      expect(file.content).toContain("agents-market doctor --strict --json");
      expect(file.content).toContain("Treat policy failures as blockers");
    }
  });
});
