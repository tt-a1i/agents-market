#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { dirname, resolve, sep } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createRegistryBundle,
  getPack,
  loadRegistryWithInfo,
  signRegistryBundle,
  summarizeRegistry,
  verifyRegistryBundleSignature,
  verifyRegistryLock
} from "./registry.js";
import { buildCatalog, verifyCatalog } from "./catalog.js";
import { lintRegistry } from "./registry-lint.js";
import { detectProject } from "./project.js";
import { recommendPackDetails, recommendPacks } from "./recommend.js";
import { auditPack } from "./audit.js";
import { runDoctor } from "./doctor.js";
import { createInstallPlan, generatePackFiles } from "./install.js";
import { generateIntegrationPackages, generateIntegrations } from "./integrations.js";
import { cloneGitHubRepository, githubTreeUrl } from "./git-import.js";
import { importMarkdownAgent, importMarkdownDirectory } from "./importer.js";
import { composePack } from "./pack.js";
import { searchRegistry, type SearchKind } from "./search.js";
import { checkPackPolicy, createPolicyPreset, loadPolicy, policyPath, savePolicy, type PolicyCheckReport, type PolicyPreset } from "./policy.js";
import { defaultApplyPolicy, runApplyWorkflow, type ApplyPolicySource } from "./workflow.js";
import { readExisting, removeFile, summarizeFileChange, writeGeneratedFiles } from "./files.js";
import { summarizeTextDrift } from "./drift.js";
import { versionStatus } from "./version.js";
import { checkPackCompatibility, type PackCompatibilityReport } from "./compatibility.js";
import { planManifestResolution, type ResolveStrategy } from "./resolve.js";
import { BUNDLED_REGISTRY_VERSION, CLI_VERSION } from "./constants.js";
import { defaultCiWorkflowOptions, generateCiWorkflow, type CiProvider } from "./ci.js";
import {
  loadManifest,
  loadRegistryLock,
  removeInstall,
  saveManifest,
  saveRegistryLock,
  upsertInstall,
  upsertInstallEntry
} from "./manifest.js";
import { sha256 } from "./hash.js";
import type { ManifestFileEntry, ManifestInstallEntry, RegistryBundle, Target } from "./types.js";

const program = new Command();

function cwd(value?: string): string {
  return resolve(value ?? process.cwd());
}

function parseTarget(value: string): Target | "all" {
  if (value === "all" || value === "claude" || value === "codex" || value === "opencode") {
    return value;
  }
  throw new Error(`Invalid target: ${value}. Use claude, codex, opencode, or all.`);
}

function parseConcreteTarget(value: string): Target {
  const target = parseTarget(value);
  if (target === "all") throw new Error("Target must be one of claude, codex, or opencode.");
  return target;
}

function parseSearchKind(value: string): SearchKind {
  if (value === "all" || value === "agents" || value === "packs") return value;
  throw new Error(`Invalid search type: ${value}. Use all, agents, or packs.`);
}

function parsePolicyPreset(value: string): PolicyPreset {
  if (value === "open" || value === "balanced" || value === "strict") return value;
  throw new Error(`Invalid policy preset: ${value}. Use open, balanced, or strict.`);
}

function parseResolveStrategy(value: string): ResolveStrategy {
  if (value === "accept-registry" || value === "keep-local" || value === "forget") return value;
  throw new Error(`Invalid resolve strategy: ${value}. Use accept-registry, keep-local, or forget.`);
}

function parseCiProvider(value: string): CiProvider {
  if (value === "github") return value;
  throw new Error(`Invalid CI provider: ${value}. Use github.`);
}

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function summarizeChanges(changes: Array<{ state: string }>): Record<"create" | "update" | "same", number> {
  return {
    create: changes.filter((change) => change.state === "create").length,
    update: changes.filter((change) => change.state === "update").length,
    same: changes.filter((change) => change.state === "same").length
  };
}

function applyPolicyCommandArg(options: { enforcePolicy?: boolean; policy?: string; policyPreset?: string }): string {
  if (options.policyPreset) return ` --policy-preset ${parsePolicyPreset(options.policyPreset)}`;
  if (options.policy) return ` --policy-file ${options.policy}`;
  if (options.enforcePolicy) return " --enforce-policy";
  return "";
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function loadProjectRegistry(root: string, registryOption?: string) {
  if (registryOption) return loadRegistryWithInfo(registryOption);
  const lock = await loadRegistryLock(root);
  const loaded = await loadRegistryWithInfo(lock?.source);
  if (lock) verifyRegistryLock(loaded, lock);
  return loaded;
}

async function loadRegistryForInstall(root: string, registryOption: string | undefined, installRegistry: ManifestInstallEntry["registry"] | undefined) {
  if (registryOption) return loadRegistryWithInfo(registryOption);
  const lock = await loadRegistryLock(root);
  if (lock) {
    const loaded = await loadRegistryWithInfo(lock.source);
    verifyRegistryLock(loaded, lock);
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

async function resolvePolicyForCommand(root: string, options: { enforcePolicy?: boolean; policy?: string; policyPreset?: string }) {
  if (options.policyPreset) return createPolicyPreset(parsePolicyPreset(options.policyPreset));
  if (options.policy) return loadPolicy(resolve(options.policy));
  if (options.enforcePolicy) return loadPolicy(policyPath(root));
  return undefined;
}

async function resolvePolicyForApply(root: string, options: { enforcePolicy?: boolean; policy?: boolean; policyFile?: string; policyPreset?: string }): Promise<{
  policy: Awaited<ReturnType<typeof defaultApplyPolicy>> | undefined;
  source: ApplyPolicySource;
  commandArg: string;
}> {
  if (options.policy === false) return { policy: undefined, source: "none", commandArg: " --no-policy" };
  if (options.policyPreset) {
    const preset = parsePolicyPreset(options.policyPreset);
    return { policy: createPolicyPreset(preset), source: "preset", commandArg: ` --policy-preset ${preset}` };
  }
  if (options.policyFile) {
    return { policy: await loadPolicy(resolve(options.policyFile)), source: "file", commandArg: ` --policy-file ${options.policyFile}` };
  }
  if (options.enforcePolicy) {
    return { policy: await loadPolicy(policyPath(root)), source: "project", commandArg: " --enforce-policy" };
  }
  try {
    return { policy: await loadPolicy(policyPath(root)), source: "project", commandArg: " --enforce-policy" };
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return { policy: defaultApplyPolicy(), source: "preset", commandArg: " --policy-preset balanced" };
  }
}

function printPolicyReport(report: PolicyCheckReport): void {
  const state = report.ok ? pc.green("pass") : pc.red("fail");
  console.log(`${pc.bold(report.packId)} policy:${state}`);
  console.log(`- target: ${report.target}`);
  console.log(`- max permission: ${report.policy.maxPermission}`);
  console.log(`- findings: ${report.errorCount} errors, ${report.warningCount} warnings`);
  for (const finding of report.findings) {
    const label = finding.severity === "error" ? pc.red("error") : pc.yellow("warn");
    console.log(`- ${label} ${finding.code} ${finding.subject}: ${finding.message}`);
  }
}

function printCompatibilityReport(report: PackCompatibilityReport): void {
  const state = report.ok ? pc.green("pass") : pc.red("fail");
  console.log(`${pc.bold(report.packId)} compatibility:${state}`);
  console.log(`- cli: ${report.cliVersion}`);
  if (report.requirements?.agentsMarket) console.log(`- requires agents-market: ${report.requirements.agentsMarket}`);
  for (const finding of report.findings) {
    const label = finding.severity === "error" ? pc.red("error") : pc.yellow("warn");
    console.log(`- ${label} ${finding.code} ${finding.subject}: ${finding.message}`);
  }
}

program
  .name("agents-market")
  .description("Agent-native marketplace and installer for specialized coding subagents")
  .version(CLI_VERSION);

program
  .command("init")
  .description("Initialize Agents Market in a project")
  .option("--cwd <path>", "project root to initialize")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--registry <source>", "registry source to lock and use", "bundled")
  .option("--no-lock", "skip writing .agents-market/registry-lock.json")
  .option("--dry-run", "preview without writing files")
  .option("--json", "print machine-readable JSON")
  .action(
    async (options: { cwd?: string; target: string; registry: string; lock?: boolean; dryRun?: boolean; json?: boolean }) => {
      const root = cwd(options.cwd);
      const target = parseTarget(options.target);
      const loaded = await loadRegistryWithInfo(options.registry);
      const signals = await detectProject(root);
      const recommendations = recommendPackDetails(loaded.registry, signals);
      const selectedPack = recommendations[0]?.pack ?? loaded.registry.packs.find((pack) => pack.id === "starter-dev-pack") ?? loaded.registry.packs[0];
      if (!selectedPack) throw new Error("Registry does not contain any packs.");

      const integrationFiles = generateIntegrations(target);
      const integrationChanges = [];
      for (const file of integrationFiles) {
        const existing = await readExisting(root, file);
        integrationChanges.push({
          path: file.path,
          state: summarizeFileChange(existing, file.content)
        });
      }

      const plan = createInstallPlan(loaded.registry, selectedPack.id, target);
      const audit = auditPack(loaded.registry, selectedPack.id, target);
      const packFiles = generatePackFiles(loaded.registry, selectedPack.id, target);
      const diff = [];
      for (const file of packFiles) {
        const existing = await readExisting(root, file);
        diff.push({
          path: file.path,
          target: file.target,
          agentId: file.agent.id,
          state: summarizeFileChange(existing, file.content)
        });
      }

      if (!options.dryRun) {
        if (options.lock !== false) {
          await saveRegistryLock(root, {
            schemaVersion: 1,
            source: loaded.source.value,
            version: loaded.source.version,
            sha256: loaded.source.sha256,
            lockedAt: new Date().toISOString()
          });
        }
        await writeGeneratedFiles(root, integrationFiles);
      }

      const result = {
        root,
        dryRun: Boolean(options.dryRun),
        registry: loaded.source,
        lockWritten: !options.dryRun && options.lock !== false,
        target,
        signals,
        integrations: integrationChanges,
        recommendation: {
          packId: selectedPack.id,
          name: selectedPack.name,
          description: selectedPack.description,
          score: recommendations[0]?.score ?? 0,
          reasons: recommendations[0]?.reasons ?? ["baseline"]
        },
        plan,
        audit,
        diff,
        nextCommands: [
          `agents-market apply ${selectedPack.id} --target ${target} --policy-preset balanced --json`,
          `agents-market apply ${selectedPack.id} --target ${target} --policy-preset balanced --yes`,
          "agents-market doctor --strict --json"
        ]
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`${pc.bold("Initialized Agents Market")} ${options.dryRun ? pc.yellow("(dry run)") : pc.green("(written)")}`);
      console.log(`- root: ${root}`);
      console.log(`- registry: ${loaded.source.value}`);
      console.log(`- target: ${target}`);
      console.log(`- integrations: ${integrationChanges.map((change) => `${change.state} ${change.path}`).join(", ")}`);
      console.log(`- recommended pack: ${pc.cyan(selectedPack.id)} - ${selectedPack.description}`);
      console.log(`- audit risk: ${audit.risk}`);
      console.log(`- planned files: ${plan.fileCount}`);
      if (audit.warnings.length > 0) {
        console.log(`\n${pc.bold("Warnings")}`);
        for (const warning of audit.warnings) {
          console.log(`- ${pc.yellow(warning)}`);
        }
      }
      console.log(`\n${pc.bold("Next")}`);
      for (const command of result.nextCommands) {
        console.log(`- ${command}`);
      }
    }
  );

program
  .command("list")
  .description("List available agent packs and agents")
  .option("--agents", "show individual agents")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--json", "print machine-readable JSON")
  .action(async (options: { agents?: boolean; registry?: string; json?: boolean }) => {
    const loaded = await loadRegistryWithInfo(options.registry);
    const { registry } = loaded;
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            source: loaded.source,
            packCount: registry.packs.length,
            agentCount: registry.agents.length,
            packs: registry.packs,
            agents: options.agents ? registry.agents : undefined
          },
          null,
          2
        )
      );
      return;
    }
    console.log(pc.bold("Packs"));
    for (const pack of registry.packs) {
      console.log(`${pc.cyan(pack.id)} - ${pack.description}`);
    }
    if (options.agents) {
      console.log(`\n${pc.bold("Agents")}`);
      for (const agent of registry.agents) {
        console.log(`${pc.green(agent.id)} - ${agent.description}`);
      }
    }
  });

