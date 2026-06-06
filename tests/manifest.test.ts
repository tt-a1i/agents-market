import { describe, expect, it } from "vitest";
import { appendInstallHistory, createUpdateHistoryEntry, popInstallHistory, removeInstall, upsertInstall, upsertInstallEntry } from "../src/manifest.js";
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
      new Date("2026-01-01T00:00:00.000Z"),
      undefined,
      "0.1.0"
    );

    expect(next.installs).toHaveLength(1);
    expect(next.installs[0]?.packVersion).toBe("0.1.0");
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

  it("replaces one install entry without touching others", () => {
    const manifest: InstallManifest = {
      schemaVersion: 1,
      installs: [
        { packId: "starter-dev-pack", target: "claude", installedAt: "old", files: [] },
        { packId: "frontend-pack", target: "claude", installedAt: "now", files: [] }
      ]
    };

    const next = upsertInstallEntry(manifest, {
      packId: "starter-dev-pack",
      target: "claude",
      installedAt: "new",
      files: [{ path: ".claude/agents/code-reviewer.md", target: "claude", agentId: "code-reviewer", sha256: "hash" }]
    });

    expect(next.installs).toHaveLength(2);
    expect(next.installs.find((entry) => entry.packId === "starter-dev-pack")?.installedAt).toBe("new");
    expect(next.installs.find((entry) => entry.packId === "frontend-pack")?.installedAt).toBe("now");
  });

  it("creates bounded update history entries for rollback", () => {
    const install = {
      packId: "starter-dev-pack",
      packVersion: "0.1.0",
      target: "claude" as const,
      installedAt: "2026-01-01T00:00:00.000Z",
      files: [{ path: ".claude/agents/code-reviewer.md", target: "claude" as const, agentId: "code-reviewer", sha256: "old-hash" }]
    };

    const first = createUpdateHistoryEntry(
      install,
      [{ path: ".claude/agents/code-reviewer.md", target: "claude", agentId: "code-reviewer", sha256: "old-hash", content: "old" }],
      "0.2.0",
      new Date("2026-01-02T00:00:00.000Z")
    );

    expect(first.id).toBe("update-2026-01-02T00-00-00-000Z");
    expect(first.fromVersion).toBe("0.1.0");
    expect(first.toVersion).toBe("0.2.0");
    expect(first.previousInstall.files[0]?.sha256).toBe("old-hash");
    expect(first.previousInstall).not.toHaveProperty("history");

    let history = appendInstallHistory(install, first);
    for (let index = 0; index < 6; index += 1) {
      history = appendInstallHistory({ ...install, history }, createUpdateHistoryEntry(install, [], `0.${index}.0`, new Date(`2026-01-0${index + 3}T00:00:00.000Z`)));
    }

    expect(history).toHaveLength(5);
    const popped = popInstallHistory({ ...install, history });
    expect(popped.entry?.toVersion).toBe("0.5.0");
    expect(popped.remaining).toHaveLength(4);
  });
});
