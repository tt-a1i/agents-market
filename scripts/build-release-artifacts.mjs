import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const outDir = args.out ?? "release-artifacts";
const catalogBaseUrl = args.catalogBaseUrl ?? "https://tt-a1i.github.io/agents-market";
const packageSpec = args.packageSpec ?? "github:tt-a1i/agents-market";
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const defaultReleaseTag = args.releaseTag ?? `v${version}`;
const repositoryUrl = args.repository ?? normalizeRepositoryUrl(packageJson.repository?.url) ?? "https://github.com/tt-a1i/agents-market";
const homepageUrl = args.homepage ?? packageJson.homepage ?? catalogBaseUrl;
const releaseUrl = args.releaseUrl ?? `${repositoryUrl.replace(/\/+$/, "")}/releases/tag/${defaultReleaseTag}`;
const commit = args.commit ?? gitCommit();
const signingPrivateKey = args.privateKey;
const signingPublicKey = args.publicKey;
const signingKeyId = args.keyId;
const artifactManifest = {
  version,
  catalogBaseUrl,
  packageSpec,
  homepageUrl,
  repositoryUrl,
  releaseUrl,
  commit,
  releaseTag: defaultReleaseTag,
  generatedAt: new Date().toISOString(),
  artifacts: []
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

run(
  "node",
  [
    "dist/index.js",
    "registry",
    "export",
    "--out",
    join(outDir, "registry.bundle.json"),
    "--bundle-version",
    version,
    "--homepage",
    homepageUrl,
    "--repository",
    repositoryUrl,
    "--catalog-url",
    catalogBaseUrl,
    "--release-url",
    releaseUrl,
    "--package",
    packageSpec,
    ...(commit ? ["--commit", commit] : []),
    ...(signingPrivateKey ? ["--private-key", signingPrivateKey, "--key-id", requireKeyId(signingKeyId)] : [])
  ],
  "Export registry bundle"
);
if (signingPublicKey) {
  await copyFile(signingPublicKey, join(outDir, "registry-public.pem"));
}
run(
  "node",
  [
    "dist/index.js",
    "registry",
    "verify",
    "--registry",
    join(outDir, "registry.bundle.json"),
    ...(signingPublicKey ? ["--public-key", signingPublicKey, ...(signingKeyId ? ["--key-id", signingKeyId] : [])] : []),
    "--json"
  ],
  "Verify registry bundle"
);
run(
  "node",
  [
    "dist/index.js",
    "catalog",
    "build",
    "--out",
    join(outDir, "catalog"),
    "--title",
    "Agents Market",
    "--base-url",
    catalogBaseUrl,
    "--package",
    packageSpec,
    "--homepage",
    homepageUrl,
    "--repository",
    repositoryUrl,
    "--release-url",
    releaseUrl,
    ...(commit ? ["--commit", commit] : []),
    ...(signingPrivateKey ? ["--private-key", signingPrivateKey, "--key-id", requireKeyId(signingKeyId)] : []),
    ...(signingPublicKey ? ["--public-key", signingPublicKey] : [])
  ],
  "Build catalog"
);
run("node", ["dist/index.js", "catalog", "verify", "--dir", join(outDir, "catalog"), "--json"], "Verify catalog");
run(
  "tar",
  ["-czf", join(outDir, `agents-market-catalog-${version}.tgz`), "-C", outDir, "catalog"],
  "Archive catalog"
);
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
const sbom = capture("npm", ["sbom", "--sbom-format", "spdx", "--json"], "Generate SPDX SBOM");
await writeFile(join(outDir, "sbom.spdx.json"), `${JSON.stringify(JSON.parse(sbom.stdout), null, 2)}\n`, "utf8");
await writeFile(join(outDir, "install.sh"), installScript(version, defaultReleaseTag), { encoding: "utf8", mode: 0o755 });

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
run(
  "tar",
  ["-czf", join(outDir, `agents-market-release-artifacts-${version}.tgz`), "-C", outDir, ...releaseArchiveEntries(signingPublicKey)],
  "Archive complete release artifacts"
);
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
  return result;
}