program
  .command("search")
  .argument("[query]", "keywords to search for")
  .description("Search marketplace packs and agents")
  .option("--type <type>", "all, agents, or packs", "all")
  .option("--target <target>", "filter agents or packs by claude, codex, or opencode")
  .option("--tag <tag>", "filter by tag")
  .option("--category <category>", "filter agents or packs by agent category")
  .option("--limit <number>", "maximum results to return", "20")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--json", "print machine-readable JSON")
  .action(
    async (
      query: string | undefined,
      options: {
        type: string;
        target?: string;
        tag?: string;
        category?: string;
        limit: string;
        registry?: string;
        json?: boolean;
      }
    ) => {
      const { registry } = await loadRegistryWithInfo(options.registry);
      const results = searchRegistry(registry, {
        query,
        kind: parseSearchKind(options.type),
        target: options.target ? parseConcreteTarget(options.target) : undefined,
        tag: options.tag,
        category: options.category,
        limit: Number.parseInt(options.limit, 10)
      });

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              query: query ?? "",
              filters: {
                type: parseSearchKind(options.type),
                target: options.target,
                tag: options.tag,
                category: options.category
              },
              results: results.map((result) => ({
                kind: result.kind,
                id: result.id,
                name: result.name,
                description: result.description,
                score: result.score,
                reasons: result.reasons,
                agents: result.kind === "pack" ? result.pack.agents : undefined,
                tags: result.kind === "pack" ? result.pack.tags : result.agent.tags,
                category: result.kind === "agent" ? result.agent.category : undefined,
                recommendedTargets: result.kind === "agent" ? result.agent.recommendedTargets : undefined
              }))
            },
            null,
            2
          )
        );
        return;
      }

      if (results.length === 0) {
        console.log(pc.yellow("No matching packs or agents found."));
        return;
      }

      for (const result of results) {
        const label = result.kind === "pack" ? pc.cyan("pack") : pc.green("agent");
        console.log(`${label} ${pc.bold(result.id)} - ${result.description}`);
        if (result.reasons.length > 0) {
          console.log(`  ${pc.dim(result.reasons.join(", "))}`);
        }
      }
    }
  );

program
  .command("recommend")
  .description("Recommend packs for the current project")
  .option("--cwd <path>", "project root to scan")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--json", "print machine-readable JSON")
  .action(async (options: { cwd?: string; registry?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const { registry } = await loadProjectRegistry(root, options.registry);
    const signals = await detectProject(root);
    const recommendations = recommendPackDetails(registry, signals);
    const packs = recommendations.map((recommendation) => recommendation.pack);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            signals,
            recommendations: recommendations.map((recommendation) => ({
              packId: recommendation.pack.id,
              name: recommendation.pack.name,
              description: recommendation.pack.description,
              score: recommendation.score,
              reasons: recommendation.reasons,
              agents: recommendation.pack.agents
            }))
          },
          null,
          2
        )
      );
      return;
    }

    console.log(pc.bold("Detected"));
    console.log(`- root: ${signals.root}`);
    console.log(`- package manager: ${signals.packageManager ?? "unknown"}`);
    console.log(`- languages: ${signals.languages.join(", ") || "unknown"}`);
    console.log(`- frameworks: ${signals.frameworks.join(", ") || "none"}`);

    console.log(`\n${pc.bold("Recommended packs")}`);
    if (packs.length === 0) {
      console.log(`- ${pc.cyan("starter-dev-pack")} - baseline coding agents for most projects`);
      return;
    }
    for (const pack of packs) {
      console.log(`- ${pc.cyan(pack.id)} - ${pack.description}`);
    }
  });

program
  .command("apply")
  .argument("[pack]", "optional pack id; omitted means use the top recommendation")
  .description("Run the safe recommendation, audit, policy, diff, and install workflow")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--cwd <path>", "project root to inspect or install into")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--yes", "install after the audit, policy, and diff workflow passes")
  .option("--enforce-policy", "require the pack to satisfy .agents-market/policy.json")
  .option("--policy-file <path>", "policy file path to enforce before installing")
  .option("--policy-preset <preset>", "enforce a built-in policy preset: open, balanced, or strict")
  .option("--no-policy", "skip policy checks")
  .option("--json", "print machine-readable JSON")
  .action(
    async (
      packId: string | undefined,
      options: {
        target: string;
        cwd?: string;
        registry?: string;
        yes?: boolean;
        enforcePolicy?: boolean;
        policy?: boolean;
        policyPreset?: string;
        policyFile?: string;
        json?: boolean;
      }
    ) => {
      const root = cwd(options.cwd);
      const target = parseTarget(options.target);
      const loaded = await loadProjectRegistry(root, options.registry);
      const policy = await resolvePolicyForApply(root, {
        enforcePolicy: options.enforcePolicy,
        policy: options.policy,
        policyFile: options.policyFile,
        policyPreset: options.policyPreset
      });
      const result = await runApplyWorkflow({
        root,
        registry: loaded.registry,
        registrySource: loaded.source,
        packId,
        target,
        mode: options.yes ? "install" : "preview",
        policy: policy.policy,
        policySource: policy.source,
        policyCommandArg: policy.commandArg
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.compatibility.ok) process.exitCode = 1;
        if (result.policy && !result.policy.ok) process.exitCode = 1;
        return;
      }

      console.log(`${pc.bold("Agents Market apply")} ${result.mode === "install" ? pc.green("install") : pc.yellow("preview")}`);
      console.log(`- root: ${result.root}`);
      console.log(`- registry: ${loaded.source.value}`);
      console.log(`- pack: ${pc.cyan(result.pack.id)}${result.pack.explicit ? "" : " (recommended)"}`);
      if (result.pack.reasons.length > 0) console.log(`- reasons: ${result.pack.reasons.join(", ")}`);
      console.log(`- target: ${result.target}`);
      console.log(`- audit risk: ${result.audit.risk}`);
      printCompatibilityReport(result.compatibility);
      console.log(`- files: ${result.changes.length}`);
      if (!result.compatibility.ok) {
        process.exitCode = 1;
        return;
      }
      if (result.policy) printPolicyReport(result.policy);
      if (result.policy && !result.policy.ok) {
        process.exitCode = 1;
        return;
      }
      for (const change of result.changes) {
        const label = change.state === "create" ? pc.green("create") : change.state === "update" ? pc.yellow("update") : pc.dim("same");
        console.log(`${label} ${change.path}`);
      }
      if (result.installed) {
        console.log(pc.green(`Installed ${result.changes.length} files for ${result.pack.id}.`));
      } else {
        console.log(`\n${pc.bold("Next")}`);
        for (const command of result.nextCommands) console.log(`- ${command}`);
      }
    }
  );

