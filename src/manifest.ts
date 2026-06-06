import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256 } from "./hash.js";
import type { GeneratedPackFile } from "./install.js";
import type { InstallManifest, ManifestInstallEntry, RegistryLock, Target } from "./types.js";

export const MANIFEST_PATH = ".agents-market/manifest.json";
export const REGISTRY_LOCK_PATH = ".agents-market/registry-lock.json";

export async function loadManifest(root: string): Promise<InstallManifest> {
  try {
    const raw = await readFile(join(root, MANIFEST_PATH), "utf8");
    return JSON.parse(raw) as InstallManifest;
  } catch {
    return { schemaVersion: 1, installs: [] };
  }
}

export async function saveManifest(root: string, manifest: InstallManifest): Promise<void> {
  const path = join(root, MANIFEST_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function loadRegistryLock(root: string): Promise<RegistryLock | undefined> {
  try {
    const raw = await readFile(join(root, REGISTRY_LOCK_PATH), "utf8");
    return JSON.parse(raw) as RegistryLock;
  } catch {
    return undefined;
  }
}

export async function saveRegistryLock(root: string, lock: RegistryLock): Promise<void> {
  const path = join(root, REGISTRY_LOCK_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export function upsertInstall(
  manifest: InstallManifest,
  packId: string,
  target: Target | "all",
  files: GeneratedPackFile[],
  now = new Date(),
  registry?: ManifestInstallEntry["registry"],
  packVersion?: string
): InstallManifest {
  const nextEntry: ManifestInstallEntry = {
    packId,
    packVersion,
    target,
    installedAt: now.toISOString(),
    registry,
    files: files.map((file) => ({
      path: file.path,
      target: file.target,
      agentId: file.agent.id,
      sha256: sha256(file.content)
    }))
  };

  return {
    schemaVersion: 1,
    installs: [
      ...manifest.installs.filter((entry) => !(entry.packId === packId && entry.target === target)),
      nextEntry
    ]
  };
}

export function upsertInstallEntry(manifest: InstallManifest, entry: ManifestInstallEntry): InstallManifest {
  return {
    schemaVersion: 1,
    installs: [
      ...manifest.installs.filter((candidate) => !(candidate.packId === entry.packId && candidate.target === entry.target)),
      entry
    ]
  };
}

export function removeInstall(manifest: InstallManifest, packId: string, target?: Target | "all"): InstallManifest {
  return {
    schemaVersion: 1,
    installs: manifest.installs.filter((entry) => {
      if (entry.packId !== packId) return true;
      if (!target) return false;
      return entry.target !== target;
    })
  };
}
