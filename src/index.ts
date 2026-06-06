#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { dirname, resolve, sep } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createRegistryBundle, loadRegistryWithInfo } from "./registry.js";
import { buildCatalog } from "./catalog.js";
import { lintRegistry } from "./registry-lint.js";
import { detectProject } from "./project.js";
import { recommendPackDetails, recommendPacks } from "./recommend.js";
import { auditPack } from "./audit.js";
import { runDoctor } from "./doctor.js";
import { createInstallPlan, generatePackFiles } from "./install.js";
import { generateIntegrations } from "./integrations.js";
import { cloneGitHubRepository, githubTreeUrl } from "./git-import.js";
import { importMarkdownAgent, importMarkdownDirectory } from "./importer.js";
import { searchRegistry, type SearchKind } from "./search.js";
import { readExisting, removeFile, summarizeFileChange, writeGeneratedFiles } from "./files.js";
import {
  loadManifest,
  loadRegistryLock,
  removeInstall,
  saveManifest,
  saveRegistryLock,
  upsertInstall
} from "./manifest.js";
import { sha256 } from "./hash.js";
import type { Target } from "./types.js";

const program = new Command();
const BUNDLED_REGISTRY_VERSION = "0.1.0";

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

async function loadProjectRegistry(root: string, registryOption?: string) {
  if (registryOption) return loadRegistryWithInfo(registryOption);
  const lock = await loadRegistryLock(root);
  return loadRegistryWithInfo(lock?.source);
}

