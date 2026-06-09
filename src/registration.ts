import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { generateAgent } from "./adapters/index.js";
import { readExisting, summarizeFileChange, writeGeneratedFiles } from "./files.js";
import { sha256 } from "./hash.js";
import { findRegisteredFile, loadManifest, saveManifest, upsertRegisteredAgent } from "./manifest.js";
import { getAgent, type LoadedRegistry } from "./registry.js";
import { resolveTier } from "./tier.js";
import type { AgentContextReference, AgentDefinition, GeneratedFile, ManifestRegisteredAgentEntry, Registry, Target } from "./types.js";

export type RegisterMode = "preview" | "install";

export interface RegisterWorkflowOptions {
  root: string;
  registry: Registry;
  registrySource?: LoadedRegistry["source"];
  agentId: string;
  target: Target;
  mode: RegisterMode;
  localName?: string;
  context?: string[];
}

export interface RegisteredAgentFile extends GeneratedFile {
  target: Target;
  agent: AgentDefinition;
  localName: string;
}

export interface RegisterWorkflowChange {
  path: string;
  target: Target;
  agentId: string;
  localName: string;
  state: "create" | "update" | "unchanged" | "blocked";
  reason?: string;
}

export interface RegisterWorkflowResult {
  root: string;
  operation: "register";
  mode: RegisterMode;
  dryRun: boolean;
  installed: boolean;
  ready: boolean;
  registry?: LoadedRegistry["source"];
  agent: {
    id: string;
    localName: string;
    name: string;
    description: string;
    version: string;
    tier: ReturnType<typeof resolveTier>;
    category: string;
    tags: string[];
    permission: string;
    recommendedTargets: Target[];
  };
  target: Target;
  contextReferences: AgentContextReference[];
  changes: RegisterWorkflowChange[];
  changeSummary: {
    create: number;
    update: number;
    unchanged: number;
    blocked: number;
    total: number;
  };
  hostCapability: {
    target: Target;
    projectLocalRegistration: {
      supported: true;
      path: string;
    };
    directInvocation: {
      status: "unknown";
      message: string;
    };
  };
  warnings: Array<{
    code: string;
    message: string;
  }>;
  nextCommands: string[];
}

export async function runRegisterWorkflow(options: RegisterWorkflowOptions): Promise<RegisterWorkflowResult> {
  const agent = getAgent(options.registry, options.agentId);
  const localName = options.localName ?? agent.id;
  validateLocalName(localName);
  const contextReferences = await loadContextReferences(options.root, options.context ?? []);
  const file: RegisteredAgentFile = {
    ...generateAgent(agent, options.target, { localName, contextReferences }),
    target: options.target,
    agent,
    localName
  };
  const manifest = await loadManifest(options.root);
  const existing = await readExisting(options.root, file);
  const registeredFile = findRegisteredFile(manifest, file.path, options.target);
  const packManaged = manifest.installs.some((install) =>
    install.files.some((candidate) => candidate.path === file.path && candidate.target === options.target)
  );
  const state = summarizeRegistrationState(existing, file.content, Boolean(registeredFile), packManaged);
  const changes: RegisterWorkflowChange[] = [
    {
      path: file.path,
      target: file.target,
      agentId: agent.id,
      localName,
      state: state.state,
      reason: state.reason
    }
  ];
  const changeSummary = summarizeRegisterChanges(changes);
  const ready = changeSummary.blocked === 0;
  const installed = options.mode === "install" && ready;

  if (installed) {
    await writeGeneratedFiles(options.root, [file]);
    const entry: ManifestRegisteredAgentEntry = {
      agentId: agent.id,
      agentVersion: agent.version,
      localName,
      target: options.target,
      registeredAt: new Date().toISOString(),
      registry: options.registrySource
        ? {
            source: options.registrySource.value,
            version: options.registrySource.version,
            sha256: options.registrySource.sha256
          }
        : undefined,
      contextReferences,
      files: [
        {
          path: file.path,
          target: file.target,
          agentId: agent.id,
          sha256: sha256(file.content)
        }
      ]
    };
    await saveManifest(options.root, upsertRegisteredAgent(manifest, entry));
  }

  return {
    root: options.root,
    operation: "register",
    mode: options.mode,
    dryRun: options.mode === "preview",
    installed,
    ready,
    registry: options.registrySource,
    agent: {
      id: agent.id,
      localName,
      name: agent.name,
      description: agent.description,
      version: agent.version,
      tier: resolveTier(agent),
      category: agent.category,
      tags: agent.tags,
      permission: agent.permission,
      recommendedTargets: agent.recommendedTargets
    },
    target: options.target,
    contextReferences,
    changes,
    changeSummary,
    hostCapability: {
      target: options.target,
      projectLocalRegistration: {
        supported: true,
        path: targetPathPattern(options.target)
      },
      directInvocation: {
        status: "unknown",
        message: `Registered agent files can be written for ${options.target}, but direct named invocation depends on host support and was not verified.`
      }
    },
    warnings: [
      {
        code: "HOST_DIRECT_INVOCATION_UNKNOWN",
        message: `Project-local ${options.target} registration can be verified, but direct named invocation cannot be verified by this CLI session.`
      }
    ],
    nextCommands: buildNextCommands(agent.id, options.target, options.mode, localName, options.context)
  };
}

