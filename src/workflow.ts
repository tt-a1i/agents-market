import { detectProject } from "./project.js";
import { auditPack, type PackAudit } from "./audit.js";
import { generatePackFiles } from "./install.js";
import { readExisting, summarizeFileChange, writeGeneratedFiles } from "./files.js";
import { loadManifest, saveManifest, upsertInstall } from "./manifest.js";
import { checkPackPolicy, createPolicyPreset, type AgentPolicy, type PolicyCheckReport } from "./policy.js";
import { getPack } from "./registry.js";
import { recommendPackDetails } from "./recommend.js";
import { checkPackCompatibility, type PackCompatibilityReport } from "./compatibility.js";
import { CLI_VERSION } from "./constants.js";
import type { PackDefinition, ProjectSignals, Registry, Target } from "./types.js";

export type ApplyMode = "preview" | "install";
export type ApplyPolicySource = "project" | "file" | "preset" | "none";

export interface ApplyWorkflowOptions {
  root: string;
  registry: Registry;
  registrySource?: {
    value: string;
    version?: string;
    sha256?: string;
  };
  packId?: string;
  target: Target | "all";
  mode: ApplyMode;
  policy?: AgentPolicy;
  policySource: ApplyPolicySource;
  policyCommandArg?: string;
}

export interface ApplyWorkflowChange {
  path: string;
  target: Target;
  agentId: string;
  state: "create" | "update" | "unchanged";
}

export interface ApplyWorkflowResult {
  root: string;
  mode: ApplyMode;
  installed: boolean;
  pack: {
    id: string;
    name: string;
    description: string;
    explicit: boolean;
    score: number;
    reasons: string[];
  };
  target: Target | "all";
  signals: ProjectSignals;
  audit: PackAudit;
  compatibility: PackCompatibilityReport;
  policySource: ApplyPolicySource;
  policy?: PolicyCheckReport;
  changes: ApplyWorkflowChange[];
  changeSummary: {
    create: number;
    update: number;
    unchanged: number;
    total: number;
  };
  nextCommands: string[];
}

export async function runApplyWorkflow(options: ApplyWorkflowOptions): Promise<ApplyWorkflowResult> {
  const signals = await detectProject(options.root);
  const selected = selectPack(options.registry, options.packId, signals);
  const audit = auditPack(options.registry, selected.pack.id, options.target);
  const compatibility = checkPackCompatibility(selected.pack, CLI_VERSION);
  const policy = options.policy ? checkPackPolicy(options.registry, selected.pack.id, options.target, options.policy) : undefined;
  const files = generatePackFiles(options.registry, selected.pack.id, options.target);
  const changes: ApplyWorkflowChange[] = [];

  for (const file of files) {
    const existing = await readExisting(options.root, file);
    changes.push({
      path: file.path,
      target: file.target,
      agentId: file.agent.id,
      state: summarizeFileChange(existing, file.content)
    });
  }

  const installed = options.mode === "install" && compatibility.ok && (!policy || policy.ok);
  if (installed) {
    await writeGeneratedFiles(options.root, files);
    const manifest = await loadManifest(options.root);
    await saveManifest(
      options.root,
      upsertInstall(manifest, selected.pack.id, options.target, files, new Date(), {
        source: options.registrySource?.value ?? "bundled",
        version: options.registrySource?.version,
        sha256: options.registrySource?.sha256
      }, selected.pack.version)
    );
  }

  return {
    root: options.root,
    mode: options.mode,
    installed,
    pack: {
      id: selected.pack.id,
      name: selected.pack.name,
      description: selected.pack.description,
      explicit: Boolean(options.packId),
      score: selected.score,
      reasons: selected.reasons
    },
    target: options.target,
    signals,
    audit,
    compatibility,
    policySource: options.policySource,
    policy,
    changes,
    changeSummary: summarizeApplyChanges(changes),
    nextCommands: buildNextCommands(selected.pack.id, options.target, options.mode, options.policyCommandArg)
  };
}

export function defaultApplyPolicy(): AgentPolicy {
  return createPolicyPreset("balanced");
}

function selectPack(
  registry: Registry,
  packId: string | undefined,
  signals: ProjectSignals
): { pack: PackDefinition; score: number; reasons: string[] } {
  if (packId) {
    const pack = getPack(registry, packId);
    return { pack, score: 0, reasons: ["explicit"] };
  }

  const recommendation = recommendPackDetails(registry, signals)[0];
  if (recommendation) return { pack: recommendation.pack, score: recommendation.score, reasons: recommendation.reasons };

  const fallback = registry.packs.find((pack) => pack.id === "starter-dev-pack") ?? registry.packs[0];
  if (!fallback) throw new Error("Registry does not contain any packs.");
  return { pack: fallback, score: 0, reasons: ["fallback"] };
}

function buildNextCommands(packId: string, target: Target | "all", mode: ApplyMode, policyCommandArg = ""): string[] {
  if (mode === "preview") {
    return [`agents-market apply ${packId} --target ${target}${policyCommandArg} --yes`, "agents-market status --json", "agents-market doctor --strict --json"];
  }
  return ["agents-market status --json", "agents-market doctor --strict --json"];
}

function summarizeApplyChanges(changes: ApplyWorkflowChange[]): ApplyWorkflowResult["changeSummary"] {
  return {
    create: changes.filter((change) => change.state === "create").length,
    update: changes.filter((change) => change.state === "update").length,
    unchanged: changes.filter((change) => change.state === "unchanged").length,
    total: changes.length
  };
}
