import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const cli = "src/index.ts";

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
});