program
  .command("diff")
  .argument("<pack>", "pack id to preview")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--cwd <path>", "project root to inspect")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--json", "print machine-readable JSON")
  .description("Preview files that would be written")
  .action(async (packId: string, options: { target: string; cwd?: string; registry?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const { registry } = await loadProjectRegistry(root, options.registry);
    const files = generatePackFiles(registry, packId, parseTarget(options.target));
    if (options.json) {
      const changes = [];
      for (const file of files) {
        const existing = await readExisting(root, file);
        changes.push({
          path: file.path,
          target: file.target,
          agentId: file.agent.id,
          state: summarizeFileChange(existing, file.content)
        });
      }
      console.log(JSON.stringify({ packId, target: parseTarget(options.target), changes }, null, 2));
      return;
    }

    for (const file of files) {
      const existing = await readExisting(root, file);
      const state = summarizeFileChange(existing, file.content);
      const label = state === "create" ? pc.green("create") : state === "update" ? pc.yellow("update") : pc.dim("same");
      console.log(`${label} ${file.path}`);
    }
  });

program
  .command("install")
  .argument("<pack>", "pack id to install")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--cwd <path>", "project root to install into")
  .option("--dry-run", "preview without writing")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--enforce-policy", "require the pack to satisfy .agents-market/policy.json before installing")
  .option("--policy <path>", "policy file path to enforce before installing")
  .option("--policy-preset <preset>", "enforce a built-in policy preset: open, balanced, or strict")
  .option("--json", "print machine-readable JSON for dry-run and policy output")
  .description("Install a pack into the current project")
  .action(
    async (
      packId: string,
      options: {
        target: string;
        cwd?: string;
        dryRun?: boolean;
        registry?: string;
        enforcePolicy?: boolean;
        policy?: string;
        policyPreset?: string;
        json?: boolean;
      }
    ) => {
    const root = cwd(options.cwd);
    const loaded = await loadProjectRegistry(root, options.registry);
    const registry = loaded.registry;
    const target = parseTarget(options.target);
    const files = generatePackFiles(registry, packId, target);
    const pack = getPack(registry, packId);
    const compatibility = checkPackCompatibility(pack, CLI_VERSION);
    const policy = await resolvePolicyForCommand(root, options);
    const policyReport = policy ? checkPackPolicy(registry, packId, target, policy) : undefined;

    if (options.dryRun) {
      if (options.json) {
        const changes = [];
        for (const file of files) {
          const existing = await readExisting(root, file);
          changes.push({
            path: file.path,
            target: file.target,
            agentId: file.agent.id,
            state: summarizeFileChange(existing, file.content)
          });
        }
        console.log(JSON.stringify({ packId, target, dryRun: true, compatibility, policy: policyReport, changes }, null, 2));
        if (!compatibility.ok) process.exitCode = 1;
        if (policyReport && !policyReport.ok) process.exitCode = 1;
        return;
      }
      printCompatibilityReport(compatibility);
      if (!compatibility.ok) {
        process.exitCode = 1;
        return;
      }
      if (policyReport) {
        printPolicyReport(policyReport);
        if (!policyReport.ok) {
          process.exitCode = 1;
          return;
        }
      }
      for (const file of files) {
        const existing = await readExisting(root, file);
        console.log(`${summarizeFileChange(existing, file.content)} ${file.path}`);
      }
      return;
    }

    if (!compatibility.ok) {
      if (options.json) {
        console.log(JSON.stringify({ packId, target, dryRun: false, compatibility, installed: false }, null, 2));
      } else {
        printCompatibilityReport(compatibility);
      }
      process.exitCode = 1;
      return;
    }

    if (policyReport && !policyReport.ok) {
      if (options.json) {
        console.log(JSON.stringify({ packId, target, dryRun: false, policy: policyReport, installed: false }, null, 2));
      } else {
        printPolicyReport(policyReport);
      }
      process.exitCode = 1;
      return;
    }

    await writeGeneratedFiles(root, files);
    const manifest = await loadManifest(root);
    await saveManifest(
      root,
      upsertInstall(
        manifest,
        packId,
        target,
        files,
        new Date(),
        {
          source: loaded.source.value,
          version: loaded.source.version,
          sha256: loaded.source.sha256
        },
        pack.version
      )
    );
    if (options.json) {
      console.log(JSON.stringify({ packId, target, dryRun: false, compatibility, policy: policyReport, installed: true, fileCount: files.length, root }, null, 2));
      return;
    }
    if (policyReport) printPolicyReport(policyReport);
    console.log(pc.green(`Installed ${files.length} files for ${packId} into ${root}`));
  }
  );

program
  .command("plan")
  .argument("<pack>", "pack id to plan")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--cwd <path>", "project root to inspect")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--enforce-policy", "include .agents-market/policy.json in the plan")
  .option("--policy <path>", "policy file path to include in the plan")
  .option("--policy-preset <preset>", "include a built-in policy preset: open, balanced, or strict")
  .option("--json", "print machine-readable JSON", true)
  .option("--no-json", "print human-readable output")
  .description("Create a project-aware install plan for a pack")
  .action(
    async (
      packId: string,
      options: {
        target: string;
        cwd?: string;
        registry?: string;
        enforcePolicy?: boolean;
        policy?: string;
        policyPreset?: string;
        json?: boolean;
      }
    ) => {
    const root = cwd(options.cwd);
    const loaded = await loadProjectRegistry(root, options.registry);
    const registry = loaded.registry;
    const target = parseTarget(options.target);
    const plan = createInstallPlan(registry, packId, target);
    const pack = getPack(registry, packId);
    const audit = auditPack(registry, packId, target);
    const compatibility = checkPackCompatibility(pack, CLI_VERSION);
    const policy = await resolvePolicyForCommand(root, options);
    const policyReport = policy ? checkPackPolicy(registry, packId, target, policy) : undefined;
    const changes = [];
    for (const file of generatePackFiles(registry, packId, target)) {
      const existing = await readExisting(root, file);
      changes.push({
        path: file.path,
        target: file.target,
        agentId: file.agent.id,
        state: summarizeFileChange(existing, file.content)
      });
    }
    const changeSummary = summarizeChanges(changes);
    const policyCommandArg = applyPolicyCommandArg(options);
    const registryCommandArg = options.registry ? ` --registry ${options.registry}` : "";
    const result = {
      root,
      registry: loaded.source,
      pack: {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        version: pack.version,
        requires: pack.requires
      },
      target,
      plan,
      audit,
      compatibility,
      policy: policyReport,
      changes,
      changeSummary,
      ready: compatibility.ok && (!policyReport || policyReport.ok),
      nextCommands: [
        `agents-market apply ${packId} --target ${target}${registryCommandArg}${policyCommandArg} --json`,
        `agents-market apply ${packId} --target ${target}${registryCommandArg}${policyCommandArg} --yes`,
        "agents-market doctor --strict --json"
      ]
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ready) process.exitCode = 1;
      return;
    }

    const ready = result.ready ? pc.green("ready") : pc.red("blocked");
    console.log(`${pc.bold("Install plan")} ${ready}`);
    console.log(`- root: ${result.root}`);
    console.log(`- registry: ${result.registry.value}`);
    console.log(`- pack: ${pc.cyan(result.pack.id)} ${result.pack.version}`);
    console.log(`- target: ${result.target}`);
    console.log(`- agents: ${result.plan.agentCount}`);
    console.log(`- files: ${result.plan.fileCount} (${changeSummary.create} create, ${changeSummary.update} update, ${changeSummary.same} same)`);
    console.log(`- audit risk: ${result.audit.risk}`);
    printCompatibilityReport(result.compatibility);
    if (result.policy) printPolicyReport(result.policy);
    console.log(`\n${pc.bold("Files")}`);
    for (const change of result.changes) {
      const label = change.state === "create" ? pc.green("create") : change.state === "update" ? pc.yellow("update") : pc.dim("same");
      console.log(`${label} ${change.path} (${change.target}, ${change.agentId})`);
    }
    console.log(`\n${pc.bold("Next")}`);
    for (const command of result.nextCommands) console.log(`- ${command}`);
    if (!result.ready) process.exitCode = 1;
  }
  );

