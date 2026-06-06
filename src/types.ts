export type Target = "claude" | "codex" | "opencode";

export type PermissionMode = "readonly" | "safe-write" | "write" | "command";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  permission: PermissionMode;
  recommendedTargets: Target[];
  prompt: string;
  model?: {
    claude?: string;
    codex?: string;
    opencode?: string;
  };
  tools?: {
    read?: boolean;
    edit?: boolean;
    write?: boolean;
    bash?: "none" | "safe" | "full";
    web?: boolean;
  };
  provenance?: {
    source?: string;
    repository?: string;
    license?: string;
    author?: string;
    sourceSha256?: string;
    importedAt?: string;
  };
}

export interface PackDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  agents: string[];
  recommendedFor: {
    frameworks?: string[];
    languages?: string[];
    files?: string[];
  };
  requires?: {
    agentsMarket?: string;
  };
}

export interface RegistryChangelogEntry {
  version: string;
  date: string;
  summary: string;
  added?: string[];
  changed?: string[];
  removed?: string[];
}

export interface RegistrySignature {
  keyId: string;
  algorithm: "ed25519";
  signature: string;
}

export interface RegistryMetadata {
  homepage?: string;
  repository?: string;
  catalogUrl?: string;
  releaseUrl?: string;
  packageSpec?: string;
  commit?: string;
}

export interface Registry {
  agents: AgentDefinition[];
  packs: PackDefinition[];
  changelog?: RegistryChangelogEntry[];
}

export interface RegistryBundle {
  schemaVersion: 1;
  name: string;
  version: string;
  exportedAt: string;
  metadata?: RegistryMetadata;
  agents: AgentDefinition[];
  packs: PackDefinition[];
  changelog?: RegistryChangelogEntry[];
  signatures?: RegistrySignature[];
  sha256?: string;
}

export interface ProjectSignals {
  root: string;
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  languages: string[];
  frameworks: string[];
  files: string[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ManifestFileEntry {
  path: string;
  target: Target;
  agentId: string;
  sha256: string;
}

export interface ManifestInstallEntry {
  packId: string;
  packVersion?: string;
  target: Target | "all";
  installedAt: string;
  registry?: {
    source: string;
    version?: string;
    sha256?: string;
  };
  files: ManifestFileEntry[];
}

export interface InstallManifest {
  schemaVersion: 1;
  installs: ManifestInstallEntry[];
}

export interface RegistryLock {
  schemaVersion: 1;
  source: string;
  version?: string;
  sha256?: string;
  lockedAt: string;
}
