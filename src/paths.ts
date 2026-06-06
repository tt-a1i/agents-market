import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function packageRoot(): string {
  return resolve(here, "..");
}

export function registryRoot(): string {
  return resolve(packageRoot(), "registry");
}