program
  .command("audit")
  .argument("<pack>", "pack id to audit")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--json", "print machine-readable JSON")
  .description("Summarize permissions, tools, target support, and provenance for a pack")
  .action(async (packId: string, options: { target: string; registry?: string; json?: boolean }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const audit = auditPack(registry, packId, parseTarget(options.target));
    if (options.json) {
      console.log(JSON.stringify(audit, null, 2));
      return;
    }

    const riskColor = audit.risk === "high" ? pc.red : audit.risk === "medium" ? pc.yellow : pc.green;
    console.log(`${pc.bold(audit.packId)} ${riskColor(`risk:${audit.risk}`)}`);
    console.log(`- agents: ${audit.agentCount}`);
    console.log(`- files for ${audit.target}: ${audit.fileCount}`);
    console.log(
      `- permissions: readonly ${audit.permissions.readonly}, safe-write ${audit.permissions["safe-write"]}, write ${audit.permissions.write}, command ${audit.permissions.command}`
    );
    console.log(
      `- tools: read ${audit.tools.read}, edit ${audit.tools.edit}, write ${audit.tools.write}, bash-safe ${audit.tools.bashSafe}, bash-full ${audit.tools.bashFull}, web ${audit.tools.web}`
    );
    console.log(
      `- provenance: bundled ${audit.provenance.bundled}, imported ${audit.provenance.imported}, licensed ${audit.provenance.withLicense}, checksummed ${audit.provenance.withChecksum}`
    );
    if (audit.provenance.repositories.length > 0) {
      console.log(`- repositories: ${audit.provenance.repositories.join(", ")}`);
    }
    if (audit.warnings.length > 0) {
      console.log(`\n${pc.bold("Warnings")}`);
      for (const warning of audit.warnings) {
        console.log(`- ${pc.yellow(warning)}`);
      }
    }
  });

const policyCommand = program.command("policy").description("Create and check project policy for agent packs");

policyCommand
  .command("init")
  .option("--cwd <path>", "project root to initialize policy in")
  .option("--preset <preset>", "open, balanced, or strict", "balanced")
  .option("--overwrite", "overwrite an existing policy file")
  .option("--dry-run", "preview without writing")
  .option("--json", "print machine-readable JSON")
  .description("Write .agents-market/policy.json for team-safe pack review")
  .action(async (options: { cwd?: string; preset: string; overwrite?: boolean; dryRun?: boolean; json?: boolean }) => {
    const root = cwd(options.cwd);
    const preset = parsePolicyPreset(options.preset);
    const path = policyPath(root);
    const policy = createPolicyPreset(preset);

    if (!options.overwrite) {
      try {
        await readFile(path, "utf8");
        throw new Error(`Policy already exists: ${path}. Use --overwrite to replace it.`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Policy already exists:")) throw error;
        if (!isNotFoundError(error)) throw error;
      }
    }

    if (!options.dryRun) await savePolicy(path, policy);

    const result = {
      path,
      preset,
      dryRun: Boolean(options.dryRun),
      written: !options.dryRun,
      policy
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`${pc.green(options.dryRun ? "Would write" : "Wrote")} ${path}`);
  });

policyCommand
  .command("check")
  .argument("<pack>", "pack id to check")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--cwd <path>", "project root containing .agents-market/policy.json")
  .option("--policy <path>", "policy file path")
  .option("--preset <preset>", "use a built-in policy preset instead of reading a file")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--json", "print machine-readable JSON")
  .description("Check whether a pack satisfies project policy")
  .action(async (packId: string, options: { target: string; cwd?: string; policy?: string; preset?: string; registry?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const target = parseTarget(options.target);
    const loaded = await loadProjectRegistry(root, options.registry);
    const policy = options.preset ? createPolicyPreset(parsePolicyPreset(options.preset)) : await loadPolicy(resolve(options.policy ?? policyPath(root)));
    const report = checkPackPolicy(loaded.registry, packId, target, policy);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
      return;
    }

    printPolicyReport(report);
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("status")
  .description("Show installed packs and whether generated files drifted")
  .option("--cwd <path>", "project root to inspect")
  .option("--registry <source>", "registry source used for --diff expected content")
  .option("--diff", "include generated-file drift summaries")
  .option("--json", "print machine-readable JSON")
  .action(async (options: { cwd?: string; registry?: string; diff?: boolean; json?: boolean }) => {
    const root = cwd(options.cwd);
    const manifest = await loadManifest(root);
    const installs = [];

    for (const install of manifest.installs) {
      let expectedByPath = new Map<string, string>();
      let driftError: string | undefined;
      if (options.diff) {
        try {
          const loaded = await loadRegistryForInstall(root, options.registry, install.registry);
          expectedByPath = new Map(generatePackFiles(loaded.registry, install.packId, install.target).map((file) => [file.path, file.content]));
        } catch (error) {
          driftError = error instanceof Error ? error.message : String(error);
        }
      }
      const files = [];
      for (const file of install.files) {
        const current = await readExisting(root, { path: file.path, content: "" });
        const state = current === undefined ? "missing" : sha256(current) === file.sha256 ? "clean" : "modified";
        const expected = expectedByPath.get(file.path);
        files.push({
          path: file.path,
          target: file.target,
          agentId: file.agentId,
          state,
          ...(options.diff
            ? {
                expectedSha256: expected ? sha256(expected) : file.sha256,
                currentSha256: current ? sha256(current) : undefined,
                drift:
                  expected && current !== undefined && state !== "clean"
                    ? summarizeTextDrift(expected, current)
                    : expected && current === undefined
                      ? summarizeTextDrift(expected, "")
                      : undefined,
                driftError
              }
            : {})
        });
      }
      installs.push({
        packId: install.packId,
        target: install.target,
        installedAt: install.installedAt,
        registry: install.registry,
        packVersion: install.packVersion,
        files
      });
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            root,
            installCount: installs.length,
            installs
          },
          null,
          2
        )
      );
      return;
    }

    if (manifest.installs.length === 0) {
      console.log("No packs installed by Agents Market.");
      return;
    }

    for (const install of manifest.installs) {
      console.log(`${pc.bold(install.packId)} (${install.target}) installed ${install.installedAt}`);
      const status = installs.find((entry) => entry.packId === install.packId && entry.target === install.target);
      for (const file of status?.files ?? []) {
        const state = file.state === "missing" ? pc.red("missing") : file.state === "clean" ? pc.green("clean") : pc.yellow("modified");
        console.log(`  ${state} ${file.path}`);
        if (options.diff && file.drift) {
          console.log(`    +${file.drift.addedLines} -${file.drift.removedLines}`);
          for (const line of file.drift.preview) console.log(`    ${line}`);
        } else if (options.diff && file.driftError) {
          console.log(`    ${pc.red(file.driftError)}`);
        }
      }
    }
  });

program
  .command("resolve")
  .argument("[pack]", "optional pack id to resolve; resolves all installed packs when omitted")
  .description("Resolve manifest drift by accepting registry content, keeping local edits, or forgetting tracked files")
  .option("--cwd <path>", "project root to resolve")
  .option("-t, --target <target>", "claude, codex, opencode, or all")
  .option("--registry <source>", "registry source used by accept-registry")
  .option("--strategy <strategy>", "accept-registry, keep-local, or forget", "accept-registry")
  .option("--file <path>", "resolve one tracked file path; repeat to resolve multiple files", collectOption, [])
  .option("--yes", "write files and manifest updates; default is preview only")
  .option("--json", "print machine-readable JSON")
  .action(
    async (
      packId: string | undefined,
      options: { cwd?: string; target?: string; registry?: string; strategy: string; file: string[]; yes?: boolean; json?: boolean }
    ) => {
      const root = cwd(options.cwd);
      const manifest = await loadManifest(root);
      const target = options.target ? parseTarget(options.target) : undefined;
      const strategy = parseResolveStrategy(options.strategy);
      const result = await planManifestResolution({
        manifest,
        expectedFilesForInstall:
          strategy === "accept-registry" || options.registry
            ? async (install) => {
                const loaded = await loadRegistryForInstall(root, options.registry, install.registry);
                return generatePackFiles(loaded.registry, install.packId, install.target);
              }
            : undefined,
        strategy,
        dryRun: !options.yes,
        packId,
        target,
        paths: options.file,
        readCurrent: async (path) => readExisting(root, { path, content: "" })
      });

      if (options.yes) {
        if (result.filesToWrite.length > 0) await writeGeneratedFiles(root, result.filesToWrite);
        await saveManifest(root, result.manifest);
      }

      const summary = {
        root,
        strategy,
        dryRun: !options.yes,
        written: result.written,
        recorded: result.recorded,
        forgotten: result.forgotten,
        skipped: result.skipped,
        installs: result.installs
      };

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      if (result.installs.length === 0) {
        console.log(packId ? pc.yellow(`No matching drift found for ${packId}.`) : pc.yellow("No manifest drift found."));
        return;
      }

      console.log(`${pc.bold(options.yes ? "Resolved" : "Resolve preview")} ${strategy}`);
      console.log(`- written: ${result.written}`);
      console.log(`- recorded: ${result.recorded}`);
      console.log(`- forgotten: ${result.forgotten}`);
      console.log(`- skipped: ${result.skipped}`);
      for (const install of result.installs) {
        console.log(`${pc.bold(install.packId)} (${install.target})`);
        for (const change of install.changes) {
          const label =
            change.action === "write-registry" || change.action === "record-local" || change.action === "forget"
              ? pc.green(change.action)
              : pc.yellow(change.action);
          console.log(`  ${label} ${change.path}`);
        }
      }
    }
  );

