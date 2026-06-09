import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";
import { loadRegistry } from "../src/registry.js";
import { runRegisterWorkflow } from "../src/registration.js";

let cleanupPath: string | undefined;

afterEach(async () => {
  if (cleanupPath) {
    await rm(cleanupPath, { recursive: true, force: true });
    cleanupPath = undefined;
  }
});

describe("register workflow", () => {
  it("previews one selected agent without writing files", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-register-preview-"));

    const result = await runRegisterWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { kind: "bundled", value: "bundled" },
      agentId: "frontend-verifier",
      target: "codex",
      mode: "preview"
    });

    expect(result.installed).toBe(false);
    expect(result.ready).toBe(true);
    expect(result.agent.id).toBe("frontend-verifier");
    expect(result.agent.localName).toBe("frontend-verifier");
    expect(result.changeSummary).toEqual({ create: 1, update: 0, unchanged: 0, blocked: 0, total: 1 });
    expect(result.changes[0]?.path).toBe(".codex/agents/frontend-verifier.toml");
    await expect(readFile(join(cleanupPath, ".codex/agents/frontend-verifier.toml"), "utf8")).rejects.toThrow();
    await expect(readFile(join(cleanupPath, ".agents-market/manifest.json"), "utf8")).rejects.toThrow();
  });

  it("registers one selected agent and records an agent-level manifest entry", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-register-install-"));

    const result = await runRegisterWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { kind: "bundled", value: "bundled" },
      agentId: "frontend-verifier",
      target: "codex",
      mode: "install"
    });

    expect(result.installed).toBe(true);
    const generated = await readFile(join(cleanupPath, ".codex/agents/frontend-verifier.toml"), "utf8");
    expect(generated).toContain('name = "frontend-verifier"');
    expect(generated).toContain("developer_instructions");

    const manifest = JSON.parse(await readFile(join(cleanupPath, ".agents-market/manifest.json"), "utf8")) as {
      installs: unknown[];
      registeredAgents?: Array<{ agentId: string; localName: string; target: string; files: unknown[] }>;
    };
    expect(manifest.installs).toEqual([]);
    expect(manifest.registeredAgents).toHaveLength(1);
    expect(manifest.registeredAgents?.[0]).toMatchObject({
      agentId: "frontend-verifier",
      localName: "frontend-verifier",
      target: "codex"
    });
    expect(manifest.registeredAgents?.[0]?.files).toHaveLength(1);
  });

  it("supports project-local aliases", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-register-alias-"));

    const result = await runRegisterWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { kind: "bundled", value: "bundled" },
      agentId: "frontend-verifier",
      localName: "hive-frontend-verifier",
      target: "claude",
      mode: "install"
    });

    expect(result.installed).toBe(true);
    expect(result.changes[0]?.path).toBe(".claude/agents/hive-frontend-verifier.md");
    const generated = await readFile(join(cleanupPath, ".claude/agents/hive-frontend-verifier.md"), "utf8");
    expect(generated).toContain("name: hive-frontend-verifier");
  });

  it("injects explicit context references without embedding context body", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-register-context-"));
    await writeFile(join(cleanupPath, "AGENTS.md"), "Follow the Hive project rules.\n", "utf8");

    const result = await runRegisterWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { kind: "bundled", value: "bundled" },
      agentId: "frontend-verifier",
      target: "opencode",
      context: ["AGENTS.md"],
      mode: "install"
    });

    expect(result.contextReferences).toEqual([{ path: "AGENTS.md", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    const generated = await readFile(join(cleanupPath, ".opencode/agents/frontend-verifier.md"), "utf8");
    expect(generated).toContain("Before acting, read and follow these project-local references:");
    expect(generated).toContain("- AGENTS.md");
    expect(generated).not.toContain("Follow the Hive project rules.");
  });

  it("blocks unmanaged local file conflicts", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-register-conflict-"));
    await mkdir(join(cleanupPath, ".codex/agents"), { recursive: true });
    await writeFile(join(cleanupPath, ".codex/agents/frontend-verifier.toml"), "hand written\n", "utf8");

    const result = await runRegisterWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { kind: "bundled", value: "bundled" },
      agentId: "frontend-verifier",
      target: "codex",
      mode: "install"
    });

    expect(result.ready).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.changeSummary.blocked).toBe(1);
    expect(result.changes[0]?.reason).toBe("unmanaged-agent-file-conflict");
    await expect(readFile(join(cleanupPath, ".agents-market/manifest.json"), "utf8")).rejects.toThrow();
  });

  it("reports registered agents in doctor health checks", async () => {
    const registry = await loadRegistry();
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-register-doctor-"));

    await runRegisterWorkflow({
      root: cleanupPath,
      registry,
      registrySource: { kind: "bundled", value: "bundled" },
      agentId: "frontend-verifier",
      target: "codex",
      mode: "install"
    });

    const report = await runDoctor(cleanupPath);
    expect(report.registrationCount).toBe(1);
    expect(report.fileCounts.clean).toBe(1);
    expect(report.checks.some((check) => check.id === "registered-agents" && check.severity === "pass")).toBe(true);
    expect(report.checks.some((check) => check.id === "host-runtime" && check.severity === "warn")).toBe(true);
  });
});
