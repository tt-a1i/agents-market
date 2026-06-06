#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createRegistryBundle, loadRegistryWithInfo } from "./registry.js";
import { buildCatalog } from "./catalog.js";
import { lintRegistry } from "./registry-lint.js";
import { detectProject } from "./project.js";
import { recommendPacks } from "./recommend.js";
import { generatePackFiles } from "./install.js";
import { generateIntegrations } from "./integrations.js";
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
  .command("recommend")
  .description("Recommend packs for the current project")
  .option("--cwd <path>", "project root to scan")
  .option("--registry <source>", "registry source: bundled, directory, bundle file, or URL")
  .action(async (options: { cwd?: string; registry?: string }) => {
    const root = cwd(options.cwd);
    const { registry } = await loadProjectRegistry(root, options.registry);
    const signals = await detectProject(root);
    const packs = recommendPacks(registry, signals);

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
  .description("Preview files that would be written")
  .action(async (packId: string, options: { target: string; cwd?: string; registry?: string }) => {
    const root = cwd(options.cwd);
    const { registry } = await loadProjectRegistry(root, options.registry);
    const files = generatePackFiles(registry, packId, parseTarget(options.target));

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
  .description("Install a pack into the current project")
  .action(async (packId: string, options: { target: string; cwd?: string; dryRun?: boolean; registry?: string }) => {
    const root = cwd(options.cwd);
    const loaded = await loadProjectRegistry(root, options.registry);
    const registry = loaded.registry;
    const target = parseTarget(options.target);
    const files = generatePackFiles(registry, packId, target);

    if (options.dryRun) {
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

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = 1;
});
