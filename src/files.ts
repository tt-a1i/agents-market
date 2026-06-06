import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GeneratedFile } from "./types.js";

export async function readExisting(root: string, file: GeneratedFile): Promise<string | undefined> {
  try {
    return await readFile(join(root, file.path), "utf8");
  } catch {
    return undefined;
  }
}

export async function writeGeneratedFiles(root: string, files: GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const absolute = join(root, file.path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content, "utf8");
  }
}

export async function removeFile(root: string, path: string): Promise<void> {
  await rm(join(root, path), { force: true });
}

export function summarizeFileChange(existing: string | undefined, next: string): "create" | "update" | "unchanged" {
  if (existing === undefined) return "create";
  if (existing === next) return "unchanged";
  return "update";
}