program
  .command("outdated")
  .description("Check installed packs against their current registry versions")
  .option("--cwd <path>", "project root to inspect")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--json", "print machine-readable JSON")
  .action(async (options: { cwd?: string; registry?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const manifest = await loadManifest(root);
    const checks = [];
    for (const install of manifest.installs) {
      try {
        const loaded = await loadRegistryForInstall(root, options.registry, install.registry);
        const currentPack = loaded.registry.packs.find((pack) => pack.id === install.packId);
        const status = versionStatus(install.packVersion, currentPack?.version);
        checks.push({
          packId: install.packId,
          target: install.target,
          installedVersion: install.packVersion,
          currentVersion: currentPack?.version,
          status,
          registry: loaded.source
        });
      } catch (error) {
        checks.push({
          packId: install.packId,
          target: install.target,
          installedVersion: install.packVersion,
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const summary = {
      root,
      installCount: manifest.installs.length,
      outdatedCount: checks.filter((check) => check.status === "outdated").length,
      unknownCount: checks.filter((check) => check.status === "unknown").length,
      errorCount: checks.filter((check) => check.status === "error").length,
      checks
    };

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.errorCount > 0) process.exitCode = 1;
      return;
    }

    if (checks.length === 0) {
      console.log("No packs installed by Agents Market.");
      return;
    }
    for (const check of checks) {
      const label =
        check.status === "outdated"
          ? pc.yellow("outdated")
          : check.status === "error"
            ? pc.red("error")
            : check.status === "unknown"
              ? pc.yellow("unknown")
              : check.status === "newer"
                ? pc.yellow("newer")
                : pc.green("current");
      const versions = `${check.installedVersion ?? "unknown"} -> ${check.currentVersion ?? "missing"}`;
      console.log(`${label} ${check.packId} (${check.target}) ${versions}`);
      if ("error" in check && check.error) console.log(`  ${check.error}`);
    }
    if (summary.errorCount > 0) process.exitCode = 1;
  });

program
  .command("doctor")
  .description("Run project health checks for Agents Market installs")
  .option("--cwd <path>", "project root to inspect")
  .option("--json", "print machine-readable JSON")
  .option("--strict", "exit with a non-zero status when health is warning or error")
  .action(async (options: { cwd?: string; json?: boolean; strict?: boolean }) => {
    const root = cwd(options.cwd);
    const report = await runDoctor(root);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      if (options.strict && report.health !== "ok") process.exitCode = 1;
      return;
    }

    const healthColor = report.health === "error" ? pc.red : report.health === "warning" ? pc.yellow : pc.green;
    console.log(`${pc.bold("Agents Market Doctor")} ${healthColor(report.health)}`);
    console.log(`- root: ${report.root}`);
    console.log(`- installs: ${report.installCount}`);
    console.log(
      `- files: ${report.fileCounts.clean} clean, ${report.fileCounts.modified} modified, ${report.fileCounts.missing} missing, ${report.fileCounts.total} total`
    );
    console.log(`- targets: claude ${report.targets.claude}, codex ${report.targets.codex}, opencode ${report.targets.opencode}`);
    console.log(`\n${pc.bold("Checks")}`);
    for (const check of report.checks) {
      const label = check.severity === "error" ? pc.red("error") : check.severity === "warn" ? pc.yellow("warn") : pc.green("pass");
      console.log(`- ${label} ${check.message}${check.detail ? ` (${check.detail})` : ""}`);
    }
    if (options.strict && report.health !== "ok") process.exitCode = 1;
  });

program
  .command("uninstall")
  .argument("<pack>", "pack id to uninstall")
  .option("-t, --target <target>", "claude, codex, opencode, or all")
  .option("--cwd <path>", "project root to uninstall from")
  .option("--force", "remove files even if they were modified")
  .option("--dry-run", "preview without removing files")
  .option("--json", "print machine-readable JSON")
  .description("Uninstall files previously installed by Agents Market")
  .action(async (packId: string, options: { target?: string; cwd?: string; force?: boolean; dryRun?: boolean; json?: boolean }) => {
    const root = cwd(options.cwd);
    const target = options.target ? parseTarget(options.target) : undefined;
    const manifest = await loadManifest(root);
    const installs = manifest.installs.filter((entry) => entry.packId === packId && (!target || entry.target === target));

    if (installs.length === 0) {
      console.log(pc.yellow(`No matching install found for ${packId}.`));
      return;
    }

    let removed = 0;
    let skipped = 0;
    let nextManifest = manifest;
    const summaries = [];
    for (const install of installs) {
      const remainingFiles: ManifestFileEntry[] = [];
      const changes = [];
      for (const file of install.files) {
        const current = await readExisting(root, { path: file.path, content: "" });
        if (current === undefined) {
          changes.push({
            path: file.path,
            target: file.target,
            agentId: file.agentId,
            state: "missing",
            action: "forget-missing"
          });
          continue;
        }
        const changed = sha256(current) !== file.sha256;
        if (changed && !options.force) {
          skipped += 1;
          remainingFiles.push(file);
          changes.push({
            path: file.path,
            target: file.target,
            agentId: file.agentId,
            state: "modified",
            action: "skip-modified"
          });
          if (!options.json) console.log(`${pc.yellow("skip modified")} ${file.path}`);
          continue;
        }
        changes.push({
          path: file.path,
          target: file.target,
          agentId: file.agentId,
          state: changed ? "modified" : "clean",
          action: "remove"
        });
        if (!options.dryRun) {
          await removeFile(root, file.path);
        }
        removed += 1;
        if (!options.json) console.log(`${pc.green(options.dryRun ? "would remove" : "removed")} ${file.path}`);
      }
      summaries.push({
        packId: install.packId,
        target: install.target,
        changes
      });

      if (!options.dryRun) {
        nextManifest = removeInstall(nextManifest, install.packId, install.target);
        if (remainingFiles.length > 0) {
          nextManifest = upsertInstallEntry(nextManifest, {
            ...install,
            files: remainingFiles
          });
        }
      }
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            dryRun: Boolean(options.dryRun),
            removed,
            skipped,
            uninstalls: summaries
          },
          null,
          2
        )
      );
    } else {
      console.log(pc.green(`${options.dryRun ? "Previewed uninstall" : "Uninstalled"} ${packId}: removed ${removed}, skipped ${skipped}.`));
    }

    if (!options.dryRun) {
      await saveManifest(root, nextManifest);
    }
  });

program
  .command("update")
  .argument("[pack]", "optional pack id to update; updates all installed packs when omitted")
  .option("--cwd <path>", "project root to update")
  .option("--force", "overwrite modified generated files")
  .option("--dry-run", "preview without writing")
  .option("--json", "print machine-readable JSON")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .description("Update installed packs from the current registry")
  .action(async (packId: string | undefined, options: { cwd?: string; force?: boolean; dryRun?: boolean; json?: boolean; registry?: string }) => {
    const root = cwd(options.cwd);
    const manifest = await loadManifest(root);
    const installs = manifest.installs.filter((entry) => !packId || entry.packId === packId);

    if (installs.length === 0) {
      console.log(pc.yellow(packId ? `No matching install found for ${packId}.` : "No packs installed by Agents Market."));
      return;
    }

    let written = 0;
    let skipped = 0;
    let nextManifest = manifest;
    const summaries = [];
    for (const install of installs) {
      const loaded = await loadRegistryForInstall(root, options.registry, install.registry);
      const registry = loaded.registry;
      const pack = getPack(registry, install.packId);
      const compatibility = checkPackCompatibility(pack, CLI_VERSION);
      if (!compatibility.ok) {
        skipped += install.files.length;
        summaries.push({
          packId: install.packId,
          target: install.target,
          fromVersion: install.packVersion,
          toVersion: pack.version,
          versionStatus: versionStatus(install.packVersion, pack.version),
          registry: loaded.source,
          compatibility,
          changes: install.files.map((file) => ({
            path: file.path,
            target: file.target,
            agentId: file.agentId,
            state: "blocked",
            action: "skip-incompatible"
          }))
        });
        if (!options.json) printCompatibilityReport(compatibility);
        continue;
      }
      const files = generatePackFiles(registry, install.packId, install.target);
      const safeFiles = [];
      const manifestFiles: ManifestFileEntry[] = [];
      const changes = [];
      for (const file of files) {
        const previous = install.files.find((entry) => entry.path === file.path);
        const current = await readExisting(root, file);
        const modified = previous && current !== undefined && sha256(current) !== previous.sha256;
        const fileState = summarizeFileChange(current, file.content);
        if (modified && !options.force) {
          skipped += 1;
          changes.push({
            path: file.path,
            target: file.target,
            agentId: file.agent.id,
            state: fileState,
            action: "skip-modified"
          });
          if (previous) manifestFiles.push(previous);
          if (!options.json) console.log(`${pc.yellow("skip modified")} ${file.path}`);
          continue;
        }
        const action = fileState === "unchanged" ? "unchanged" : fileState === "create" ? "write-create" : "write-update";
        changes.push({
          path: file.path,
          target: file.target,
          agentId: file.agent.id,
          state: fileState,
          action
        });
        manifestFiles.push({
          path: file.path,
          target: file.target,
          agentId: file.agent.id,
          sha256: sha256(file.content)
        });
        if (action !== "unchanged") {
          safeFiles.push(file);
        }
      }

      const writeCount = changes.filter((change) => change.action === "write-create" || change.action === "write-update").length;
      written += writeCount;
      summaries.push({
        packId: install.packId,
        target: install.target,
        fromVersion: install.packVersion,
        toVersion: pack.version,
        versionStatus: versionStatus(install.packVersion, pack.version),
        registry: loaded.source,
        compatibility,
        changes
      });

      if (!options.dryRun) {
        await writeGeneratedFiles(root, safeFiles);
        nextManifest = upsertInstallEntry(nextManifest, {
          packId: install.packId,
          packVersion: pack.version,
          target: install.target,
          installedAt: new Date().toISOString(),
          registry: {
            source: loaded.source.value,
            version: loaded.source.version,
            sha256: loaded.source.sha256
          },
          files: manifestFiles
        });
      }
    }

    if (options.json) {
      const incompatibleCount = summaries.filter((summary) => summary.compatibility && !summary.compatibility.ok).length;
      console.log(
        JSON.stringify(
          {
            dryRun: Boolean(options.dryRun),
            written,
            skipped,
            incompatibleCount,
            updates: summaries
          },
          null,
          2
        )
      );
      if (incompatibleCount > 0) process.exitCode = 1;
    } else {
      console.log(pc.green(`${options.dryRun ? "Previewed" : "Updated"} packs: wrote ${written}, skipped ${skipped}.`));
      if (summaries.some((summary) => summary.compatibility && !summary.compatibility.ok)) process.exitCode = 1;
    }

    if (!options.dryRun) {
      await saveManifest(root, nextManifest);
    }
  });