function capture(command, commandArgs, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result;
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
    } else if (value === "--release-tag") {
      parsed.releaseTag = values[++index];
    } else if (value === "--package") {
      parsed.packageSpec = values[++index];
    } else if (value === "--homepage") {
      parsed.homepage = values[++index];
    } else if (value === "--repository") {
      parsed.repository = values[++index];
    } else if (value === "--release-url") {
      parsed.releaseUrl = values[++index];
    } else if (value === "--commit") {
      parsed.commit = values[++index];
    } else if (value === "--private-key") {
      parsed.privateKey = values[++index];
    } else if (value === "--public-key") {
      parsed.publicKey = values[++index];
    } else if (value === "--key-id") {
      parsed.keyId = values[++index];
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

function requireKeyId(value) {
  if (!value) throw new Error("--key-id is required when --private-key is provided.");
  return value;
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

function normalizeRepositoryUrl(value) {
  if (!value || typeof value !== "string") return undefined;
  return value.replace(/^git\+/, "").replace(/\.git$/, "");
}

function releaseArchiveEntries(includePublicKey) {
  return [
    "registry.bundle.json",
    ...(includePublicKey ? ["registry-public.pem"] : []),
    "catalog",
    "integration-packages",
    "npm",
    "sbom.spdx.json",
    "install.sh",
    "SHA256SUMS",
    "release-artifacts.json",
    `agents-market-catalog-${version}.tgz`,
    `agents-market-claude-${version}.tgz`,
    `agents-market-codex-${version}.tgz`,
    `agents-market-opencode-${version}.tgz`
  ];
}

function installScript(version, releaseTag) {
  return `#!/usr/bin/env sh
set -eu

VERSION="\${AGENTS_MARKET_VERSION:-${version}}"
TAG="\${AGENTS_MARKET_TAG:-${releaseTag}}"
REPO="\${AGENTS_MARKET_REPO:-tt-a1i/agents-market}"
BASE_URL="https://github.com/\${REPO}/releases/download/\${TAG}"
TARBALL="agents-market-cli-\${VERSION}.tgz"
TMP_DIR="\${TMPDIR:-/tmp}/agents-market-install-\$\$"

cleanup() {
  rm -rf "\${TMP_DIR}"
}
trap cleanup EXIT INT TERM

if ! command -v curl >/dev/null 2>&1; then
  echo "Install requires curl." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Install requires npm." >&2
  exit 1
fi

mkdir -p "\${TMP_DIR}"
curl -fsSL "\${BASE_URL}/SHA256SUMS" -o "\${TMP_DIR}/SHA256SUMS"
curl -fsSL "\${BASE_URL}/\${TARBALL}" -o "\${TMP_DIR}/\${TARBALL}"

if [ "\${AGENTS_MARKET_REQUIRE_ATTESTATION:-0}" = "1" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "AGENTS_MARKET_REQUIRE_ATTESTATION=1 requires GitHub CLI (gh)." >&2
    exit 1
  fi
  gh attestation verify "\${TMP_DIR}/SHA256SUMS" --repo "\${REPO}"
  gh attestation verify "\${TMP_DIR}/\${TARBALL}" --repo "\${REPO}"
fi

EXPECTED_SHA="$(awk -v file="npm/\${TARBALL}" '$2 == file { print $1 }' "\${TMP_DIR}/SHA256SUMS")"
if [ -z "\${EXPECTED_SHA}" ]; then
  echo "Could not find checksum for npm/\${TARBALL}" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "\${TMP_DIR}/\${TARBALL}" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "\${TMP_DIR}/\${TARBALL}" | awk '{ print $1 }')"
else
  echo "Install requires sha256sum or shasum." >&2
  exit 1
fi

if [ "\${EXPECTED_SHA}" != "\${ACTUAL_SHA}" ]; then
  echo "Checksum mismatch for \${TARBALL}" >&2
  echo "expected: \${EXPECTED_SHA}" >&2
  echo "actual:   \${ACTUAL_SHA}" >&2
  exit 1
fi

npm install -g "\${TMP_DIR}/\${TARBALL}"
agents-market --version
`;
}