function validateLocalName(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid local agent name: ${value}. Use lowercase letters, numbers, and hyphens.`);
  }
}

async function loadContextReferences(root: string, paths: string[]): Promise<AgentContextReference[]> {
  const references: AgentContextReference[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
    const relativePath = normalizeRelativePath(root, absolute);
    if (seen.has(relativePath)) continue;
    try {
      await stat(absolute);
    } catch {
      throw new Error(`Context file does not exist: ${relativePath}`);
    }
    const raw = await readFile(absolute, "utf8");
    references.push({ path: relativePath, sha256: sha256(raw) });
    seen.add(relativePath);
  }
  return references;
}

function normalizeRelativePath(root: string, absolute: string): string {
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Context file must be inside the project root: ${absolute}`);
  }
  return rel.split("\\").join("/");
}

function summarizeRegistrationState(
  existing: string | undefined,
  next: string,
  isRegistered: boolean,
  isPackManaged: boolean
): { state: RegisterWorkflowChange["state"]; reason?: string } {
  if (existing === undefined) return { state: "create" };
  if (!isRegistered) {
    return {
      state: "blocked",
      reason: isPackManaged ? "managed-pack-file-conflict" : "unmanaged-agent-file-conflict"
    };
  }
  return { state: summarizeFileChange(existing, next) };
}

function summarizeRegisterChanges(changes: RegisterWorkflowChange[]): RegisterWorkflowResult["changeSummary"] {
  return {
    create: changes.filter((change) => change.state === "create").length,
    update: changes.filter((change) => change.state === "update").length,
    unchanged: changes.filter((change) => change.state === "unchanged").length,
    blocked: changes.filter((change) => change.state === "blocked").length,
    total: changes.length
  };
}

function targetPathPattern(target: Target): string {
  if (target === "claude") return ".claude/agents/*.md";
  if (target === "codex") return ".codex/agents/*.toml";
  return ".opencode/agents/*.md";
}

function buildNextCommands(
  agentId: string,
  target: Target,
  mode: RegisterMode,
  localName: string,
  context: string[] | undefined
): string[] {
  const nameArg = localName === agentId ? "" : ` --name ${localName}`;
  const contextArgs = (context ?? []).map((path) => ` --context ${path}`).join("");
  if (mode === "preview") {
    return [
      `agents-market register --agent ${agentId} --target ${target}${nameArg}${contextArgs} --yes`,
      "agents-market status --json",
      "agents-market doctor --strict --json"
    ];
  }
  return ["agents-market status --json", "agents-market doctor --strict --json"];
}
