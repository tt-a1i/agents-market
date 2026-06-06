import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const checks = [];

async function main() {
  run("npm", ["run", "lint"], "TypeScript typecheck");
  run("npm", ["run", "build"], "Build CLI");
  run("node", ["dist/index.js", "registry", "lint", "--strict"], "Registry quality lint");
  run("npm", ["test"], "Unit tests");

  const siteDir = await mkdtemp(join(tmpdir(), "agents-market-release-site-"));
  try {
    run("node", ["dist/index.js", "catalog", "build", "--out", siteDir], "Catalog build");
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }

  const pack = run("npm", ["pack", "--dry-run", "--json"], "Package dry run");
  verifyTarball(parseNpmPackJson(pack.stdout));

  console.log(`\nRelease check passed (${checks.length} checks).`);
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

function verifyTarball(packOutput) {
  const [tarball] = packOutput;
  if (!tarball?.files) {
    throw new Error("npm pack --json output did not include file metadata.");
  }
  const files = new Set(tarball.files.map((file) => file.path));
  const required = [
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/catalog.js",
    "dist/audit.js",
    "dist/doctor.js",
    "dist/pack.js",
    "registry/agents/code-reviewer.json",
    "registry/packs/starter-dev-pack.json",
    "docs/agent-native.md",
    "integrations/codex-skill/SKILL.md"
  ];
  const missing = required.filter((file) => !files.has(file));
  if (missing.length > 0) {
    throw new Error(`Package dry run is missing required files: ${missing.join(", ")}`);
  }
  checks.push("Package contents");
}

function parseNpmPackJson(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("npm pack --json output did not contain a JSON array.");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nRelease check failed: ${message}`);
  process.exitCode = 1;
});