program
  .name("agents-market")
  .description("Agent-native marketplace and installer for specialized coding subagents")
  .version("0.1.0");

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
          `agents-market audit ${selectedPack.id} --target ${target} --json`,
          `agents-market diff ${selectedPack.id} --target ${target}`,
          `agents-market install ${selectedPack.id} --target ${target}`,
          "agents-market doctor"
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
  .action(async (options: { agents?: boolean; registry?: string }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
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
  .option("--json", "print machine-readable JSON for dry-run output")
  .description("Install a pack into the current project")
  .action(async (packId: string, options: { target: string; cwd?: string; dryRun?: boolean; registry?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const loaded = await loadProjectRegistry(root, options.registry);
    const registry = loaded.registry;
    const target = parseTarget(options.target);
    const files = generatePackFiles(registry, packId, target);

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
        console.log(JSON.stringify({ packId, target, dryRun: true, changes }, null, 2));
        return;
      }
      for (const file of files) {
        const existing = await readExisting(root, file);
        console.log(`${summarizeFileChange(existing, file.content)} ${file.path}`);
      }
      return;
    }

    await writeGeneratedFiles(root, files);
    const manifest = await loadManifest(root);
    await saveManifest(
      root,
      upsertInstall(manifest, packId, target, files, new Date(), {
        source: loaded.source.value,
        version: loaded.source.version,
        sha256: loaded.source.sha256
      })
    );
    console.log(pc.green(`Installed ${files.length} files for ${packId} into ${root}`));
  });

program
  .command("plan")
  .argument("<pack>", "pack id to plan")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--no-json", "print human-readable output")
  .description("Create an install plan for a pack")
  .action(async (packId: string, options: { target: string; registry?: string; json?: boolean }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const target = parseTarget(options.target);
    const plan = createInstallPlan(registry, packId, target);
    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(`${plan.packId} -> ${plan.fileCount} files for ${plan.agentCount} agents`);
    for (const file of plan.files) {
      console.log(`${file.path} (${file.target}, ${file.agentId})`);
    }
  });

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
    console.log(`- provenance: bundled ${audit.provenance.bundled}, imported ${audit.provenance.imported}, licensed ${audit.provenance.withLicense}`);
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

program
  .command("status")
  .description("Show installed packs and whether generated files drifted")
  .option("--cwd <path>", "project root to inspect")
  .action(async (options: { cwd?: string }) => {
    const root = cwd(options.cwd);
    const manifest = await loadManifest(root);

    if (manifest.installs.length === 0) {
      console.log("No packs installed by Agents Market.");
      return;
    }

    for (const install of manifest.installs) {
      console.log(`${pc.bold(install.packId)} (${install.target}) installed ${install.installedAt}`);
      for (const file of install.files) {
        const current = await readExisting(root, { path: file.path, content: "" });
        const state =
          current === undefined ? pc.red("missing") : sha256(current) === file.sha256 ? pc.green("clean") : pc.yellow("modified");
        console.log(`  ${state} ${file.path}`);
      }
    }
  });

program
  .command("doctor")
  .description("Run project health checks for Agents Market installs")
  .option("--cwd <path>", "project root to inspect")
  .option("--json", "print machine-readable JSON")
  .action(async (options: { cwd?: string; json?: boolean }) => {
    const root = cwd(options.cwd);
    const report = await runDoctor(root);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
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
  });

program
  .command("uninstall")
  .argument("<pack>", "pack id to uninstall")
  .option("-t, --target <target>", "claude, codex, opencode, or all")
  .option("--cwd <path>", "project root to uninstall from")
  .option("--force", "remove files even if they were modified")
  .description("Uninstall files previously installed by Agents Market")
  .action(async (packId: string, options: { target?: string; cwd?: string; force?: boolean }) => {
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
    for (const install of installs) {
      for (const file of install.files) {
        const current = await readExisting(root, { path: file.path, content: "" });
        if (current === undefined) continue;
        const changed = sha256(current) !== file.sha256;
        if (changed && !options.force) {
          skipped += 1;
          console.log(`${pc.yellow("skip modified")} ${file.path}`);
          continue;
        }
        await removeFile(root, file.path);
        removed += 1;
        console.log(`${pc.green("removed")} ${file.path}`);
      }
    }

    await saveManifest(root, removeInstall(manifest, packId, target));
    console.log(pc.green(`Uninstalled ${packId}: removed ${removed}, skipped ${skipped}.`));
  });

program
  .command("update")
  .argument("[pack]", "optional pack id to update; updates all installed packs when omitted")
  .option("--cwd <path>", "project root to update")
  .option("--force", "overwrite modified generated files")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .description("Update installed packs from the current registry")
  .action(async (packId: string | undefined, options: { cwd?: string; force?: boolean; registry?: string }) => {
    const root = cwd(options.cwd);
    const loaded = await loadProjectRegistry(root, options.registry);
    const registry = loaded.registry;
    const manifest = await loadManifest(root);
    const installs = manifest.installs.filter((entry) => !packId || entry.packId === packId);

    if (installs.length === 0) {
      console.log(pc.yellow(packId ? `No matching install found for ${packId}.` : "No packs installed by Agents Market."));
      return;
    }

    let written = 0;
    let skipped = 0;
    let nextManifest = manifest;
    for (const install of installs) {
      const files = generatePackFiles(registry, install.packId, install.target);
      const safeFiles = [];
      for (const file of files) {
        const previous = install.files.find((entry) => entry.path === file.path);
        const current = await readExisting(root, file);
        const modified = previous && current !== undefined && sha256(current) !== previous.sha256;
        if (modified && !options.force) {
          skipped += 1;
          console.log(`${pc.yellow("skip modified")} ${file.path}`);
          continue;
        }
        safeFiles.push(file);
      }

      await writeGeneratedFiles(root, safeFiles);
      written += safeFiles.length;
      nextManifest = upsertInstall(nextManifest, install.packId, install.target, files, new Date(), {
        source: loaded.source.value,
        version: loaded.source.version,
        sha256: loaded.source.sha256
      });
    }

    await saveManifest(root, nextManifest);
    console.log(pc.green(`Updated packs: wrote ${written}, skipped ${skipped}.`));
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

const registryCommand = program.command("registry").description("Registry utilities");

registryCommand
  .command("export")
  .requiredOption("-o, --out <path>", "output registry bundle path")
  .option("--registry <source>", "registry source to bundle", "bundled")
  .option("--name <name>", "bundle name", "agents-market")
  .option("--version <version>", "bundle version", BUNDLED_REGISTRY_VERSION)
  .description("Export a registry source as a single portable JSON bundle")
  .action(async (options: { out: string; registry: string; name: string; version: string }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const bundle = createRegistryBundle(registry, options.version, options.name);
    const out = resolve(options.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    console.log(pc.green(`Wrote registry bundle to ${out}`));
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
  .command("lint")
  .option("--registry <source>", "registry source to lint", "bundled")
  .option("--strict", "treat warnings as failures")
  .description("Lint registry quality, safety, and pack references")
  .action(async (options: { registry: string; strict?: boolean }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const report = lintRegistry(registry);
    for (const finding of report.findings) {
      const label = finding.severity === "error" ? pc.red("error") : pc.yellow("warning");
      console.log(`${label} ${finding.code} ${finding.subject}: ${finding.message}`);
    }
    console.log(`Score: ${report.score}/100 (${report.errorCount} errors, ${report.warningCount} warnings)`);
    if (report.errorCount > 0 || (options.strict && report.warningCount > 0)) {
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

const catalogCommand = program.command("catalog").description("Build static marketplace catalog assets");

catalogCommand
  .command("build")
  .requiredOption("-o, --out <path>", "output directory")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .option("--version <version>", "catalog registry bundle version", BUNDLED_REGISTRY_VERSION)
  .option("--title <title>", "catalog site title", "Agents Market")
  .description("Build a static Web catalog for packs and agents")
  .action(async (options: { out: string; registry?: string; version: string; title: string }) => {
    const { registry } = await loadRegistryWithInfo(options.registry);
    const files = await buildCatalog(registry, {
      outDir: resolve(options.out),
      version: options.version,
      title: options.title
    });
    console.log(pc.green(`Built catalog with ${files.length} files in ${resolve(options.out)}`));
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
