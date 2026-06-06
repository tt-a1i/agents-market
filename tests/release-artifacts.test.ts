import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReleaseArtifactInput, verifyReleaseArtifacts } from "../src/release-artifacts.js";
import { createRegistryBundle, loadRegistry, signRegistryBundle } from "../src/registry.js";
import type { RegistryBundle } from "../src/types.js";

let cleanupPath: string | undefined;

afterEach(async () => {
  if (cleanupPath) {
    await rm(cleanupPath, { recursive: true, force: true });
    cleanupPath = undefined;
  }
});

describe("release artifact verification", () => {
  it("verifies signed release artifact directories and complete archives", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-release-artifacts-test-"));
    const { dir, archive } = await writeSignedReleaseArtifacts(cleanupPath);

    const dirReport = await verifyReleaseArtifacts(dir);
    expect(dirReport.version).toBe("0.1.0");
    expect(dirReport.signatures.registry).toMatchObject({ ok: true, keyId: "test-key", algorithm: "ed25519" });
    expect(dirReport.signatures.catalog).toMatchObject({ ok: true, keyId: "test-key", algorithm: "ed25519" });

    const archiveReport = await verifyReleaseArtifactInput(archive, { archive: true });
    expect(archiveReport.ok).toBe(true);
    expect(archiveReport.artifactCount).toBe(dirReport.artifactCount);
    expect(archiveReport.signatures.registry?.keyId).toBe("test-key");
  });

  it("rejects signed release artifacts when the registry bundle signature is missing", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-release-artifacts-tamper-"));
    const { dir } = await writeSignedReleaseArtifacts(cleanupPath);
    const bundlePath = join(dir, "registry.bundle.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as RegistryBundle;
    await writeFile(bundlePath, `${JSON.stringify({ ...bundle, signatures: [] }, null, 2)}\n`, "utf8");
    await writeManifestAndChecksums(dir);

    await expect(verifyReleaseArtifacts(dir)).rejects.toThrow(/public key but no signatures/);
  });

  it("rejects complete archives with unsafe tar entry paths before extraction", async () => {
    cleanupPath = await mkdtemp(join(tmpdir(), "agents-market-release-artifacts-unsafe-"));
    const archive = join(cleanupPath, "unsafe.tgz");
    await writeFile(archive, gzipSync(createTarArchive([{ name: "../evil.txt", content: "nope\n" }])));

    await expect(verifyReleaseArtifactInput(archive, { archive: true })).rejects.toThrow(/unsafe path: \.\.\/evil\.txt/);
  });
});

async function writeSignedReleaseArtifacts(root: string): Promise<{ dir: string; archive: string }> {
  const dir = join(root, "release-artifacts");
  await mkdir(join(dir, "catalog"), { recursive: true });
  await mkdir(join(dir, "integration-packages"), { recursive: true });
  await mkdir(join(dir, "npm"), { recursive: true });

  const registry = await loadRegistry();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const bundle = signRegistryBundle(createRegistryBundle(registry, "0.1.0", "agents-market", { packageSpec: "github:tt-a1i/agents-market" }), privateKeyPem, "test-key");
  const catalogBundle = signRegistryBundle(createRegistryBundle(registry, "0.1.0", "agents-market", { packageSpec: "github:tt-a1i/agents-market" }), privateKeyPem, "test-key");

  await writeFile(join(dir, "registry.bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "registry-public.pem"), publicKeyPem, "utf8");
  await writeFile(join(dir, "catalog", "registry.bundle.json"), `${JSON.stringify(catalogBundle, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "catalog", "registry-public.pem"), publicKeyPem, "utf8");
  await writeFile(join(dir, "catalog", "index.html"), '<html><head><link rel="manifest" href="site.webmanifest"><link rel="icon" href="favicon.svg"></head></html>\n', "utf8");
  await writeFile(join(dir, "catalog", "catalog.json"), `${JSON.stringify({
    title: "Agents Market Test",
    registryBundleUrl: "https://example.com/registry.bundle.json",
    packCount: registry.packs.length,
    agentCount: registry.agents.length,
    packs: registry.packs.map((pack) => ({ id: pack.id })),
    metadata: { packageSpec: "github:tt-a1i/agents-market" }
  }, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "catalog", "favicon.svg"), "<svg />\n", "utf8");
  await writeFile(join(dir, "catalog", "robots.txt"), "User-agent: *\nAllow: /\n", "utf8");
  await writeFile(join(dir, "catalog", "site.webmanifest"), `${JSON.stringify({
    name: "Agents Market Test",
    icons: [{ src: "favicon.svg" }]
  }, null, 2)}\n`, "utf8");

  for (const file of [
    "agents-market-catalog-0.1.0.tgz",
    "agents-market-claude-0.1.0.tgz",
    "agents-market-codex-0.1.0.tgz",
    "agents-market-opencode-0.1.0.tgz",
    "npm/agents-market-cli-0.1.0.tgz",
    "install.sh"
  ]) {
    await writeFile(join(dir, file), `placeholder ${file}\n`, "utf8");
  }
  await writeFile(join(dir, "sbom.spdx.json"), `${JSON.stringify({
    spdxVersion: "SPDX-2.3",
    name: "@agents-market/cli@0.1.0",
    packages: [{ name: "@agents-market/cli" }]
  }, null, 2)}\n`, "utf8");

  await writeManifestAndChecksums(dir);
  const archive = join(root, "agents-market-release-artifacts-0.1.0.tgz");
  const result = spawnSync("tar", ["-czf", archive, "-C", dir, "."], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "tar failed");
  return { dir, archive };
}

async function writeManifestAndChecksums(dir: string): Promise<void> {
  const paths = [
    "agents-market-catalog-0.1.0.tgz",
    "agents-market-claude-0.1.0.tgz",
    "agents-market-codex-0.1.0.tgz",
    "agents-market-opencode-0.1.0.tgz",
    "catalog/catalog.json",
    "catalog/favicon.svg",
    "catalog/index.html",
    "catalog/registry-public.pem",
    "catalog/registry.bundle.json",
    "catalog/robots.txt",
    "catalog/site.webmanifest",
    "install.sh",
    "npm/agents-market-cli-0.1.0.tgz",
    "registry-public.pem",
    "registry.bundle.json",
    "sbom.spdx.json"
  ];
  const artifacts = [];
  for (const path of paths) {
    artifacts.push({ path, sha256: createHash("sha256").update(await readFile(join(dir, path))).digest("hex") });
  }
  await writeFile(join(dir, "release-artifacts.json"), `${JSON.stringify({
    version: "0.1.0",
    releaseTag: "preview-0.1.0",
    packageSpec: "github:tt-a1i/agents-market",
    artifacts
  }, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "SHA256SUMS"), `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join("\n")}\n`, "utf8");
}

function createTarArchive(entries: Array<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content, "utf8");
    const header = Buffer.alloc(512, 0);
    header.write(entry.name, 0, Math.min(Buffer.byteLength(entry.name), 100), "utf8");
    header.write("0000644\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, "ascii");
    header.fill(" ", 148, 156, "ascii");
    header.write("0", 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}
