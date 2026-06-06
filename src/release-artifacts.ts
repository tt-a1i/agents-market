import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { join, normalize, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

export interface ReleaseArtifactSignatureVerification {
  ok: true;
  keyId: string;
  algorithm: "ed25519";
}

export interface ReleaseArtifactVerificationReport {
  ok: true;
  dir: string;
  version: string;
  releaseTag?: string;
  artifactCount: number;
  signatures: {
    registry?: ReleaseArtifactSignatureVerification;
    catalog?: ReleaseArtifactSignatureVerification;
  };
  sbom: {
    format: string;
    packageCount: number;
  };
}

export async function verifyReleaseArtifactInput(input: string, options: { archive?: boolean } = {}): Promise<ReleaseArtifactVerificationReport> {
  const resolved = await resolveArtifactInput(input, options.archive);
  try {
    return await verifyReleaseArtifacts(resolved.root);
  } finally {
    if (resolved.cleanupDir) await rm(resolved.cleanupDir, { recursive: true, force: true });
  }
}

export async function verifyReleaseArtifacts(root: string): Promise<ReleaseArtifactVerificationReport> {
  const manifest = await readJson(join(root, "release-artifacts.json"), "release-artifacts.json");
  assert(typeof manifest.version === "string" && manifest.version.length > 0, "release-artifacts.json is missing version.");
  assert(Array.isArray(manifest.artifacts), "release-artifacts.json is missing artifacts array.");

  const sha256Sums = parseSha256Sums(await readText(join(root, "SHA256SUMS"), "SHA256SUMS"));
  const manifestPaths = new Set<string>();

  for (const artifact of manifest.artifacts) {
    assert(typeof artifact.path === "string" && artifact.path.length > 0, "Artifact is missing path.");
    assert(isSafeRelativePath(artifact.path), `Artifact path is not safe: ${artifact.path}`);
    assert(/^[a-f0-9]{64}$/.test(artifact.sha256), `Artifact has invalid sha256: ${artifact.path}`);
    assert(!manifestPaths.has(artifact.path), `Duplicate artifact path in manifest: ${artifact.path}`);
    manifestPaths.add(artifact.path);

    const actual = await sha256File(join(root, artifact.path), artifact.path);
    assert(actual === artifact.sha256, `Artifact checksum mismatch in manifest: ${artifact.path}`);
    assert(sha256Sums.get(artifact.path) === artifact.sha256, `SHA256SUMS mismatch or missing entry: ${artifact.path}`);
  }

  for (const path of sha256Sums.keys()) {
    assert(manifestPaths.has(path), `SHA256SUMS includes a file missing from release-artifacts.json: ${path}`);
  }

  const version = manifest.version;
  for (const required of [
    "registry.bundle.json",
    "catalog/index.html",
    "catalog/catalog.json",
    "catalog/favicon.svg",
    "catalog/registry.bundle.json",
    "catalog/robots.txt",
    "catalog/site.webmanifest",
    `agents-market-catalog-${version}.tgz`,
    `agents-market-claude-${version}.tgz`,
    `agents-market-codex-${version}.tgz`,
    `agents-market-opencode-${version}.tgz`,
    `npm/agents-market-cli-${version}.tgz`,
    "sbom.spdx.json",
    "install.sh"
  ]) {
    assert(manifestPaths.has(required), `Required release artifact is missing: ${required}`);
  }

  const registry = await readJson(join(root, "registry.bundle.json"), "registry.bundle.json");
  assert(registry.version === version, `Registry bundle version ${registry.version} does not match release version ${version}.`);
  assert(Array.isArray(registry.agents) && registry.agents.length > 0, "Registry bundle has no agents.");
  assert(Array.isArray(registry.packs) && registry.packs.length > 0, "Registry bundle has no packs.");
  const signatures: ReleaseArtifactVerificationReport["signatures"] = {};
  if (manifestPaths.has("registry-public.pem")) {
    signatures.registry = await verifyRegistryBundleSignature(registry, join(root, "registry-public.pem"), "registry.bundle.json");
  }

  const catalog = await readJson(join(root, "catalog", "catalog.json"), "catalog/catalog.json");
  assert(catalog.registryBundleUrl, "Catalog is missing registryBundleUrl.");
  assert(catalog.packCount === registry.packs.length, "Catalog packCount does not match registry bundle.");
  assert(catalog.agentCount === registry.agents.length, "Catalog agentCount does not match registry bundle.");
  assert(Array.isArray(catalog.packs) && catalog.packs.length === registry.packs.length, "Catalog packs do not match registry bundle.");
  assert(catalog.metadata?.packageSpec === manifest.packageSpec, "Catalog packageSpec metadata does not match release manifest.");

  const catalogHtml = await readText(join(root, "catalog", "index.html"), "catalog/index.html");
  assert(catalogHtml.includes('rel="manifest"') && catalogHtml.includes('href="site.webmanifest"'), "Catalog HTML does not reference site.webmanifest.");
  assert(catalogHtml.includes('rel="icon"') && catalogHtml.includes('href="favicon.svg"'), "Catalog HTML does not reference favicon.svg.");
  const catalogWebManifest = await readJson(join(root, "catalog", "site.webmanifest"), "catalog/site.webmanifest");
  assert(catalogWebManifest.name === catalog.title, "Catalog site.webmanifest name does not match catalog title.");
  assert(
    Array.isArray(catalogWebManifest.icons) && catalogWebManifest.icons.some((icon: { src?: string } | undefined) => icon?.src === "favicon.svg"),
    "Catalog site.webmanifest does not include favicon.svg."
  );
  const catalogRobots = await readText(join(root, "catalog", "robots.txt"), "catalog/robots.txt");
  assert(catalogRobots.includes("User-agent: *") && catalogRobots.includes("Allow: /"), "Catalog robots.txt does not allow indexing.");
  if (manifestPaths.has("catalog/registry-public.pem")) {
    const catalogRegistry = await readJson(join(root, "catalog", "registry.bundle.json"), "catalog/registry.bundle.json");
    signatures.catalog = await verifyRegistryBundleSignature(catalogRegistry, join(root, "catalog", "registry-public.pem"), "catalog/registry.bundle.json");
  }

  const sbom = await readJson(join(root, "sbom.spdx.json"), "sbom.spdx.json");
  assert(sbom.spdxVersion === "SPDX-2.3", `Expected SPDX-2.3 SBOM, found ${sbom.spdxVersion}.`);
  assert(sbom.name === `@agents-market/cli@${version}`, `SBOM name ${sbom.name} does not match release version ${version}.`);
  assert(Array.isArray(sbom.packages) && sbom.packages.length > 0, "SBOM has no package records.");

  return {
    ok: true,
    dir: root,
    version,
    releaseTag: manifest.releaseTag,
    artifactCount: manifest.artifacts.length,
    signatures,
    sbom: {
      format: sbom.spdxVersion,
      packageCount: sbom.packages.length
    }
  };
}

async function resolveArtifactInput(value: string, archive?: boolean): Promise<{ root: string; cleanupDir?: string }> {
  if (archive || value.endsWith(".tgz") || value.endsWith(".tar.gz")) {
    verifyArchiveEntries(value);
    const root = await mkdtemp(join(tmpdir(), "agents-market-release-verify-"));
    const result = spawnSync("tar", ["-xzf", value, "-C", root], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.status !== 0) {
      throw new Error(`Could not extract release artifact archive ${value}: ${result.stderr || result.stdout || result.status}`);
    }
    return { root, cleanupDir: root };
  }
  return { root: value };
}

function verifyArchiveEntries(value: string): void {
  const result = spawnSync("tar", ["-tzf", value], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`Could not inspect release artifact archive ${value}: ${result.stderr || result.stdout || result.status}`);
  }
  for (const entry of result.stdout.split(/\r?\n/)) {
    if (!entry) continue;
    assert(isSafeArchiveEntryPath(entry), `Release artifact archive contains an unsafe path: ${entry}`);
  }
}

