import { describe, expect, it } from "vitest";
import { generateIntegrationPackages, generateIntegrations } from "../src/integrations.js";

describe("agent-native integrations", () => {
  it("generates integration files for every target", () => {
    const files = generateIntegrations("all");
    expect(files.map((file) => file.path)).toEqual([
      ".claude/skills/agents-market-installer/SKILL.md",
      ".codex/skills/agents-market-installer/SKILL.md",
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
      expect(file.content).toContain("agents-market registry verify-lock --json");
      expect(file.content).toContain("agents-market pack create");
      expect(file.content).toContain("agents-market status --json");
      expect(file.content).toContain("agents-market status --diff --json");
      expect(file.content).toContain("agents-market outdated --json");
      expect(file.content).toContain("agents-market doctor --strict --json");
      expect(file.content).toContain("Treat policy failures as blockers");
      expect(file.content).toContain("Treat compatibility failures as blockers");
      expect(file.content).toContain("Treat registry lock verification failures as blockers");
    }
  });

  it("generates distributable packages for every target", () => {
    const files = generateIntegrationPackages("all");
    expect(files.map((file) => file.path)).toEqual([
      "agents-market-claude/README.md",
      "agents-market-claude/.claude/skills/agents-market-installer/SKILL.md",
      "agents-market-codex/README.md",
      "agents-market-codex/.codex-plugin/plugin.json",
      "agents-market-codex/skills/agents-market-installer/SKILL.md",
      "agents-market-opencode/README.md",
      "agents-market-opencode/.opencode/commands/agents-market.md"
    ]);

    const manifestFile = files.find((file) => file.path === "agents-market-codex/.codex-plugin/plugin.json");
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile!.content) as { name: string; skills: string; interface: { displayName: string } };
    expect(manifest.name).toBe("agents-market-installer");
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.interface.displayName).toBe("Agents Market Installer");
  });
});
