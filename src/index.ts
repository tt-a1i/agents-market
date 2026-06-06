#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { resolve } from "node:path";
import { loadRegistry } from "./registry.js";
import { detectProject } from "./project.js";
import { recommendPacks } from "./recommend.js";
import { generatePackFiles } from "./install.js";
import { readExisting, removeFile, summarizeFileChange, writeGeneratedFiles } from "./files.js";
import { loadManifest, removeInstall, saveManifest, upsertInstall } from "./manifest.js";
import { sha256 } from "./hash.js";
import type { Target } from "./types.js";

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

program
  .name("agents-market")
  .description("Agent-native marketplace and installer for specialized coding subagents")
  .version("0.1.0");

program
  .command("list")
  .description("List available agent packs and agents")
  .option("--agents", "show individual agents")
  .action(async (options: { agents?: boolean }) => {
    const registry = await loadRegistry();
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
  .action(async (options: { cwd?: string }) => {
    const root = cwd(options.cwd);
    const registry = await loadRegistry();
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
  .description("Preview files that would be written")
  .action(async (packId: string, options: { target: string; cwd?: string }) => {
    const root = cwd(options.cwd);
    const registry = await loadRegistry();
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
  .description("Install a pack into the current project")
  .action(async (packId: string, options: { target: string; cwd?: string; dryRun?: boolean }) => {
    const root = cwd(options.cwd);
    const registry = await loadRegistry();
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
    await saveManifest(root, upsertInstall(manifest, packId, target, files));
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
  .description("Update installed packs from the current registry")
  .action(async (packId: string | undefined, options: { cwd?: string; force?: boolean }) => {
    const root = cwd(options.cwd);
    const registry = await loadRegistry();
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
      nextManifest = upsertInstall(nextManifest, install.packId, install.target, files);
    }

    await saveManifest(root, nextManifest);
    console.log(pc.green(`Updated packs: wrote ${written}, skipped ${skipped}.`));
  });

program
  .command("export")
  .argument("<pack>", "pack id to export")
  .requiredOption("-o, --out <path>", "output directory")
  .option("-t, --target <target>", "claude, codex, opencode, or all", "all")
  .description("Export generated agent files to a directory")
  .action(async (packId: string, options: { out: string; target: string }) => {
    const registry = await loadRegistry();
    const files = generatePackFiles(registry, packId, parseTarget(options.target));
    await writeGeneratedFiles(resolve(options.out), files);
    console.log(pc.green(`Exported ${files.length} files to ${resolve(options.out)}`));
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = 1;
});
