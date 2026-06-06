#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { resolve } from "node:path";
import { loadRegistry } from "./registry.js";
import { detectProject } from "./project.js";
import { recommendPacks } from "./recommend.js";
import { generatePackFiles } from "./install.js";
import { readExisting, summarizeFileChange, writeGeneratedFiles } from "./files.js";
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
    console.log(pc.green(`Installed ${files.length} files for ${packId} into ${root}`));
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
