import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { importMarkdownAgent, importMarkdownDirectory, parseMarkdownAgent } from "../src/importer.js";
import { sha256 } from "../src/hash.js";

let cleanupPath: string | undefined;

afterEach(async () => {
  if (cleanupPath) {
    await rm(cleanupPath, { recursive: true, force: true });
    cleanupPath = undefined;
  }
});

describe("markdown agent importer", () => {
  it("parses frontmatter and body", () => {
    const parsed = parseMarkdownAgent(`---
name: code-reviewer
description: Reviews code carefully for test gaps and security issues
tools: Read, Grep, Bash
---

You are a reviewer.
`);

    expect(parsed.frontmatter.name).toBe("code-reviewer");
    expect(parsed.frontmatter.tools).toEqual(["Read", "Grep", "Bash"]);
    expect(parsed.body).toContain("You are a reviewer.");
  });

  it("imports Claude markdown agents", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-import-"));
    const source = join(cleanupPath, "reviewer.md");
    const sourceContent = `---
name: code-reviewer
description: Reviews code carefully for test gaps, security issues, regressions, and maintainability.
tools: Read, Grep, Bash
model: inherit
---

You are a senior code reviewer. Return concise findings with file paths and suggested fixes.
`;
    await writeFile(source, sourceContent, "utf8");

    const agent = await importMarkdownAgent({
      sourcePath: source,
      target: "claude",
      provenance: {
        source: "https://example.com/code-reviewer.md",
        repository: "example/agents",
        license: "MIT"
      }
    });
    expect(agent.id).toBe("code-reviewer");
    expect(agent.permission).toBe("command");
    expect(agent.model?.claude).toBe("inherit");
    expect(agent.recommendedTargets).toEqual(["claude"]);
    expect(agent.provenance?.repository).toBe("example/agents");
    expect(agent.provenance?.sourceSha256).toBe(sha256(sourceContent));
  });

  it("imports OpenCode permission objects and writes JSON", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-import-"));
    const source = join(cleanupPath, "accessibility.md");
    const outDir = join(cleanupPath, "agents");
    await writeFile(
      source,
      `---
description: Audits UI changes for labels, keyboard behavior, semantic structure, and contrast.
mode: subagent
permission:
  edit: deny
  write: deny
---

You are an accessibility auditor. Return issues with impact, file references, and concise remediation.
`,
      "utf8"
    );

    const agent = await importMarkdownAgent({ sourcePath: source, target: "opencode", outDir });
    expect(agent.id).toBe("accessibility");
    expect(agent.permission).toBe("readonly");
    const written = JSON.parse(await readFile(join(outDir, "accessibility.json"), "utf8")) as { id: string };
    expect(written.id).toBe("accessibility");
  });

  it("imports directories and creates packs", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-import-"));
    const sourceDir = join(cleanupPath, "source");
    const agentsDir = join(cleanupPath, "registry", "agents");
    const packsDir = join(cleanupPath, "registry", "packs");
    await writeFileWithDir(
      join(sourceDir, "reviewer.md"),
      `---
name: code-reviewer
description: Reviews code carefully for test gaps, security issues, regressions, and maintainability.
tools: Read, Grep
---

You are a senior code reviewer. Return concise findings with file paths and suggested fixes.
`
    );
    await writeFileWithDir(
      join(sourceDir, "nested", "debugger.md"),
      `---
name: debugger
description: Investigates failing tests, runtime errors, stack traces, and suspicious behavior with root cause focus.
tools: Read, Grep, Bash
---

You are a debugging specialist. Find the smallest credible root cause and explain the fix.
`
    );

    const result = await importMarkdownDirectory({
      sourceDir,
      target: "claude",
      outDir: agentsDir,
      provenance: {
        repository: "example/community-agents",
        license: "MIT"
      },
      pack: {
        id: "imported-pack",
        outDir: packsDir
      }
    });

    expect(result.imported.map((agent) => agent.id).sort()).toEqual(["code-reviewer", "debugger"]);
    expect(result.imported.every((agent) => agent.provenance?.sourceSha256?.length === 64)).toBe(true);
    expect(result.pack?.agents.sort()).toEqual(["code-reviewer", "debugger"]);
    const pack = JSON.parse(await readFile(join(packsDir, "imported-pack.json"), "utf8")) as { agents: string[]; requires?: { agentsMarket?: string } };
    expect(pack.agents).toHaveLength(2);
    expect(pack.requires?.agentsMarket).toBe(">=0.1.0");
  });
});

async function writeFileWithDir(path: string, content: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
