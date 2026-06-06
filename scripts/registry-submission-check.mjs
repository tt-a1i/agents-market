import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const checks = [];

async function main() {
  const registrySource = "./registry";
  const lint = runJson(
    "node",
    ["dist/index.js", "registry", "lint", "--registry", registrySource, "--strict", "--json"],
    "Registry strict lint"
  );
  assert(lint.ok === true, "Registry strict lint failed.");
  assert(lint.score === 100, `Expected registry score 100, found ${lint.score}.`);

  const info = runJson("node", ["dist/index.js", "registry", "info", "--registry", registrySource, "--json"], "Registry inventory");
  assert(info.packCount > 0, "Registry must contain at least one pack.");
  assert(info.agentCount > 0, "Registry must contain at least one agent.");
  assert(info.targets?.claude === info.agentCount, "All published agents must support Claude Code.");
  assert(info.targets?.codex === info.agentCount, "All published agents must support Codex.");
  assert(info.targets?.opencode === info.agentCount, "All published agents must support OpenCode.");

  const previewRoot = await mkdtemp(join(tmpdir(), "agents-market-registry-gate-"));
  const siteDir = await mkdtemp(join(tmpdir(), "agents-market-registry-catalog-"));
  try {
    for (const pack of info.packs) {
      const audit = runJson(
        "node",
        ["dist/index.js", "audit", pack.id, "--registry", registrySource, "--target", "all", "--json"],
        `Audit ${pack.id}`
      );
      assert(audit.agentCount === pack.agentCount, `Audit agent count mismatch for ${pack.id}.`);
      assert(audit.fileCount >= pack.agentCount * 3, `Expected ${pack.id} to generate files for all targets.`);

      const preview = runJson(
        "node",
        [
          "dist/index.js",
          "apply",
          pack.id,
          "--registry",
          registrySource,
          "--target",
          "all",
          "--policy-preset",
          "balanced",
          "--cwd",
          previewRoot,
          "--json"
        ],
        `Apply preview ${pack.id}`
      );
      assert(preview.installed === false, `Apply preview should not install ${pack.id}.`);
      assert(preview.policy?.ok === true, `Balanced policy should pass for ${pack.id}.`);
      assert(preview.changes?.length === audit.fileCount, `Apply preview file count mismatch for ${pack.id}.`);
    }

    run(
      "node",
      ["dist/index.js", "catalog", "build", "--registry", registrySource, "--out", siteDir, "--base-url", "https://example.com/agents-market"],
      "Registry catalog build"
    );
    const catalog = runJson("node", ["dist/index.js", "catalog", "verify", "--dir", siteDir, "--json"], "Registry catalog verify");
    assert(catalog.ok === true, "Registry catalog verification failed.");
  } finally {
    await rm(previewRoot, { recursive: true, force: true });
    await rm(siteDir, { recursive: true, force: true });
  }

  console.log(`\nRegistry submission check passed (${checks.length} checks).`);
}

function run(command, args, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  checks.push(label);
  return result;
}

function runJson(command, args, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  try {
    const json = JSON.parse(result.stdout);
    console.log(formatJsonSummary(label, json));
    checks.push(label);
    return json;
  } catch (error) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} did not return valid JSON: ${message}`);
  }
}

function formatJsonSummary(label, json) {
  if (label.includes("lint")) {
    return `ok=${json.ok} score=${json.score} errors=${json.errorCount} warnings=${json.warningCount}`;
  }
  if (label.includes("inventory")) {
    return `packs=${json.packCount} agents=${json.agentCount} targets=claude:${json.targets?.claude} codex:${json.targets?.codex} opencode:${json.targets?.opencode}`;
  }
  if (label.startsWith("Audit ")) {
    return `pack=${json.packId} risk=${json.risk} agents=${json.agentCount} files=${json.fileCount} warnings=${json.warnings?.length ?? 0}`;
  }
  if (label.startsWith("Apply preview ")) {
    return `pack=${json.pack?.id} installed=${json.installed} policy=${json.policy?.ok} changes=${json.changes?.length ?? 0}`;
  }
  if (label.includes("catalog verify")) {
    return `ok=${json.ok} errors=${json.errorCount} warnings=${json.warningCount}`;
  }
  return "ok";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nRegistry submission check failed: ${message}`);
  process.exitCode = 1;
});
