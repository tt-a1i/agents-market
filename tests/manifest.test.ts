import { describe, expect, it } from "vitest";
import { removeInstall, upsertInstall } from "../src/manifest.js";
import type { InstallManifest } from "../src/types.js";

describe("manifest", () => {
  it("records installed files with hashes", () => {
    const manifest: InstallManifest = { schemaVersion: 1, installs: [] };
    const next = upsertInstall(
      manifest,
      "starter-dev-pack",
      "claude",
      [
        {
          path: ".claude/agents/code-reviewer.md",
          content: "hello",
          target: "claude",
          agent: {
            id: "code-reviewer",
            name: "Code Reviewer",
            description: "Reviews code changes for correctness, security, regressions, maintainability, and missing tests.",
            version: "0.1.0",
            category: "review",
            tags: [],
            permission: "readonly",
            recommendedTargets: ["claude"],
            prompt: "You are a senior code reviewer. Return concise findings with file paths and remediation."
          }
        }
      ],
      new Date("2026-01-01T00:00:00.000Z")
    );

    expect(next.installs).toHaveLength(1);
    expect(next.installs[0]?.files[0]?.sha256).toHaveLength(64);
    expect(next.installs[0]?.installedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("removes matching install entries", () => {
    const manifest: InstallManifest = {
      schemaVersion: 1,
      installs: [
        { packId: "starter-dev-pack", target: "claude", installedAt: "now", files: [] },
        { packId: "frontend-pack", target: "claude", installedAt: "now", files: [] }
      ]
    };

    const next = removeInstall(manifest, "starter-dev-pack");
    expect(next.installs.map((entry) => entry.packId)).toEqual(["frontend-pack"]);
  });
});
