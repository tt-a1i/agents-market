import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectSignals } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectProject(root: string): Promise<ProjectSignals> {
  const files: string[] = await readdir(root).catch(() => []);
  const signals: ProjectSignals = {
    root,
    languages: [],
    frameworks: [],
    files
  };

  if (files.includes("pnpm-lock.yaml")) signals.packageManager = "pnpm";
  else if (files.includes("yarn.lock")) signals.packageManager = "yarn";
  else if (files.includes("bun.lockb") || files.includes("bun.lock")) signals.packageManager = "bun";
  else if (files.includes("package-lock.json") || files.includes("package.json")) signals.packageManager = "npm";

  if (files.includes("package.json")) {
    signals.languages.push("javascript");
    const raw = await readFile(join(root, "package.json"), "utf8").catch(() => "{}");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if ("typescript" in deps || files.includes("tsconfig.json")) signals.languages.push("typescript");
    if ("next" in deps) signals.frameworks.push("nextjs");
    if ("react" in deps) signals.frameworks.push("react");
    if ("vue" in deps) signals.frameworks.push("vue");
    if ("svelte" in deps) signals.frameworks.push("svelte");
    if ("playwright" in deps || "@playwright/test" in deps) signals.frameworks.push("playwright");
    if ("tailwindcss" in deps) signals.frameworks.push("tailwind");
  }

  if (files.includes("Cargo.toml")) signals.languages.push("rust");
  if (files.includes("go.mod")) signals.languages.push("go");
  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) signals.languages.push("python");
  if (await exists(join(root, "Dockerfile"))) signals.frameworks.push("docker");

  signals.languages = [...new Set(signals.languages)];
  signals.frameworks = [...new Set(signals.frameworks)];
  return signals;
}
