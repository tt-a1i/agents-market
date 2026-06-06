import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./hash.js";
import { loadManifest, loadRegistryLock, MANIFEST_PATH, REGISTRY_LOCK_PATH } from "./manifest.js";
import { checkPackPolicy, loadPolicy, policyPath, type AgentPolicy, type PolicyCheckReport } from "./policy.js";
import { loadRegistryWithInfo, verifyRegistryLock } from "./registry.js";
import type { InstallManifest, ManifestFileEntry, ManifestInstallEntry, RegistryLock, Target } from "./types.js";

export type DoctorSeverity = "pass" | "warn" | "error";

export interface DoctorCheck {
  id: string;
  severity: DoctorSeverity;
  message: string;
  detail?: string;
}

export interface DoctorReport {
  root: string;
  health: "ok" | "warning" | "error";
  installCount: number;
  fileCounts: {
    total: number;
    clean: number;
    modified: number;
    missing: number;
  };
  targets: Record<Target, number>;
  manifest?: InstallManifest;
  registryLock?: RegistryLock;
  policy?: AgentPolicy;
  policyChecks?: PolicyCheckReport[];
  checks: DoctorCheck[];
}

export async function runDoctor(root: string): Promise<DoctorReport> {
  const manifest = await loadManifest(root);
  const registryLock = await loadRegistryLock(root);
  const policyFile = policyPath(root);
  const checks: DoctorCheck[] = [];
  const fileCounts = {
    total: 0,
    clean: 0,
    modified: 0,
    missing: 0
  };
  const targets = {
    claude: 0,
    codex: 0,
    opencode: 0
  };

  if (await exists(join(root, MANIFEST_PATH))) {
    checks.push({ id: "manifest", severity: "pass", message: "Install manifest exists.", detail: MANIFEST_PATH });
  } else {
    checks.push({ id: "manifest", severity: "warn", message: "No install manifest found.", detail: MANIFEST_PATH });
  }

  if (registryLock) {
    checks.push({
      id: "registry-lock",
      severity: "pass",
      message: "Registry lock is present.",
      detail: `${registryLock.source}${registryLock.version ? ` @ ${registryLock.version}` : ""}`
    });
  } else {
    checks.push({ id: "registry-lock", severity: "warn", message: "Project is not locked to a registry source.", detail: REGISTRY_LOCK_PATH });
  }

  if (manifest.installs.length === 0) {
    checks.push({ id: "installs", severity: "warn", message: "No packs are installed by Agents Market." });
  } else {
    checks.push({ id: "installs", severity: "pass", message: `${manifest.installs.length} pack install entries found.` });
  }

  for (const install of manifest.installs) {
    for (const file of install.files) {
      fileCounts.total += 1;
      targets[file.target] += 1;
      const state = await fileState(root, file);
      fileCounts[state] += 1;
    }
  }

  if (fileCounts.missing > 0) {
    checks.push({ id: "generated-files", severity: "error", message: `${fileCounts.missing} generated files are missing.` });
  } else if (fileCounts.modified > 0) {
    checks.push({ id: "generated-files", severity: "warn", message: `${fileCounts.modified} generated files were modified after install.` });
  } else if (fileCounts.total > 0) {
    checks.push({ id: "generated-files", severity: "pass", message: `${fileCounts.clean} generated files are clean.` });
  }

  for (const target of Object.keys(targets) as Target[]) {
    const targetDir = targetDirectory(target);
    if (targets[target] > 0 && !(await exists(join(root, targetDir)))) {
      checks.push({ id: `target-dir:${target}`, severity: "error", message: `${target} target directory is missing.`, detail: targetDir });
    } else if (targets[target] > 0) {
      checks.push({ id: `target-dir:${target}`, severity: "pass", message: `${target} target directory exists.`, detail: targetDir });
    }
  }

  const policyExists = await exists(policyFile);
  let policy: AgentPolicy | undefined;
  let policyChecks: PolicyCheckReport[] | undefined;
  if (policyExists) {
    try {
      policy = await loadPolicy(policyFile);
      checks.push({ id: "policy", severity: "pass", message: "Project policy exists.", detail: ".agents-market/policy.json" });
    } catch (error) {
      checks.push({
        id: "policy",
        severity: "error",
        message: "Project policy could not be parsed.",
        detail: error instanceof Error ? error.message : String(error)
      });
    }

    if (policy && manifest.installs.length > 0) {
      try {
        const activePolicy = policy;
        policyChecks = [];
        for (const install of manifest.installs) {
          const loaded = await loadRegistryForInstall(registryLock, install.registry);
          policyChecks.push(checkPackPolicy(loaded.registry, install.packId, install.target, activePolicy));
        }
        const violations = policyChecks.filter((report) => !report.ok);
        if (violations.length > 0) {
          checks.push({
            id: "policy-installed-packs",
            severity: "error",
            message: `${violations.length} installed packs violate project policy.`,
            detail: violations.map((report) => report.packId).join(", ")
          });
        } else {
          checks.push({ id: "policy-installed-packs", severity: "pass", message: "Installed packs satisfy project policy." });
        }
      } catch (error) {
        checks.push({
          id: "policy-registry",
          severity: "error",
          message: "Could not load registry to check installed packs against policy.",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return {
    root,
    health: healthFromChecks(checks),
    installCount: manifest.installs.length,
    fileCounts,
    targets,
    manifest,
    registryLock,
    policy,
    policyChecks,
    checks
  };
}

async function loadRegistryForInstall(registryLock: RegistryLock | undefined, installRegistry: ManifestInstallEntry["registry"] | undefined) {
  if (registryLock) {
    const loaded = await loadRegistryWithInfo(registryLock.source);
    verifyRegistryLock(loaded, registryLock);
    return loaded;
  }
  const loaded = await loadRegistryWithInfo(installRegistry?.source);
  if (installRegistry) verifyInstallRegistrySource(loaded.source, installRegistry);
  return loaded;
}

function verifyInstallRegistrySource(
  loaded: { value: string; version?: string; sha256?: string },
  installed: NonNullable<ManifestInstallEntry["registry"]>
): void {
  if (loaded.value !== installed.source) {
    throw new Error(`Install registry source mismatch: expected ${installed.source}, loaded ${loaded.value}`);
  }
  if (installed.version && loaded.version && loaded.version !== installed.version) {
    throw new Error(`Install registry version mismatch: expected ${installed.version}, loaded ${loaded.version}`);
  }
  if (installed.sha256 && loaded.sha256 !== installed.sha256) {
    throw new Error(`Install registry checksum mismatch: expected ${installed.sha256}, loaded ${loaded.sha256 ?? "none"}`);
  }
}

async function fileState(root: string, file: ManifestFileEntry): Promise<"clean" | "modified" | "missing"> {
  try {
    const raw = await readFile(join(root, file.path), "utf8");
    return sha256(raw) === file.sha256 ? "clean" : "modified";
  } catch {
    return "missing";
  }
}

function healthFromChecks(checks: DoctorCheck[]): DoctorReport["health"] {
  if (checks.some((check) => check.severity === "error")) return "error";
  if (checks.some((check) => check.severity === "warn")) return "warning";
  return "ok";
}

function targetDirectory(target: Target): string {
  if (target === "claude") return ".claude/agents";
  if (target === "codex") return ".codex/agents";
  return ".opencode/agents";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