program
  .command("export")
  .argument("<pack>", "pack id to export")
  .requiredOption("-o, --out <path>", "output directory")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .description("Export generated agent files to a directory")
  .action(async (packId: string, options: { out: string; target: string; registry?: string }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const files = generatePackFiles(registry, packId, parseTarget(options.target));
    await writeGeneratedFiles(resolve(options.out), files);
    console.log(pc.green(`Exported ${files.length} files to ${resolve(options.out)}`));
  });

const packCommand = program.command("pack").description("Compose and inspect custom packs");

packCommand
  .command("create")
  .argument("<id>", "new pack id")
  .requiredOption("--agent <id...>", "agent ids to include in the pack")
  .requiredOption("-o, --out <dir>", "registry/packs output directory")
  .option("--registry <source>", "registry source containing selectable agents", "bundled")
  .option("--name <name>", "pack display name")
  .option("--description <description>", "pack description")
  .option("--tag <tag...>", "pack tags")
  .option("--framework <framework...>", "recommended framework signals")
  .option("--language <language...>", "recommended language signals")
  .option("--file <file...>", "recommended file signals")
  .option("--version <version>", "pack version", "0.1.0")
  .option("--overwrite", "overwrite an existing pack JSON file")
  .option("--json", "print machine-readable JSON")
  .description("Create a custom pack from selected registry agents")
  .action(
    async (
      id: string,
      options: {
        agent: string[];
        out: string;
        registry: string;
        name?: string;
        description?: string;
        tag?: string[];
        framework?: string[];
        language?: string[];
        file?: string[];
        version: string;
        overwrite?: boolean;
        json?: boolean;
      }
    ) => {
      const { registry } = await loadRegistryWithInfo(options.registry);
      const pack = composePack(registry, {
        id,
        agents: options.agent,
        name: options.name,
        description: options.description,
        version: options.version,
        tags: options.tag,
        frameworks: options.framework,
        languages: options.language,
        files: options.file
      });
      const outPath = resolve(options.out, `${pack.id}.json`);
      if (!options.overwrite) {
        try {
          await readFile(outPath, "utf8");
          throw new Error(`Pack already exists: ${outPath}. Use --overwrite to replace it.`);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("Pack already exists:")) throw error;
          if (!isNotFoundError(error)) throw error;
        }
      }
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
      if (options.json) {
        console.log(JSON.stringify({ pack, path: outPath }, null, 2));
      } else {
        console.log(pc.green(`Wrote custom pack ${pack.id} with ${pack.agents.length} agents to ${outPath}`));
      }
    }
  );

const registryCommand = program.command("registry").description("Registry utilities");

registryCommand
  .command("info")
  .option("--registry <source>", "registry source to inspect", "bundled")
  .option("--json", "print machine-readable JSON")
  .description("Inspect registry source, version, checksum, and pack inventory")
  .action(async (options: { registry: string; json?: boolean }) => {
    const loaded = await loadRegistryWithInfo(options.registry);
    const summary = summarizeRegistry(loaded);
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    console.log(pc.bold("Registry"));
    console.log(`- source: ${summary.source.value}`);
    console.log(`- kind: ${summary.source.kind}`);
    if (summary.source.version) console.log(`- version: ${summary.source.version}`);
    if (summary.source.sha256) console.log(`- sha256: ${summary.source.sha256}`);
    console.log(`- packs: ${summary.packCount}`);
    console.log(`- agents: ${summary.agentCount}`);
    console.log(`- changelog entries: ${summary.changelog.count}`);
    if (summary.changelog.latest) {
      console.log(`- latest: ${summary.changelog.latest.version} (${summary.changelog.latest.date}) - ${summary.changelog.latest.summary}`);
    }
    console.log(`- target support: claude ${summary.targets.claude}, codex ${summary.targets.codex}, opencode ${summary.targets.opencode}`);
    for (const pack of summary.packs) {
      console.log(`  ${pc.cyan(pack.id)} ${pack.version} - ${pack.agentCount} agents`);
      if (pack.requires?.agentsMarket) console.log(`    requires Agents Market ${pack.requires.agentsMarket}`);
    }
  });

registryCommand
  .command("changelog")
  .option("--registry <source>", "registry source to inspect", "bundled")
  .option("--limit <count>", "maximum number of entries to print", "10")
  .option("--json", "print machine-readable JSON")
  .description("Show registry release history")
  .action(async (options: { registry: string; limit: string; json?: boolean }) => {
    const loaded = await loadRegistryWithInfo(options.registry);
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) throw new Error(`Invalid changelog limit: ${options.limit}`);
    const entries = (loaded.registry.changelog ?? []).slice(0, limit);
    const result = {
      source: loaded.source,
      count: loaded.registry.changelog?.length ?? 0,
      entries
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(pc.bold("Registry changelog"));
    console.log(`- source: ${loaded.source.value}`);
    console.log(`- entries: ${result.count}`);
    for (const entry of entries) {
      console.log(`\n${pc.cyan(entry.version)} ${entry.date}`);
      console.log(`  ${entry.summary}`);
      for (const [label, values] of [
        ["added", entry.added],
        ["changed", entry.changed],
        ["removed", entry.removed]
      ] as const) {
        if (values && values.length > 0) {
          console.log(`  ${label}: ${values.join(", ")}`);
        }
      }
    }
  });

registryCommand
  .command("export")
  .requiredOption("-o, --out <path>", "output registry bundle path")
  .option("--registry <source>", "registry source to bundle", "bundled")
  .option("--name <name>", "bundle name", "agents-market")
  .option("--bundle-version <version>", "bundle version", BUNDLED_REGISTRY_VERSION)
  .option("--private-key <path>", "Ed25519 private key PEM used to sign the exported bundle")
  .option("--key-id <id>", "signature key id")
  .description("Export a registry source as a single portable JSON bundle")
  .action(
    async (options: {
      out: string;
      registry: string;
      name: string;
      bundleVersion: string;
      privateKey?: string;
      keyId?: string;
    }) => {
      const { registry } = await loadRegistryWithInfo(options.registry);
      let bundle = createRegistryBundle(registry, options.bundleVersion, options.name);
      if (options.privateKey) {
        if (!options.keyId) throw new Error("--key-id is required when --private-key is provided.");
        const privateKey = await readFile(resolve(options.privateKey), "utf8");
        bundle = signRegistryBundle(bundle, privateKey, options.keyId);
      }
      const out = resolve(options.out);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      console.log(pc.green(`Wrote registry bundle to ${out}`));
    }
  );

registryCommand
  .command("verify")
  .option("--registry <source>", "registry bundle source to verify", "bundled")
  .option("--public-key <path>", "Ed25519 public key PEM used to verify a bundle signature")
  .option("--key-id <id>", "signature key id to verify")
  .option("--json", "print machine-readable JSON")
  .description("Verify registry checksum and optional bundle signature")
  .action(async (options: { registry: string; publicKey?: string; keyId?: string; json?: boolean }) => {
    try {
      const loaded = await loadRegistryWithInfo(options.registry);
      const bundle = loaded.registry as RegistryBundle;
      const signatures = bundle.signatures ?? [];
      const signature = options.publicKey
        ? verifyRegistryBundleSignature(bundle, await readFile(resolve(options.publicKey), "utf8"), options.keyId)
        : undefined;
      const checksumOk = Boolean(loaded.source.sha256 || loaded.source.kind === "bundled" || loaded.source.kind === "directory");
      const ok = checksumOk && (!signature || signature.ok);
      const result = {
        ok,
        source: loaded.source,
        checksum: {
          ok: checksumOk,
          sha256: loaded.source.sha256
        },
        signatures: {
          count: signatures.length,
          verified: signature
        }
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(pc.bold("Registry verification"));
        console.log(`- source: ${loaded.source.value}`);
        console.log(`- checksum: ${result.checksum.ok ? pc.green("ok") : pc.yellow("not available")}`);
        console.log(`- signatures: ${signatures.length}`);
        if (signature) {
          console.log(`- signature: ${signature.ok ? pc.green(`ok (${signature.keyId})`) : pc.red(signature.error ?? "failed")}`);
        }
      }
      if (!ok) process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = {
        ok: false,
        source: options.registry,
        error: message
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(pc.red(`Registry verification failed: ${message}`));
      }
      process.exitCode = 1;
    }
  });

