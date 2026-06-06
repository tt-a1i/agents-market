import { sha256 } from "./hash.js";
import { generatePackFiles } from "./install.js";
import { upsertInstallEntry } from "./manifest.js";
import type { GeneratedFile, InstallManifest, ManifestFileEntry, ManifestInstallEntry, Registry, Target } from "./types.js";

export type ResolveStrategy = "accept-registry" | "keep-local" | "forget";

export type ResolveState = "clean" | "modified" | "missing" | "untracked" | "blocked";

export type ResolveAction =
  | "write-registry"
  | "record-local"
  | "forget"
  | "unchanged"
  | "skip-clean"
  | "skip-missing"
  | "skip-untracked"
  | "skip-no-registry";

export interface ResolveChange {
  path: string;
  target?: Target;
  agentId?: string;
  state: ResolveState;
  action: ResolveAction;
  sha256?: string;
  expectedSha256?: string;
  currentSha256?: string;
}

export interface ResolveInstallSummary {
  packId: string;
  target: Target | "all";
  changes: ResolveChange[];
}

export interface ResolvePlan {
  strategy: ResolveStrategy;
  dryRun: boolean;
  written: number;
  recorded: number;
  forgotten: number;
  skipped: number;
  installs: ResolveInstallSummary[];
  manifest: InstallManifest;
  filesToWrite: GeneratedFile[];
}

export interface ResolveOptions {
  manifest: InstallManifest;
  registry?: Registry;
  expectedFilesForInstall?: (install: ManifestInstallEntry) => Promise<Array<GeneratedFile & { target: Target; agent: { id: string } }>>;
  strategy: ResolveStrategy;
  dryRun: boolean;
  packId?: string;
  target?: Target | "all";
  paths?: string[];
  readCurrent: (path: string) => Promise<string | undefined>;
}

export async function planManifestResolution(options: ResolveOptions): Promise<ResolvePlan> {
  const pathFilter = new Set(options.paths ?? []);
  let nextManifest = options.manifest;
  const summaries: ResolveInstallSummary[] = [];
  const filesToWrite: GeneratedFile[] = [];
  let written = 0;
  let recorded = 0;
  let forgotten = 0;
  let skipped = 0;

  const installs = options.manifest.installs.filter((install) => {
    if (options.packId && install.packId !== options.packId) return false;
    if (options.target && options.target !== "all" && install.target !== options.target) return false;
    return true;
  });

  for (const install of installs) {
    const expectedFiles = options.expectedFilesForInstall
      ? await options.expectedFilesForInstall(install)
      : options.registry
        ? generatePackFiles(options.registry, install.packId, install.target)
        : [];
    const expectedByPath = new Map(expectedFiles.map((file) => [file.path, file]));
    const remainingFiles: ManifestFileEntry[] = [];
    const changes: ResolveChange[] = [];

    for (const file of install.files) {
      if (pathFilter.size > 0 && !pathFilter.has(file.path)) {
        remainingFiles.push(file);
        continue;
      }

      const current = await options.readCurrent(file.path);
      const currentSha256 = current === undefined ? undefined : sha256(current);
      const state: ResolveState = current === undefined ? "missing" : currentSha256 === file.sha256 ? "clean" : "modified";
      const expected = expectedByPath.get(file.path);

      if (state === "clean") {
        remainingFiles.push(file);
        skipped += 1;
        changes.push({
          path: file.path,
          target: file.target,
          agentId: file.agentId,
          state,
          action: "skip-clean",
          sha256: file.sha256,
          currentSha256,
          expectedSha256: expected ? sha256(expected.content) : undefined
        });
        continue;
      }

      if (options.strategy === "accept-registry") {
        if (!expected) {
          remainingFiles.push(file);
          skipped += 1;
          changes.push({
            path: file.path,
            target: file.target,
            agentId: file.agentId,
            state: "blocked",
            action: "skip-no-registry",
            sha256: file.sha256,
            currentSha256
          });
          continue;
        }
        const nextFile = {
          path: expected.path,
          target: expected.target,
          agentId: expected.agent.id,
          sha256: sha256(expected.content)
        };
        remainingFiles.push(nextFile);
        filesToWrite.push({ path: expected.path, content: expected.content });
        written += 1;
        changes.push({
          path: expected.path,
          target: expected.target,
          agentId: expected.agent.id,
          state,
          action: "write-registry",
          sha256: nextFile.sha256,
          currentSha256,
          expectedSha256: nextFile.sha256
        });
        continue;
      }

      if (options.strategy === "keep-local") {
        if (current === undefined || currentSha256 === undefined) {
          remainingFiles.push(file);
          skipped += 1;
          changes.push({
            path: file.path,
            target: file.target,
            agentId: file.agentId,
            state,
            action: "skip-missing",
            sha256: file.sha256
          });
          continue;
        }
        const nextFile = { ...file, sha256: currentSha256 };
        remainingFiles.push(nextFile);
        recorded += 1;
        changes.push({
          path: file.path,
          target: file.target,
          agentId: file.agentId,
          state,
          action: "record-local",
          sha256: currentSha256,
          currentSha256,
          expectedSha256: expected ? sha256(expected.content) : undefined
        });
        continue;
      }

      forgotten += 1;
      changes.push({
        path: file.path,
        target: file.target,
        agentId: file.agentId,
        state,
        action: "forget",
        sha256: file.sha256,
        currentSha256,
        expectedSha256: expected ? sha256(expected.content) : undefined
      });
    }

    if (changes.length === 0) continue;
    summaries.push({ packId: install.packId, target: install.target, changes });

    if (!options.dryRun) {
      nextManifest = replaceInstallFiles(nextManifest, install, remainingFiles);
    }
  }

  for (const requestedPath of pathFilter) {
    const matched = summaries.some((summary) => summary.changes.some((change) => change.path === requestedPath));
    if (!matched) {
      skipped += 1;
      summaries.push({
        packId: options.packId ?? "*",
        target: options.target ?? "all",
        changes: [{ path: requestedPath, state: "untracked", action: "skip-untracked" }]
      });
    }
  }

  return {
    strategy: options.strategy,
    dryRun: options.dryRun,
    written,
    recorded,
    forgotten,
    skipped,
    installs: summaries,
    manifest: nextManifest,
    filesToWrite
  };
}

function replaceInstallFiles(manifest: InstallManifest, install: ManifestInstallEntry, files: ManifestFileEntry[]): InstallManifest {
  const withoutInstall = {
    schemaVersion: 1 as const,
    installs: manifest.installs.filter((candidate) => !(candidate.packId === install.packId && candidate.target === install.target))
  };

  if (files.length === 0) return withoutInstall;

  return upsertInstallEntry(withoutInstall, {
    ...install,
    files
  });
}
