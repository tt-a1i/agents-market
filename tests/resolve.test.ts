import { describe, expect, it } from "vitest";
import { planManifestResolution } from "../src/resolve.js";
import { sha256 } from "../src/hash.js";
import type { AgentDefinition, InstallManifest, Registry } from "../src/types.js";

const agent: AgentDefinition = {
  id: "code-reviewer",
  name: "Code Reviewer",
  description: "Reviews code changes for correctness, security, regressions, maintainability, and missing tests.",
  version: "0.1.0",
  category: "review",
  tags: ["review"],
  permission: "readonly",
  recommendedTargets: ["claude"],
  prompt: "You are a senior code reviewer. Return concise findings with file paths and remediation."
};

const registry: Registry = {
  agents: [agent],
  packs: [
    {
      id: "starter-dev-pack",
      name: "Starter Dev Pack",
      description: "Core development agents.",
      version: "0.1.0",
      tags: ["starter"],
      agents: ["code-reviewer"],
      recommendedFor: {},
      requires: { agentsMarket: ">=0.1.0" }
    }
  ]
};

function manifestFor(content: string): InstallManifest {
  return {
    schemaVersion: 1,
    installs: [
      {
        packId: "starter-dev-pack",
        packVersion: "0.1.0",
        target: "claude",
        installedAt: "2026-01-01T00:00:00.000Z",
        files: [
          {
            path: ".claude/agents/code-reviewer.md",
            target: "claude",
            agentId: "code-reviewer",
            sha256: sha256(content)
          }
        ]
      }
    ]
  };
}

describe("manifest resolution", () => {
  it("accepts registry content for a modified generated file", async () => {
    const manifest = manifestFor("old generated content");
    const result = await planManifestResolution({
      manifest,
      registry,
      strategy: "accept-registry",
      dryRun: false,
      readCurrent: async () => "local edit"
    });

    expect(result.written).toBe(1);
    expect(result.filesToWrite[0]?.path).toBe(".claude/agents/code-reviewer.md");
    expect(result.installs[0]?.changes[0]?.action).toBe("write-registry");
    expect(result.manifest.installs[0]?.files[0]?.sha256).toBe(sha256(result.filesToWrite[0]!.content));
  });

  it("keeps local content by recording the current hash", async () => {
    const manifest = manifestFor("old generated content");
    const result = await planManifestResolution({
      manifest,
      registry,
      strategy: "keep-local",
      dryRun: false,
      readCurrent: async () => "local edit"
    });

    expect(result.recorded).toBe(1);
    expect(result.filesToWrite).toHaveLength(0);
    expect(result.installs[0]?.changes[0]?.action).toBe("record-local");
    expect(result.manifest.installs[0]?.files[0]?.sha256).toBe(sha256("local edit"));
  });

  it("forgets a tracked file and removes the empty install entry", async () => {
    const manifest = manifestFor("old generated content");
    const result = await planManifestResolution({
      manifest,
      registry,
      strategy: "forget",
      dryRun: false,
      readCurrent: async () => "local edit"
    });

    expect(result.forgotten).toBe(1);
    expect(result.installs[0]?.changes[0]?.action).toBe("forget");
    expect(result.manifest.installs).toHaveLength(0);
  });

  it("does not mutate manifest on dry run", async () => {
    const manifest = manifestFor("old generated content");
    const result = await planManifestResolution({
      manifest,
      registry,
      strategy: "keep-local",
      dryRun: true,
      readCurrent: async () => "local edit"
    });

    expect(result.recorded).toBe(1);
    expect(result.manifest).toBe(manifest);
    expect(result.manifest.installs[0]?.files[0]?.sha256).toBe(sha256("old generated content"));
  });
});