registryCommand
  .command("lock")
  .option("--cwd <path>", "project root to write the lockfile")
  .option("--registry <source>", "registry source to lock", "bundled")
  .description("Lock a project to a registry source")
  .action(async (options: { cwd?: string; registry: string }) => {
    const root = cwd(options.cwd);
    const loaded = await loadRegistryWithInfo(options.registry);
    await saveRegistryLock(root, {
      schemaVersion: 1,
      source: loaded.source.value,
      version: loaded.source.version,
      sha256: loaded.source.sha256,
      lockedAt: new Date().toISOString()
    });
    console.log(pc.green(`Locked registry ${loaded.source.value} in ${root}`));
  });

registryCommand
  .command("verify-lock")
  .option("--cwd <path>", "project root containing .agents-market/registry-lock.json")
  .option("--json", "print machine-readable JSON")
  .description("Verify the project registry lock source, version, and checksum")
  .action(async (options: { cwd?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const lock = await loadRegistryLock(root);
    if (!lock) {
      const result = {
        ok: false,
        root,
        error: "No registry lock found.",
        path: ".agents-market/registry-lock.json"
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(pc.yellow(`No registry lock found in ${root}`));
      }
      process.exitCode = 1;
      return;
    }

    try {
      const loaded = await loadRegistryWithInfo(lock.source);
      verifyRegistryLock(loaded, lock);
      const result = {
        ok: true,
        root,
        lock,
        loaded: loaded.source
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(pc.green(`Registry lock verified: ${lock.source}`));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = {
        ok: false,
        root,
        lock,
        error: message
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(pc.red(`Registry lock verification failed: ${message}`));
      }
      process.exitCode = 1;
    }
  });

registryCommand
  .command("lint")
  .option("--registry <source>", "registry source to lint", "bundled")
  .option("--strict", "treat warnings as failures")
  .option("--json", "print machine-readable JSON")
  .description("Lint registry quality, safety, and pack references")
  .action(async (options: { registry: string; strict?: boolean; json?: boolean }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const report = lintRegistry(registry);
    const ok = report.errorCount === 0 && (!options.strict || report.warningCount === 0);
    if (options.json) {
      console.log(JSON.stringify({ ok, strict: Boolean(options.strict), ...report }, null, 2));
    } else {
      for (const finding of report.findings) {
        const label = finding.severity === "error" ? pc.red("error") : pc.yellow("warning");
        console.log(`${label} ${finding.code} ${finding.subject}: ${finding.message}`);
      }
      console.log(`Score: ${report.score}/100 (${report.errorCount} errors, ${report.warningCount} warnings)`);
      console.log(`Prompt quality: avg ${report.promptQuality.averageScore}/100, min ${report.promptQuality.minScore}/100`);
    }
    if (!ok) {
      process.exitCode = 1;
    }
  });

const integrationsCommand = program.command("integrations").description("Install agent-native installer integrations");

integrationsCommand
  .command("diff")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--cwd <path>", "project root to inspect")
  .description("Preview agent-native integration files")
  .action(async (options: { target: string; cwd?: string }) => {
    const root = cwd(options.cwd);
    const files = generateIntegrations(parseTarget(options.target));
    for (const file of files) {
      const existing = await readExisting(root, file);
      const state = summarizeFileChange(existing, file.content);
      const label = state === "create" ? pc.green("create") : state === "update" ? pc.yellow("update") : pc.dim("same");
      console.log(`${label} ${file.path}`);
    }
  });

integrationsCommand
  .command("install")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--cwd <path>", "project root to install into")
  .option("--dry-run", "preview without writing")
  .description("Install agent-native integrations into the current project")
  .action(async (options: { target: string; cwd?: string; dryRun?: boolean }) => {
    const root = cwd(options.cwd);
    const files = generateIntegrations(parseTarget(options.target));
    if (options.dryRun) {
      for (const file of files) {
        const existing = await readExisting(root, file);
        console.log(`${summarizeFileChange(existing, file.content)} ${file.path}`);
      }
      return;
    }

    await writeGeneratedFiles(root, files);
    console.log(pc.green(`Installed ${files.length} agent-native integration files into ${root}`));
  });

integrationsCommand
  .command("package")
  .requiredOption("-o, --out <path>", "output directory for distributable integration packages")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .description("Generate distributable Claude Code, Codex, and OpenCode installer packages")
  .action(async (options: { out: string; target: string }) => {
    const files = generateIntegrationPackages(parseTarget(options.target));
    await writeGeneratedFiles(resolve(options.out), files);
    console.log(pc.green(`Packaged ${files.length} integration files into ${resolve(options.out)}`));
  });

const ciCommand = program.command("ci").description("Generate CI workflows for Agents Market maintenance");

ciCommand
  .command("diff")
  .option("--provider <provider>", "ci provider: github", "github")
  .option("--package <spec>", "package spec used by npx", defaultCiWorkflowOptions().packageSpec)
  .option("--no-strict", "generate a doctor command that allows warnings")
  .option("--cwd <path>", "project root to inspect")
  .option("--json", "print machine-readable JSON")
  .description("Preview generated Agents Market CI workflow files")
  .action(async (options: { provider: string; package: string; strict?: boolean; cwd?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const workflow = generateCiWorkflow({
      provider: parseCiProvider(options.provider),
      packageSpec: options.package,
      strict: options.strict !== false
    });
    const existing = await readExisting(root, workflow);
    const change = {
      path: workflow.path,
      state: summarizeFileChange(existing, workflow.content)
    };
    if (options.json) {
      console.log(JSON.stringify({ root, provider: options.provider, package: options.package, strict: options.strict !== false, changes: [change] }, null, 2));
      return;
    }
    const label = change.state === "create" ? pc.green("create") : change.state === "update" ? pc.yellow("update") : pc.dim("same");
    console.log(`${label} ${change.path}`);
  });

ciCommand
  .command("init")
  .option("--provider <provider>", "ci provider: github", "github")
  .option("--package <spec>", "package spec used by npx", defaultCiWorkflowOptions().packageSpec)
  .option("--no-strict", "generate a doctor command that allows warnings")
  .option("--cwd <path>", "project root to write into")
  .option("--yes", "write workflow files; default is preview only")
  .option("--json", "print machine-readable JSON")
  .description("Create a project CI workflow for Agents Market drift, version, and policy checks")
  .action(async (options: { provider: string; package: string; strict?: boolean; cwd?: string; yes?: boolean; json?: boolean }) => {
    const root = cwd(options.cwd);
    const workflow = generateCiWorkflow({
      provider: parseCiProvider(options.provider),
      packageSpec: options.package,
      strict: options.strict !== false
    });
    const existing = await readExisting(root, workflow);
    const change = {
      path: workflow.path,
      state: summarizeFileChange(existing, workflow.content)
    };
    const result = {
      root,
      provider: options.provider,
      package: options.package,
      strict: options.strict !== false,
      dryRun: !options.yes,
      written: options.yes ? 1 : 0,
      changes: [change],
      nextCommands: ["agents-market status --diff --json", "agents-market outdated --json", `agents-market doctor${options.strict === false ? "" : " --strict"} --json`]
    };

    if (options.yes) {
      await writeGeneratedFiles(root, [workflow]);
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const label = change.state === "create" ? pc.green("create") : change.state === "update" ? pc.yellow("update") : pc.dim("same");
    console.log(`${pc.bold(options.yes ? "Installed CI workflow" : "CI workflow preview")}`);
    console.log(`- root: ${result.root}`);
    console.log(`- provider: ${result.provider}`);
    console.log(`- package: ${result.package}`);
    console.log(`- strict: ${result.strict}`);
    console.log(`${label} ${change.path}`);
    if (!options.yes) {
      console.log(`\n${pc.bold("Next")}`);
      console.log("agents-market ci init --provider github --yes");
    }
  });

const catalogCommand = program.command("catalog").description("Build static marketplace catalog assets");

catalogCommand
  .command("build")
  .requiredOption("-o, --out <path>", "output directory")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--version <version>", "catalog registry bundle version", BUNDLED_REGISTRY_VERSION)
  .option("--title <title>", "catalog site title", "Agents Market")
  .option("--base-url <url>", "public base URL used in copyable registry commands")
  .option("--package <spec>", "package spec used by catalog npx commands", "github:tt-a1i/agents-market")
  .description("Build a static Web catalog for packs and agents")
  .action(async (options: { out: string; registry?: string; version: string; title: string; baseUrl?: string; package: string }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const files = await buildCatalog(registry, {
      outDir: resolve(options.out),
      version: options.version,
      title: options.title,
      baseUrl: options.baseUrl,
      packageSpec: options.package
    });
    console.log(pc.green(`Built catalog with ${files.length} files in ${resolve(options.out)}`));
  });

catalogCommand
  .command("verify")
  .requiredOption("--dir <path>", "catalog directory containing index.html, catalog.json, and registry.bundle.json")
  .option("--json", "print machine-readable JSON")
  .description("Verify static catalog assets are internally consistent")
  .action(async (options: { dir: string; json?: boolean }) => {
    const report = await verifyCatalog(resolve(options.dir));
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    const state = report.ok ? pc.green("pass") : pc.red("fail");
    console.log(`${pc.bold("Catalog")} ${state}`);
    console.log(`- dir: ${report.dir}`);
    console.log(`- findings: ${report.errorCount} errors, ${report.warningCount} warnings`);
    for (const finding of report.findings) {
      const label = finding.severity === "error" ? pc.red("error") : pc.yellow("warn");
      console.log(`- ${label} ${finding.code}: ${finding.message}${finding.detail ? ` (${finding.detail})` : ""}`);
    }
    if (!report.ok) process.exitCode = 1;
  });

const importCommand = program.command("import").description("Import third-party agent templates into Agents Market format");

importCommand
  .command("markdown")
  .argument("<file>", "Claude Code or OpenCode Markdown agent file")
  .requiredOption("-t, --target <target>", "source target format: claude, codex, or opencode")
  .option("-o, --out <dir>", "write normalized agent JSON into this directory")
  .option("--category <category>", "override inferred category")
  .option("--tag <tag...>", "additional tags")
  .option("--version <version>", "agent version", "0.1.0")
  .option("--source-url <url>", "original template URL")
  .option("--source-repo <repo>", "original repository, for example owner/name")
  .option("--source-license <license>", "source template license")
  .option("--source-author <author>", "source template author")
  .description("Normalize a Markdown agent into registry/agents JSON")
  .action(
    async (
      file: string,
      options: {
        target: string;
        out?: string;
        category?: string;
        tag?: string[];
        version: string;
        sourceUrl?: string;
        sourceRepo?: string;
        sourceLicense?: string;
        sourceAuthor?: string;
      }
    ) => {
      const target = parseTarget(options.target);
      if (target === "all") throw new Error("Import target must be one of claude, codex, or opencode.");
      const agent = await importMarkdownAgent({
        sourcePath: resolve(file),
        target,
        outDir: options.out ? resolve(options.out) : undefined,
        category: options.category,
        tags: options.tag,
        version: options.version,
        provenance: provenanceFromOptions(options)
      });
      if (options.out) {
        console.log(pc.green(`Imported ${agent.id} into ${resolve(options.out)}`));
      } else {
        console.log(JSON.stringify(agent, null, 2));
      }
    }
  );

importCommand
  .command("directory")
  .argument("<dir>", "Directory containing Claude Code or OpenCode Markdown agent files")
  .requiredOption("-t, --target <target>", "source target format: claude, codex, or opencode")
  .requiredOption("-o, --out <dir>", "write normalized agent JSON into this registry/agents directory")
  .option("--no-recursive", "only scan the top-level directory")
  .option("--overwrite", "overwrite existing normalized agent JSON files")
  .option("--category <category>", "override inferred category for all imported agents")
  .option("--tag <tag...>", "additional tags for all imported agents")
  .option("--version <version>", "agent version", "0.1.0")
  .option("--source-url <url>", "original template collection URL")
  .option("--source-repo <repo>", "original repository, for example owner/name")
  .option("--source-license <license>", "source template license")
  .option("--source-author <author>", "source template author")
  .option("--pack <id>", "also write a pack containing imported agents")
  .option("--pack-out <dir>", "registry/packs output directory for --pack")
  .option("--pack-name <name>", "pack display name")
  .option("--pack-description <description>", "pack description")
  .description("Normalize a directory of Markdown agents into registry/agents JSON")
  .action(
    async (
      dir: string,
      options: {
        target: string;
        out: string;
        recursive: boolean;
        overwrite?: boolean;
        category?: string;
        tag?: string[];
        version: string;
        sourceUrl?: string;
        sourceRepo?: string;
        sourceLicense?: string;
        sourceAuthor?: string;
        pack?: string;
        packOut?: string;
        packName?: string;
        packDescription?: string;
      }
    ) => {
      const target = parseTarget(options.target);
      if (target === "all") throw new Error("Import target must be one of claude, codex, or opencode.");
      if (options.pack && !options.packOut) throw new Error("--pack-out is required when --pack is provided.");
      const result = await importMarkdownDirectory({
        sourceDir: resolve(dir),
        target,
        outDir: resolve(options.out),
        recursive: options.recursive,
        overwrite: options.overwrite,
        category: options.category,
        tags: options.tag,
        version: options.version,
        provenance: provenanceFromOptions(options),
        pack: options.pack
          ? {
              id: options.pack,
              name: options.packName,
              description: options.packDescription,
              outDir: resolve(options.packOut!)
            }
          : undefined
      });
      console.log(pc.green(`Imported ${result.imported.length} agents into ${resolve(options.out)}`));
      if (result.skipped.length > 0) {
        console.log(pc.yellow(`Skipped ${result.skipped.length} files due to duplicate ids or existing outputs.`));
      }
      if (result.pack) {
        console.log(pc.green(`Wrote pack ${result.pack.id} with ${result.pack.agents.length} agents.`));
      }
    }
  );

importCommand
  .command("repo")
  .argument("<repo>", "GitHub repository, for example owner/name or https://github.com/owner/name")
  .requiredOption("-t, --target <target>", "source target format: claude, codex, or opencode")
  .requiredOption("-o, --out <dir>", "write normalized agent JSON into this registry/agents directory")
  .option("--ref <ref>", "branch, tag, or commit to import")
  .option("--path <path>", "subdirectory inside the repository to scan")
  .option("--no-recursive", "only scan the selected top-level directory")
  .option("--overwrite", "overwrite existing normalized agent JSON files")
  .option("--category <category>", "override inferred category for all imported agents")
  .option("--tag <tag...>", "additional tags for all imported agents")
  .option("--version <version>", "agent version", "0.1.0")
  .option("--source-url <url>", "override original template collection URL")
  .option("--source-license <license>", "source template license")
  .option("--source-author <author>", "source template author")
  .option("--pack <id>", "also write a pack containing imported agents")
  .option("--pack-out <dir>", "registry/packs output directory for --pack")
  .option("--pack-name <name>", "pack display name")
  .option("--pack-description <description>", "pack description")
  .description("Clone a GitHub repository and normalize Markdown agents into registry JSON")
  .action(
    async (
      repo: string,
      options: {
        target: string;
        out: string;
        ref?: string;
        path?: string;
        recursive: boolean;
        overwrite?: boolean;
        category?: string;
        tag?: string[];
        version: string;
        sourceUrl?: string;
        sourceLicense?: string;
        sourceAuthor?: string;
        pack?: string;
        packOut?: string;
        packName?: string;
        packDescription?: string;
      }
    ) => {
      const target = parseTarget(options.target);
      if (target === "all") throw new Error("Import target must be one of claude, codex, or opencode.");
      if (options.pack && !options.packOut) throw new Error("--pack-out is required when --pack is provided.");

      const cloned = await cloneGitHubRepository(repo, options.ref);
      try {
        const checkoutRoot = resolve(cloned.checkoutDir);
        const scanPath = options.path ? resolve(checkoutRoot, options.path) : checkoutRoot;
        if (scanPath !== checkoutRoot && !scanPath.startsWith(`${checkoutRoot}${sep}`)) {
          throw new Error(`Import path escapes the cloned repository: ${options.path}`);
        }
        const sourceUrl = options.sourceUrl ?? githubTreeUrl(cloned.repository, options.ref ?? "HEAD", options.path);
        const result = await importMarkdownDirectory({
          sourceDir: scanPath,
          target,
          outDir: resolve(options.out),
          recursive: options.recursive,
          overwrite: options.overwrite,
          category: options.category,
          tags: options.tag,
          version: options.version,
          provenance: provenanceFromOptions({
            sourceUrl,
            sourceRepo: cloned.repository.repository,
            sourceLicense: options.sourceLicense,
            sourceAuthor: options.sourceAuthor
          }),
          pack: options.pack
            ? {
                id: options.pack,
                name: options.packName,
                description: options.packDescription,
                outDir: resolve(options.packOut!)
              }
            : undefined
        });
        console.log(pc.green(`Imported ${result.imported.length} agents from ${cloned.repository.repository} into ${resolve(options.out)}`));
        if (result.skipped.length > 0) {
          console.log(pc.yellow(`Skipped ${result.skipped.length} files due to duplicate ids or existing outputs.`));
        }
        if (result.pack) {
          console.log(pc.green(`Wrote pack ${result.pack.id} with ${result.pack.agents.length} agents.`));
        }
      } finally {
        await cloned.cleanup();
      }
    }
  );

function provenanceFromOptions(options: {
  sourceUrl?: string;
  sourceRepo?: string;
  sourceLicense?: string;
  sourceAuthor?: string;
}) {
  if (!options.sourceUrl && !options.sourceRepo && !options.sourceLicense && !options.sourceAuthor) return undefined;
  return {
    source: options.sourceUrl,
    repository: options.sourceRepo,
    license: options.sourceLicense,
    author: options.sourceAuthor
  };
}

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = 1;
});