async function readJson(path: string, label: string): Promise<any> {
  return JSON.parse(await readText(path, label));
}

async function readText(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function sha256File(path: string, label: string): Promise<string> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    throw new Error(`Could not hash ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyRegistryBundleSignature(bundle: any, publicKeyPath: string, label: string): Promise<ReleaseArtifactSignatureVerification> {
  const sha = registryBundleHash(bundle);
  assert(!bundle.sha256 || bundle.sha256 === sha, `${label} checksum does not match signed payload.`);
  assert(Array.isArray(bundle.signatures) && bundle.signatures.length > 0, `${label} has a public key but no signatures.`);

  const publicKeyPem = await readText(publicKeyPath, publicKeyPath);
  const publicKey = createPublicKey(publicKeyPem);
  for (const signature of bundle.signatures) {
    if (signature?.algorithm !== "ed25519") continue;
    assert(typeof signature.keyId === "string" && signature.keyId.length > 0, `${label} signature is missing keyId.`);
    assert(typeof signature.signature === "string" && signature.signature.length > 0, `${label} signature is missing signature bytes.`);
    const verified = cryptoVerify(null, registrySignaturePayload(sha), publicKey, Buffer.from(signature.signature, "base64"));
    if (verified) {
      return {
        ok: true,
        keyId: signature.keyId,
        algorithm: signature.algorithm
      };
    }
  }

  throw new Error(`${label} signature verification failed.`);
}

function registryBundleHash(bundle: any): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: bundle.schemaVersion,
        name: bundle.name,
        version: bundle.version,
        exportedAt: bundle.exportedAt,
        metadata: bundle.metadata,
        agents: bundle.agents,
        packs: bundle.packs,
        changelog: bundle.changelog
      })
    )
    .digest("hex");
}

function registrySignaturePayload(sha: string): Buffer {
  return Buffer.from(`agents-market-registry-v1\n${sha}`, "utf8");
}

function parseSha256Sums(input: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert(match, `Invalid SHA256SUMS line: ${line}`);
    const [, sha256, path] = match;
    assert(isSafeRelativePath(path), `SHA256SUMS path is not safe: ${path}`);
    assert(!entries.has(path), `Duplicate SHA256SUMS path: ${path}`);
    entries.set(path, sha256);
  }
  return entries;
}

function isSafeRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\0")) return false;
  const normalized = normalize(path);
  return normalized === path && !relative(".", normalized).startsWith("..");
}

function isSafeArchiveEntryPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\0") || path.includes("\\") || /^[A-Za-z]:\//.test(path)) return false;
  const cleaned = path.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!cleaned || cleaned === ".") return true;
  const normalized = normalize(cleaned);
  return normalized === cleaned && !relative(".", normalized).startsWith("..");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
