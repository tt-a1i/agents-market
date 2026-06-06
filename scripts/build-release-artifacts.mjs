import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const outDir = args.out ?? "release-artifacts";
const catalogBaseUrl = args.catalogBaseUrl ?? "https://tt-a1i.github.io/agents-market";
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const artifactManifest = {
  version,
  catalogBaseUrl,
  generatedAt: new Date().toISOString(),
  artifacts: []
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

run("node", ["dist/index.js", "registry", "export", "--out", join(outDir, "registry.bundle.json"), "--bundle-version", version], "Export registry bundle");
run("node", ["dist/index.js", "registry", "verify", "--registry", join(outDir, "registry.bundle.json"), "--json"], "Verify registry bundle");
run(
  "node",
  ["dist/index.js", "catalog", "build", "--out", join(outDir, "catalog"), "--title", "Agents Market", "--base-url", catalogBaseUrl],
  "Build catalog"
);
run("node", ["dist/index.js", "catalog", "verify", "--dir", join(outDir, "catalog"), "--json"], "Verify catalog");
run("node", ["dist/index.js", "integrations", "package", "--target", "all", "--out", join(outDir, "integration-packages")], "Build integrations");

for (const packageDir of ["agents-market-claude", "agents-market-codex", "agents-market-opencode"]) {
  run(
    "tar",
    ["-czf", join(outDir, `${packageDir}-${version}.tgz`), "-C", join(outDir, "integration-packages"), packageDir],
    `Archive ${packageDir}`
  );
}

await mkdir(join(outDir, "npm"), { recursive: true });
run("npm", ["pack", "--pack-destination", join(outDir, "npm"), "--json"], "Pack npm tarball");

const files = await listFiles(outDir);
for (const file of files.filter((file) => !file.endsWith("SHA256SUMS") && !file.endsWith("release-artifacts.json")).sort()) {
  const sha256 = createHash("sha256").update(await readFile(file)).digest("hex");
  const path = relative(outDir, file);
  artifactManifest.artifacts.push({ path, sha256 });
}

await writeFile(
  join(outDir, "SHA256SUMS"),
  `${artifactManifest.artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join("\n")}\n`,
  "utf8"
);
await writeFile(join(outDir, "release-artifacts.json"), `${JSON.stringify(artifactManifest, null, 2)}\n`, "utf8");
console.log(`Built ${artifactManifest.artifacts.length} release artifact files in ${outDir}`);

function run(command, commandArgs, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--out") {
      parsed.out = values[++index];
    } else if (value === "--catalog-base-url") {
      parsed.catalogBaseUrl = values[++index];
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}
