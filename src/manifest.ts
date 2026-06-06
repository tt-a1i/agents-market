import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256 } from "./hash.js";
import type { GeneratedPackFile } from "./install.js";
import type { InstallManifest, ManifestInstallEntry, Target } from "./types.js";

export const MANIFEST_PATH = ".agents-market/manifest.json";

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

export function upsertInstall(
  manifest: InstallManifest,
  packId: string,
  target: Target | "all",
  files: GeneratedPackFile[],
  now = new Date()
): InstallManifest {
  const nextEntry: ManifestInstallEntry = {
    packId,
    target,
    installedAt: now.toISOString(),
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
