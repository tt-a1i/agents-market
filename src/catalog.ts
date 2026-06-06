import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auditPack } from "./audit.js";
import { createRegistryBundle, validateRegistry } from "./registry.js";
import { registryBundleSchema } from "./schema.js";
import type { Registry, RegistryBundle } from "./types.js";

export interface CatalogOptions {
  outDir: string;
  version: string;
  title?: string;
  baseUrl?: string;
}

export interface CatalogVerificationFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  detail?: string;
}

export interface CatalogVerificationReport {
  ok: boolean;
  dir: string;
  errorCount: number;
  warningCount: number;
  findings: CatalogVerificationFinding[];
}

export async function buildCatalog(registry: Registry, options: CatalogOptions): Promise<string[]> {
  const title = options.title ?? "Agents Market";
  await mkdir(options.outDir, { recursive: true });

  const bundle = createRegistryBundle(registry, options.version, "agents-market");
  const bundleUrl = assetUrl("registry.bundle.json", options.baseUrl);
  const catalog = {
    title,
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    registryBundleUrl: bundleUrl,
    packCount: registry.packs.length,
    agentCount: registry.agents.length,
    changelog: registry.changelog ?? [],
    packs: registry.packs.map((pack) => packCatalogSummary(registry, pack.id, bundleUrl)),
    agents: registry.agents
  };

  const files = [
    {
      name: "registry.bundle.json",
      content: `${JSON.stringify(bundle, null, 2)}\n`
    },
    {
      name: "catalog.json",
      content: `${JSON.stringify(catalog, null, 2)}\n`
    },
    {
      name: "index.html",
      content: renderHtml(title, registry, bundleUrl)
    }
  ];

  for (const file of files) {
    await writeFile(join(options.outDir, file.name), file.content, "utf8");
  }

  return files.map((file) => join(options.outDir, file.name));
}

