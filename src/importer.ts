import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { agentSchema, packSchema } from "./schema.js";
import { CLI_VERSION } from "./constants.js";
import { sha256 } from "./hash.js";
import type { AgentDefinition, PackDefinition, PermissionMode, Target } from "./types.js";

type FrontmatterValue = string | string[] | Record<string, string>;

interface ParsedMarkdownAgent {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
}

export interface ImportMarkdownOptions {
  sourcePath: string;
  target: Target;
  outDir?: string;
  category?: string;
  tags?: string[];
  version?: string;
  provenance?: AgentDefinition["provenance"];
}

export interface ImportDirectoryOptions {
  sourceDir: string;
  target: Target;
  outDir: string;
  category?: string;
  tags?: string[];
  version?: string;
  provenance?: AgentDefinition["provenance"];
  recursive?: boolean;
  overwrite?: boolean;
  pack?: {
    id: string;
    name?: string;
    description?: string;
    outDir: string;
  };
}

export interface ImportDirectoryResult {
  imported: AgentDefinition[];
  skipped: string[];
  pack?: PackDefinition;
}

export interface ImportedAgentSummary {
  id: string;
  name: string;
  version: string;
  category: string;
  permission: PermissionMode;
  recommendedTargets: Target[];
  provenance?: AgentDefinition["provenance"];
}

export interface ImportedPackSummary {
  id: string;
  name: string;
  version: string;
  agents: string[];
}

export interface ImportReport {
  importedCount: number;
  skippedCount: number;
  imported: ImportedAgentSummary[];
  skipped: string[];
  pack?: ImportedPackSummary;
}

export async function importMarkdownAgent(options: ImportMarkdownOptions): Promise<AgentDefinition> {
  const raw = await readFile(options.sourcePath, "utf8");
  const parsed = parseMarkdownAgent(raw);
  const id = slug(String(parsed.frontmatter.name ?? parse(options.sourcePath).name));
  const description = String(parsed.frontmatter.description ?? `${humanize(id)} imported agent.`);
  const permission = inferPermission(parsed.frontmatter);
  const tools = inferTools(parsed.frontmatter, permission);
  const modelValue = typeof parsed.frontmatter.model === "string" ? parsed.frontmatter.model : undefined;
  const agent = agentSchema.parse({
    id,
    name: humanize(id),
    description,
    version: options.version ?? "0.1.0",
    category: options.category ?? inferCategory(id, description),
    tags: options.tags ?? inferTags(id, description),
    permission,
    recommendedTargets: [options.target],
    prompt: parsed.body.trim(),
    model: modelValue ? { [options.target]: modelValue } : undefined,
    tools,
    provenance: options.provenance
      ? {
          ...options.provenance,
          sourceSha256: options.provenance.sourceSha256 ?? sha256(raw),
          importedAt: options.provenance.importedAt ?? new Date().toISOString()
        }
      : undefined
  });

  if (options.outDir) {
    const outPath = join(options.outDir, `${agent.id}.json`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(agent, null, 2)}\n`, "utf8");
  }

  return agent;
}

export async function importMarkdownDirectory(options: ImportDirectoryOptions): Promise<ImportDirectoryResult> {
  const files = await findMarkdownFiles(options.sourceDir, options.recursive ?? true);
  const imported: AgentDefinition[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const agent = await importMarkdownAgent({
      sourcePath: file,
      target: options.target,
      category: options.category,
      tags: options.tags,
      version: options.version,
      provenance: inferFileProvenance(options.provenance, file)
    });
    const outPath = join(options.outDir, `${agent.id}.json`);
    if (seen.has(agent.id)) {
      skipped.push(file);
      continue;
    }
    seen.add(agent.id);
    if (!options.overwrite && (await fileExists(outPath))) {
      skipped.push(file);
      continue;
    }
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(agent, null, 2)}\n`, "utf8");
    imported.push(agent);
  }

  let pack: PackDefinition | undefined;
  if (options.pack && imported.length > 0) {
    pack = packSchema.parse({
      id: slug(options.pack.id),
      name: options.pack.name ?? humanize(options.pack.id),
      description: options.pack.description ?? `Imported pack containing ${imported.length} normalized agents.`,
      version: options.version ?? "0.1.0",
      tags: options.tags ?? ["imported"],
      agents: imported.map((agent) => agent.id),
      requires: {
        agentsMarket: `>=${CLI_VERSION}`
      },
      recommendedFor: {}
    });
    const packPath = join(options.pack.outDir, `${pack.id}.json`);
    await mkdir(dirname(packPath), { recursive: true });
    await writeFile(packPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  }

  return { imported, skipped, pack };
}

