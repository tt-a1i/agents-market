import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { importMarkdownAgent, parseMarkdownAgent } from "../src/importer.js";

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
    await writeFile(
      source,
      `---
name: code-reviewer
description: Reviews code carefully for test gaps, security issues, regressions, and maintainability.
tools: Read, Grep, Bash
model: inherit
---

You are a senior code reviewer. Return concise findings with file paths and suggested fixes.
`,
      "utf8"
    );

    const agent = await importMarkdownAgent({ sourcePath: source, target: "claude" });
    expect(agent.id).toBe("code-reviewer");
    expect(agent.permission).toBe("command");
    expect(agent.model?.claude).toBe("inherit");
    expect(agent.recommendedTargets).toEqual(["claude"]);
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
});