export async function verifyCatalog(dir: string): Promise<CatalogVerificationReport> {
  const findings: CatalogVerificationFinding[] = [];
  const catalog = await readJson(join(dir, "catalog.json"), findings, "catalog.json");
  const bundle = await readJson(join(dir, "registry.bundle.json"), findings, "registry.bundle.json");
  const html = await readText(join(dir, "index.html"), findings, "index.html");

  let registryBundle: RegistryBundle | undefined;
  if (bundle) {
    try {
      registryBundle = registryBundleSchema.parse(bundle);
      validateRegistry(registryBundle);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "invalid-registry-bundle",
        message: "registry.bundle.json is not a valid registry bundle.",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (catalog && registryBundle) {
    verifyCatalogAgainstBundle(catalog, registryBundle, findings);
  }

  if (catalog && html) {
    const bundleUrl = stringValue(catalog.registryBundleUrl);
    if (bundleUrl && !html.includes(bundleUrl)) {
      findings.push({
        severity: "error",
        code: "html-missing-bundle-url",
        message: "index.html does not reference the catalog registry bundle URL.",
        detail: bundleUrl
      });
    }
    if (!html.includes("data-copy=")) {
      findings.push({
        severity: "error",
        code: "html-missing-copy-controls",
        message: "index.html does not include copy controls for workflow commands."
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  return {
    ok: errorCount === 0,
    dir,
    errorCount,
    warningCount,
    findings
  };
}

function verifyCatalogAgainstBundle(catalog: Record<string, unknown>, bundle: RegistryBundle, findings: CatalogVerificationFinding[]): void {
  const registry: Registry = { agents: bundle.agents, packs: bundle.packs, changelog: bundle.changelog };
  if (catalog.packCount !== bundle.packs.length) {
    findings.push({
      severity: "error",
      code: "pack-count-mismatch",
      message: "catalog.json packCount does not match registry.bundle.json.",
      detail: `${catalog.packCount ?? "missing"} !== ${bundle.packs.length}`
    });
  }
  if (catalog.agentCount !== bundle.agents.length) {
    findings.push({
      severity: "error",
      code: "agent-count-mismatch",
      message: "catalog.json agentCount does not match registry.bundle.json.",
      detail: `${catalog.agentCount ?? "missing"} !== ${bundle.agents.length}`
    });
  }
  const catalogChangelog = Array.isArray(catalog.changelog) ? catalog.changelog : [];
  const bundleChangelog = bundle.changelog ?? [];
  if (!Array.isArray(catalog.changelog)) {
    findings.push({
      severity: "error",
      code: "catalog-changelog-missing",
      message: "catalog.json does not include a changelog array."
    });
  } else if (catalogChangelog.length !== bundleChangelog.length) {
    findings.push({
      severity: "error",
      code: "changelog-count-mismatch",
      message: "catalog.json changelog length does not match registry.bundle.json.",
      detail: `${catalogChangelog.length} !== ${bundleChangelog.length}`
    });
  } else if (bundleChangelog[0] && isRecord(catalogChangelog[0]) && catalogChangelog[0].version !== bundleChangelog[0].version) {
    findings.push({
      severity: "error",
      code: "changelog-latest-mismatch",
      message: "catalog.json latest changelog entry does not match registry.bundle.json.",
      detail: `${String(catalogChangelog[0].version)} !== ${bundleChangelog[0].version}`
    });
  }

  const bundleUrl = stringValue(catalog.registryBundleUrl) ?? "registry.bundle.json";
  const catalogPacks = Array.isArray(catalog.packs) ? catalog.packs : [];
  if (!Array.isArray(catalog.packs)) {
    findings.push({
      severity: "error",
      code: "catalog-packs-missing",
      message: "catalog.json does not include a packs array."
    });
    return;
  }

  for (const pack of bundle.packs) {
    const catalogPack = catalogPacks.find((candidate) => isRecord(candidate) && candidate.id === pack.id);
    if (!isRecord(catalogPack)) {
      findings.push({
        severity: "error",
        code: "catalog-pack-missing",
        message: "catalog.json is missing a pack from registry.bundle.json.",
        detail: pack.id
      });
      continue;
    }
    const expected = packCatalogSummary(registry, pack.id, bundleUrl);
    if (catalogPack.previewCommand !== expected.previewCommand) {
      findings.push({
        severity: "error",
        code: "preview-command-mismatch",
        message: "Catalog preview command does not match the registry bundle.",
        detail: pack.id
      });
    }
    if (catalogPack.installCommand !== expected.installCommand) {
      findings.push({
        severity: "error",
        code: "install-command-mismatch",
        message: "Catalog install command does not match the registry bundle.",
        detail: pack.id
      });
    }
    if (JSON.stringify(catalogPack.workflowCommands) !== JSON.stringify(expected.workflowCommands)) {
      findings.push({
        severity: "error",
        code: "workflow-commands-mismatch",
        message: "Catalog workflow commands do not match the registry bundle.",
        detail: pack.id
      });
    }
    const catalogAudit = isRecord(catalogPack.audit) ? catalogPack.audit : undefined;
    if (!catalogAudit || catalogAudit.risk !== expected.audit.risk || catalogAudit.fileCount !== expected.audit.fileCount) {
      findings.push({
        severity: "error",
        code: "audit-mismatch",
        message: "Catalog audit summary does not match the registry bundle.",
        detail: pack.id
      });
    }
  }
}

async function readJson(path: string, findings: CatalogVerificationFinding[], label: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    findings.push({
      severity: "error",
      code: "missing-or-invalid-file",
      message: `${label} could not be read as JSON.`,
      detail: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

async function readText(path: string, findings: CatalogVerificationFinding[], label: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    findings.push({
      severity: "error",
      code: "missing-file",
      message: `${label} could not be read.`,
      detail: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function assetUrl(path: string, baseUrl?: string): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function renderHtml(title: string, registry: Registry, bundlePath: string): string {
  const packs = registry.packs
    .map((pack) => {
      const summary = packCatalogSummary(registry, pack.id, bundlePath);
      const agents = summary.agents
        .map((agent) => `<li><code>${escapeHtml(agent.id)}</code> ${escapeHtml(agent.description)}</li>`)
        .join("");
      const warnings =
        summary.audit.warnings.length > 0
          ? `<ul class="warnings">${summary.audit.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
          : "";
      const commands = summary.workflowCommands
        .map(
          (command) => `<div class="command">
            <div class="command-label">${escapeHtml(command.label)}</div>
            <pre>${escapeHtml(command.command)}</pre>
            <button type="button" data-copy="${escapeHtml(command.command)}">Copy</button>
          </div>`
        )
        .join("");
      return `<article class="card" data-search="${escapeHtml(`${pack.id} ${pack.name} ${pack.description} ${pack.tags.join(" ")} ${summary.audit.risk}`)}">
        <div class="eyebrow">${escapeHtml(pack.tags.join(" / ") || "pack")}</div>
        <h2>${escapeHtml(pack.name)}</h2>
        <p>${escapeHtml(pack.description)}</p>
        <div class="meta">
          <span>risk: <strong>${escapeHtml(summary.audit.risk)}</strong></span>
          <span>${summary.audit.agentCount} agents</span>
          <span>${summary.audit.fileCount} files</span>
        </div>
        <div class="commands">${commands}</div>
        ${warnings}
        <ul>${agents}</ul>
      </article>`;
    })
    .join("\n");

  const agents = registry.agents
    .map(
      (agent) => `<tr data-search="${escapeHtml(`${agent.id} ${agent.name} ${agent.description} ${agent.tags.join(" ")} ${agent.provenance?.repository ?? ""} ${agent.provenance?.license ?? ""}`)}">
        <td><code>${escapeHtml(agent.id)}</code></td>
        <td>${escapeHtml(agent.category)}</td>
        <td>${escapeHtml(agent.permission)}</td>
        <td>${renderProvenance(agent.provenance)}</td>
        <td>${escapeHtml(agent.description)}</td>
      </tr>`
    )
    .join("\n");

  const changelog = (registry.changelog ?? [])
    .slice(0, 6)
    .map((entry) => {
      const details = [
        ...(entry.added ?? []).map((item) => `<li><strong>Added:</strong> ${escapeHtml(item)}</li>`),
        ...(entry.changed ?? []).map((item) => `<li><strong>Changed:</strong> ${escapeHtml(item)}</li>`),
        ...(entry.removed ?? []).map((item) => `<li><strong>Removed:</strong> ${escapeHtml(item)}</li>`)
      ].join("");
      return `<article class="changelog-entry" data-search="${escapeHtml(`${entry.version} ${entry.date} ${entry.summary}`)}">
        <div class="eyebrow">${escapeHtml(entry.version)} / ${escapeHtml(entry.date)}</div>
        <p>${escapeHtml(entry.summary)}</p>
        ${details ? `<ul>${details}</ul>` : ""}
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #172026; --muted: #5f6b76; --line: #d7dde3; --fill: #f6f8fa; --accent: #0f766e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fff; }
    header { padding: 48px 24px 28px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, #f8fbfb 0%, #fff 100%); }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 24px 64px; }
    .hero { max-width: 1120px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-size: 40px; line-height: 1.05; letter-spacing: 0; }
    h2 { margin: 8px 0 10px; font-size: 22px; }
    p { color: var(--muted); line-height: 1.6; }
    .toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 24px 0; }
    input { min-width: min(100%, 360px); height: 40px; border: 1px solid var(--line); border-radius: 6px; padding: 0 12px; font: inherit; }
    a.button { display: inline-flex; align-items: center; height: 40px; border-radius: 6px; background: var(--ink); color: white; text-decoration: none; padding: 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid var(--line); border-radius: 8px; padding: 18px; background: #fff; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 13px; margin: 12px 0; }
    .meta span { border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; background: var(--fill); }
    .commands { display: grid; gap: 10px; margin: 14px 0; }
    .command { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
    .command-label { grid-column: 1 / -1; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    pre { overflow-x: auto; margin: 0; padding: 12px; border-radius: 6px; background: var(--fill); border: 1px solid var(--line); font-size: 13px; }
    button { height: 40px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); padding: 0 12px; font: inherit; cursor: pointer; }
    button.copied { border-color: var(--accent); color: var(--accent); }
    ul { padding-left: 20px; }
    li { margin: 8px 0; color: var(--muted); }
    .warnings { border-left: 3px solid #b45309; padding-left: 16px; }
    .changelog { display: grid; gap: 12px; }
    .changelog-entry { border-left: 3px solid var(--accent); padding: 4px 0 4px 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 12px 8px; }
    th { color: var(--muted); font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .section { margin-top: 36px; }
    @media (max-width: 640px) { h1 { font-size: 32px; } header { padding-top: 32px; } }
  </style>
</head>
<body>
  <header>
    <div class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p>Curated, cross-tool subagent packs for Claude Code, Codex, and OpenCode. Preview, lock, install, update, and uninstall with one CLI.</p>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search packs and agents" aria-label="Search packs and agents">
        <a class="button" href="${escapeHtml(bundlePath)}">Download registry bundle</a>
      </div>
    </div>
  </header>
  <main>
    <section>
      <h2>Packs</h2>
      <div class="grid">${packs}</div>
    </section>
    ${
      changelog
        ? `<section class="section">
      <h2>Changelog</h2>
      <div class="changelog">${changelog}</div>
    </section>`
        : ""
    }
    <section class="section">
      <h2>Agents</h2>
      <table>
        <thead><tr><th>ID</th><th>Category</th><th>Permission</th><th>Source</th><th>Description</th></tr></thead>
        <tbody>${agents}</tbody>
      </table>
    </section>
  </main>
  <script>
    const input = document.querySelector("#search");
    const searchable = [...document.querySelectorAll("[data-search]")];
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      for (const item of searchable) {
        item.style.display = !query || item.dataset.search.toLowerCase().includes(query) ? "" : "none";
      }
    });
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-copy]");
      if (!button) return;
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
      button.classList.add("copied");
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("copied");
      }, 1400);
    });
  </script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderProvenance(provenance: { source?: string; repository?: string; license?: string; author?: string } | undefined): string {
  if (!provenance) return "Bundled";
  const label = provenance.repository ?? provenance.author ?? provenance.license ?? provenance.source ?? "Imported";
  if (provenance.source?.startsWith("http://") || provenance.source?.startsWith("https://")) {
    return `<a href="${escapeHtml(provenance.source)}">${escapeHtml(label)}</a>`;
  }
  return escapeHtml(label);
}

function packCatalogSummary(registry: Registry, packId: string, bundlePath: string) {
  const pack = registry.packs.find((candidate) => candidate.id === packId);
  if (!pack) throw new Error(`Unknown pack: ${packId}`);
  const audit = auditPack(registry, pack.id, "all");
  const previewCommand = `npx @agents-market/cli apply ${pack.id} --target all --registry ${bundlePath} --policy-preset balanced --json`;
  const auditCommand = `npx @agents-market/cli audit ${pack.id} --target all --registry ${bundlePath} --json`;
  const diffCommand = `npx @agents-market/cli diff ${pack.id} --target all --registry ${bundlePath} --json`;
  const installCommand = `npx @agents-market/cli apply ${pack.id} --target all --registry ${bundlePath} --policy-preset balanced --yes`;
  return {
    ...pack,
    previewCommand,
    installCommand,
    auditCommand,
    diffCommand,
    workflowCommands: [
      { label: "Preview", command: previewCommand },
      { label: "Audit", command: auditCommand },
      { label: "Diff", command: diffCommand },
      { label: "Install", command: installCommand }
    ],
    audit,
    agents: pack.agents.map((id) => registry.agents.find((agent) => agent.id === id)).filter((agent) => agent !== undefined)
  };
}