export function createImportReport(result: ImportDirectoryResult): ImportReport {
  return {
    importedCount: result.imported.length,
    skippedCount: result.skipped.length,
    imported: result.imported.map(summarizeImportedAgent),
    skipped: result.skipped,
    pack: result.pack
      ? {
          id: result.pack.id,
          name: result.pack.name,
          version: result.pack.version,
          agents: result.pack.agents
        }
      : undefined
  };
}

export function summarizeImportedAgent(agent: AgentDefinition): ImportedAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    version: agent.version,
    category: agent.category,
    permission: agent.permission,
    recommendedTargets: agent.recommendedTargets,
    provenance: agent.provenance
  };
}

function inferFileProvenance(
  provenance: AgentDefinition["provenance"] | undefined,
  file: string
): AgentDefinition["provenance"] | undefined {
  if (!provenance) return undefined;
  return {
    ...provenance,
    source: provenance.source ?? file,
    importedAt: provenance.importedAt ?? new Date().toISOString()
  };
}

export function parseMarkdownAgent(raw: string): ParsedMarkdownAgent {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error("Markdown agent frontmatter is not closed.");
  }
  const yaml = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  return { frontmatter: parseSimpleYaml(yaml), body };
}

function parseSimpleYaml(yaml: string): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = {};
  const lines = yaml.split(/\r?\n/);
  let currentObjectKey: string | undefined;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const nested = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && currentObjectKey) {
      const object = (result[currentObjectKey] ?? {}) as Record<string, string>;
      object[nested[1]!] = stripQuotes(nested[2] ?? "");
      result[currentObjectKey] = object;
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2] ?? "";
    if (value === "") {
      currentObjectKey = key;
      result[key] = {};
      continue;
    }
    currentObjectKey = undefined;
    result[key] = parseYamlScalar(value);
  }
  return result;
}

function parseYamlScalar(value: string): string | string[] {
  const trimmed = stripQuotes(value.trim());
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean);
  }
  if (trimmed.includes(",") && /^[A-Za-z0-9_, -]+$/.test(trimmed)) {
    return trimmed
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean);
  }
  return trimmed;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function inferPermission(frontmatter: Record<string, FrontmatterValue>): PermissionMode {
  const permission = frontmatter.permission;
  if (typeof permission === "object" && !Array.isArray(permission)) {
    if (permission.write === "deny" && permission.edit === "deny") return "readonly";
    if (permission.write === "ask" || permission.edit === "ask") return "safe-write";
  }
  const tools = toList(frontmatter.tools).map((tool) => tool.toLowerCase());
  if (tools.some((tool) => tool.includes("write") || tool.includes("edit"))) return "safe-write";
  if (tools.some((tool) => tool.includes("bash"))) return "command";
  return "readonly";
}

function inferTools(frontmatter: Record<string, FrontmatterValue>, permission: PermissionMode): AgentDefinition["tools"] {
  const tools = toList(frontmatter.tools).map((tool) => tool.toLowerCase());
  return {
    read: true,
    edit: permission !== "readonly" || tools.some((tool) => tool.includes("edit")),
    write: permission === "write" || tools.some((tool) => tool.includes("write")),
    bash:
      tools.some((tool) => tool.includes("bash")) || permission === "command"
        ? "safe"
        : "none",
    web: tools.some((tool) => tool.includes("web"))
  };
}

function toList(value: FrontmatterValue | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.keys(value);
  return value.split(",").map((item) => item.trim());
}

function inferCategory(id: string, description: string): string {
  const text = `${id} ${description}`.toLowerCase();
  if (text.includes("review")) return "review";
  if (text.includes("test") || text.includes("verify")) return "verification";
  if (text.includes("debug")) return "debugging";
  if (text.includes("front") || text.includes("ui") || text.includes("accessibility")) return "frontend";
  if (text.includes("doc") || text.includes("research")) return "research";
  return "general";
}

function inferTags(id: string, description: string): string[] {
  const text = `${id} ${description}`.toLowerCase();
  const candidates = ["review", "debugging", "tests", "frontend", "accessibility", "docs", "research", "security", "performance"];
  return candidates.filter((candidate) => text.includes(candidate.replace("tests", "test")));
}

function slug(value: string): string {
  return basename(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanize(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function findMarkdownFiles(root: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...(await findMarkdownFiles(path, recursive)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path);
    }
  }
  return files.sort();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
