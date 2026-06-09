import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const cli = "src/index.ts";
let cleanupPath: string | undefined;

afterEach(async () => {
  if (cleanupPath) {
    await rm(cleanupPath, { recursive: true, force: true });
    cleanupPath = undefined;
  }
});

function runCli(args: string[]) {
  return spawnSync("npx", ["tsx", cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function parseJson(stdout: string): Record<string, unknown> {
  expect(stdout.trim()).not.toBe("");
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("CLI JSON contract", () => {
  it("prints structured JSON errors when --json commands fail", () => {
    const result = runCli(["apply", "nonexistent-pack", "--target", "all", "--json"]);
    const body = parseJson(result.stdout);

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("");
    expect(body.schemaVersion).toBe(1);
    expect(body.ok).toBe(false);
    expect(body.error).toMatchObject({
      code: "PACK_NOT_FOUND",
      message: "Unknown pack: nonexistent-pack"
    });
    expect(JSON.stringify(body.error)).toContain("agents-market list --json");
  });

  it("omits prompt bodies from list --agents --json by default", () => {
    const result = runCli(["list", "--agents", "--json", "--limit", "3"]);
    const body = parseJson(result.stdout) as { agents?: Array<Record<string, unknown>> };

    expect(result.status).toBe(0);
    expect(body.schemaVersion).toBe(1);
    expect(body.agentDetail).toBe("summary");
    expect(body.agents).toHaveLength(3);
    expect(body.agents?.every((agent) => !("prompt" in agent))).toBe(true);
  });

  it("includes prompt bodies only when list --agents --json --full is requested", () => {
    const result = runCli(["list", "--agents", "--json", "--full", "--limit", "1", "--fields", "id,prompt"]);
    const body = parseJson(result.stdout) as { agents?: Array<Record<string, unknown>> };

    expect(result.status).toBe(0);
    expect(body.schemaVersion).toBe(1);
    expect(body.agentDetail).toBe("full");
    expect(body.agents).toHaveLength(1);
    expect(typeof body.agents?.[0]?.id).toBe("string");
    expect(typeof body.agents?.[0]?.prompt).toBe("string");
    expect(Object.keys(body.agents?.[0] ?? {}).sort()).toEqual(["id", "prompt"]);
  });

  it("filters list by tier and includes tier fields", () => {
    const result = runCli(["list", "--tier", "core", "--agents", "--json"]);
    const body = parseJson(result.stdout) as {
      tier?: string;
      packs?: Array<Record<string, unknown>>;
      agents?: Array<Record<string, unknown>>;
    };

    expect(result.status).toBe(0);
    expect(body.tier).toBe("core");
    expect(body.packs?.length).toBeGreaterThan(0);
    expect(body.packs?.every((pack) => pack.tier === "core")).toBe(true);
    expect(body.agents?.every((agent) => agent.tier === "core")).toBe(true);
  });

  it("rejects invalid tier values with a structured error", () => {
    const result = runCli(["list", "--tier", "premium", "--json"]);
    const body = parseJson(result.stdout);

    expect(result.status).toBe(1);
    expect(body.ok).toBe(false);
    expect((body.error as Record<string, unknown>).code).toBe("INVALID_TIER");
  });

  it("returns lightweight agent info by default", () => {
    const result = runCli(["agent", "info", "frontend-verifier", "--json"]);
    const body = parseJson(result.stdout) as { agent?: Record<string, unknown>; agentDetail?: string };

    expect(result.status).toBe(0);
    expect(body.schemaVersion).toBe(1);
    expect(body.agentDetail).toBe("summary");
    expect(body.agent?.id).toBe("frontend-verifier");
    expect(body.agent).not.toHaveProperty("prompt");
  });

  it("includes prompt bodies only when agent info --full is requested", () => {
    const result = runCli(["agent", "info", "frontend-verifier", "--full", "--json"]);
    const body = parseJson(result.stdout) as { agent?: Record<string, unknown>; agentDetail?: string };

    expect(result.status).toBe(0);
    expect(body.agentDetail).toBe("full");
    expect(typeof body.agent?.prompt).toBe("string");
  });

  it("previews register without writing files", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-cli-register-preview-"));
    const result = runCli(["register", "--agent", "frontend-verifier", "--target", "codex", "--cwd", cleanupPath, "--json"]);
    const body = parseJson(result.stdout) as { operation?: string; dryRun?: boolean; installed?: boolean; changes?: Array<Record<string, unknown>> };

    expect(result.status).toBe(0);
    expect(body.schemaVersion).toBe(1);
    expect(body.operation).toBe("register");
    expect(body.dryRun).toBe(true);
    expect(body.installed).toBe(false);
    expect(body.changes?.[0]?.path).toBe(".codex/agents/frontend-verifier.toml");
    await expect(readFile(join(cleanupPath, ".codex/agents/frontend-verifier.toml"), "utf8")).rejects.toThrow();
  });

  it("registers one agent after explicit confirmation", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-cli-register-install-"));
    const result = runCli(["register", "--agent", "frontend-verifier", "--target", "codex", "--cwd", cleanupPath, "--yes", "--json"]);
    const body = parseJson(result.stdout) as { operation?: string; installed?: boolean };

    expect(result.status).toBe(0);
    expect(body.operation).toBe("register");
    expect(body.installed).toBe(true);
    const generated = await readFile(join(cleanupPath, ".codex/agents/frontend-verifier.toml"), "utf8");
    expect(generated).toContain('name = "frontend-verifier"');
  });

  it("returns structured register conflicts for unmanaged files", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-cli-register-conflict-"));
    await mkdir(join(cleanupPath, ".codex/agents"), { recursive: true });
    await writeFile(join(cleanupPath, ".codex/agents/frontend-verifier.toml"), "hand written\n", "utf8");

    const result = runCli(["register", "--agent", "frontend-verifier", "--target", "codex", "--cwd", cleanupPath, "--json"]);
    const body = parseJson(result.stdout) as { ok?: boolean; error?: Record<string, unknown> };

    expect(result.status).toBe(1);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("UNMANAGED_AGENT_CONFLICT");
    expect(JSON.stringify(body.error)).toContain("--name");
  });
});
