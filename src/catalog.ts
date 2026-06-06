import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPack } from "./audit.js";
import { scorePromptQuality, scoreRegistryPrompts } from "./prompt-quality.js";
import { createRegistryBundle, signRegistryBundle, validateRegistry, verifyRegistryBundleSignature } from "./registry.js";
import { registryBundleSchema } from "./schema.js";
import type { AgentDefinition, Registry, RegistryBundle, RegistryMetadata, Target } from "./types.js";

export interface CatalogOptions {
  outDir: string;
  version: string;
  title?: string;
  baseUrl?: string;
  packageSpec?: string;
  homepage?: string;
  repository?: string;
  releaseUrl?: string;
  commit?: string;
  signingPrivateKeyPem?: string;
  signingPublicKeyPem?: string;
  signingKeyId?: string;
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
  source: {
    kind: "directory" | "url";
    value: string;
  };
  errorCount: number;
  warningCount: number;
  findings: CatalogVerificationFinding[];
  signatures?: {
    registry?: {
      ok: boolean;
      keyId?: string;
      algorithm?: string;
      error?: string;
    };
  };
}

export async function buildCatalog(registry: Registry, options: CatalogOptions): Promise<string[]> {
  const title = options.title ?? "Agents Market";
  await mkdir(options.outDir, { recursive: true });

  const bundleUrl = assetUrl("registry.bundle.json", options.baseUrl);
  const publicKeyUrl = options.signingPublicKeyPem ? assetUrl("registry-public.pem", options.baseUrl) : undefined;
  const packageSpec = options.packageSpec ?? "github:tt-a1i/agents-market";
  assertSafePackageSpec(packageSpec);
  const metadata = catalogMetadata(options, packageSpec);
  let bundle = createRegistryBundle(registry, options.version, "agents-market", metadata);
  if (options.signingPrivateKeyPem) {
    if (!options.signingKeyId) throw new Error("signingKeyId is required when signingPrivateKeyPem is provided.");
    bundle = signRegistryBundle(bundle, options.signingPrivateKeyPem, options.signingKeyId);
  }
  const promptQuality = scoreRegistryPrompts(registry.agents);
  const provenance = summarizeProvenance(registry.agents);
  const registryWorkflows = registryWorkflowCommands(packageSpec, bundleUrl, publicKeyUrl, options.signingKeyId);
  const importWorkflows = importWorkflowCommands(packageSpec);
  const catalog = {
    title,
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    packageSpec,
    metadata,
    registryBundleUrl: bundleUrl,
    packCount: registry.packs.length,
    agentCount: registry.agents.length,
    promptQuality,
    provenance,
    registryWorkflows,
    importWorkflows,
    changelog: registry.changelog ?? [],
    packs: registry.packs.map((pack) => packCatalogSummary(registry, pack.id, bundleUrl, packageSpec)),
    agents: registry.agents.map(agentCatalogSummary)
  };

  const files = [
    {
      name: "registry.bundle.json",
      content: `${JSON.stringify(bundle, null, 2)}\n`
    },
    ...(options.signingPublicKeyPem
      ? [
          {
            name: "registry-public.pem",
            content: options.signingPublicKeyPem
          }
        ]
      : []),
    {
      name: "catalog.json",
      content: `${JSON.stringify(catalog, null, 2)}\n`
    },
    {
      name: "index.html",
      content: renderHtml(title, registry, bundleUrl, packageSpec, metadata)
    },
    {
      name: "site.webmanifest",
      content: `${JSON.stringify(webManifest(title, options.baseUrl), null, 2)}\n`
    },
    {
      name: "robots.txt",
      content: "User-agent: *\nAllow: /\n"
    },
    {
      name: "favicon.svg",
      content: renderFavicon()
    }
  ];

  for (const file of files) {
    await writeFile(join(options.outDir, file.name), file.content, "utf8");
  }

  return files.map((file) => join(options.outDir, file.name));
}

export async function verifyCatalog(dir: string): Promise<CatalogVerificationReport> {
  const findings: CatalogVerificationFinding[] = [];
  const signatures: CatalogVerificationReport["signatures"] = {};
  const catalog = await readJson(join(dir, "catalog.json"), findings, "catalog.json");
  const bundle = await readJson(join(dir, "registry.bundle.json"), findings, "registry.bundle.json");
  const webManifestFile = await readJson(join(dir, "site.webmanifest"), findings, "site.webmanifest");
  const html = await readText(join(dir, "index.html"), findings, "index.html");
  await readText(join(dir, "robots.txt"), findings, "robots.txt");
  await readText(join(dir, "favicon.svg"), findings, "favicon.svg");

  let registryBundle: RegistryBundle | undefined;
  if (bundle) {
    try {
      registryBundle = registryBundleSchema.parse(bundle);
      validateRegistry(registryBundle);
      if ((registryBundle.signatures?.length ?? 0) > 0) {
        const publicKeyPem = await readText(join(dir, "registry-public.pem"), findings, "registry-public.pem");
        if (publicKeyPem) {
          signatures.registry = verifyRegistryBundleSignature(registryBundle, publicKeyPem, registryBundle.signatures?.[0]?.keyId);
          if (!signatures.registry.ok) {
            findings.push({
              severity: "error",
              code: "registry-signature-invalid",
              message: "registry.bundle.json signature could not be verified with registry-public.pem.",
              detail: signatures.registry.error
            });
          }
        }
      }
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
    if (!html.includes('const itemTargets = item.dataset.targets || "";')) {
      findings.push({
        severity: "error",
        code: "html-missing-target-filter-fallback",
        message: "index.html target filter does not tolerate searchable entries without target metadata."
      });
    }
    if (!html.includes('document.execCommand("copy")') || !html.includes("Copy failed")) {
      findings.push({
        severity: "error",
        code: "html-missing-copy-fallback",
        message: "index.html copy controls do not include a fallback for restricted Clipboard API contexts."
      });
    }
    if (!html.includes('rel="manifest"') || !html.includes('href="site.webmanifest"')) {
      findings.push({
        severity: "error",
        code: "html-missing-webmanifest",
        message: "index.html does not reference site.webmanifest."
      });
    }
    if (!html.includes('rel="icon"') || !html.includes('href="favicon.svg"')) {
      findings.push({
        severity: "error",
        code: "html-missing-favicon",
        message: "index.html does not reference favicon.svg."
      });
    }
  }

  if (catalog && webManifestFile) {
    const manifestName = stringValue(webManifestFile.name);
    if (manifestName !== catalog.title) {
      findings.push({
        severity: "error",
        code: "webmanifest-name-mismatch",
        message: "site.webmanifest name does not match catalog title.",
        detail: `${manifestName ?? "missing"} !== ${String(catalog.title ?? "missing")}`
      });
    }
    const icons = Array.isArray(webManifestFile.icons) ? webManifestFile.icons : [];
    if (!icons.some((icon) => isRecord(icon) && icon.src === "favicon.svg")) {
      findings.push({
        severity: "error",
        code: "webmanifest-missing-favicon",
        message: "site.webmanifest does not include favicon.svg as an icon."
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  return {
    ok: errorCount === 0,
    dir,
    source: { kind: "directory", value: dir },
    errorCount,
    warningCount,
    findings,
    ...(Object.keys(signatures).length > 0 ? { signatures } : {})
  };
}

export async function verifyCatalogUrl(url: string): Promise<CatalogVerificationReport> {
  const baseUrl = normalizeCatalogBaseUrl(url);
  const dir = await mkdtemp(join(tmpdir(), "agents-market-catalog-url-"));
  try {
    const bundleText = await fetchCatalogAsset(baseUrl, "registry.bundle.json");
    await Promise.all([
      writeFile(join(dir, "registry.bundle.json"), bundleText, "utf8"),
      fetchCatalogAsset(baseUrl, "catalog.json").then((content) => writeFile(join(dir, "catalog.json"), content, "utf8")),
      fetchCatalogAsset(baseUrl, "index.html").then((content) => writeFile(join(dir, "index.html"), content, "utf8")),
      fetchCatalogAsset(baseUrl, "robots.txt").then((content) => writeFile(join(dir, "robots.txt"), content, "utf8")),
      fetchCatalogAsset(baseUrl, "favicon.svg").then((content) => writeFile(join(dir, "favicon.svg"), content, "utf8")),
      fetchCatalogAsset(baseUrl, "site.webmanifest").then((content) => writeFile(join(dir, "site.webmanifest"), content, "utf8"))
    ]);

    const publicKeyPem = await fetchCatalogAssetOptional(baseUrl, "registry-public.pem");
    if (publicKeyPem) {
      await writeFile(join(dir, "registry-public.pem"), publicKeyPem, "utf8");
    }

    const report = await verifyCatalog(dir);
    await rm(dir, { recursive: true, force: true });
    return {
      ...report,
      dir: "",
      source: { kind: "url", value: baseUrl }
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
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
    const packageSpec = stringValue(catalog.packageSpec) ?? "github:tt-a1i/agents-market";
    const expected = packCatalogSummary(registry, pack.id, bundleUrl, packageSpec);
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
    const catalogQuality = isRecord(catalogPack.quality) ? catalogPack.quality : undefined;
    if (!catalogQuality || catalogQuality.averageScore !== expected.quality.averageScore || catalogQuality.grade !== expected.quality.grade) {
      findings.push({
        severity: "error",
        code: "quality-mismatch",
        message: "Catalog quality summary does not match the registry bundle.",
        detail: pack.id
      });
    }
  }

  const catalogQuality = isRecord(catalog.promptQuality) ? catalog.promptQuality : undefined;
  const expectedQuality = scoreRegistryPrompts(bundle.agents);
  if (!catalogQuality || catalogQuality.averageScore !== expectedQuality.averageScore || catalogQuality.minScore !== expectedQuality.minScore) {
    findings.push({
      severity: "error",
      code: "prompt-quality-mismatch",
      message: "catalog.json prompt quality summary does not match registry.bundle.json."
    });
  }

  const catalogProvenance = isRecord(catalog.provenance) ? catalog.provenance : undefined;
  const expectedProvenance = summarizeProvenance(bundle.agents);
  if (
    !catalogProvenance ||
    catalogProvenance.withProvenance !== expectedProvenance.withProvenance ||
    catalogProvenance.withChecksum !== expectedProvenance.withChecksum
  ) {
    findings.push({
      severity: "error",
      code: "provenance-summary-mismatch",
      message: "catalog.json provenance summary does not match registry.bundle.json."
    });
  }

  const workflows = Array.isArray(catalog.importWorkflows) ? catalog.importWorkflows : [];
  if (workflows.length < 3) {
    findings.push({
      severity: "error",
      code: "import-workflows-missing",
      message: "catalog.json does not include the expected import workflow commands."
    });
  }
  const registryWorkflows = Array.isArray(catalog.registryWorkflows) ? catalog.registryWorkflows : [];
  const packageSpec = stringValue(catalog.packageSpec) ?? "github:tt-a1i/agents-market";
  const expectedRegistryWorkflows = registryWorkflowCommands(
    packageSpec,
    bundleUrl,
    bundle.signatures?.length ? publicKeyUrlForBundle(bundleUrl) : undefined,
    bundle.signatures?.[0]?.keyId
  );
  if (JSON.stringify(registryWorkflows) !== JSON.stringify(expectedRegistryWorkflows)) {
    findings.push({
      severity: "error",
      code: "registry-workflows-mismatch",
      message: "catalog.json registry workflow commands do not match the registry bundle URL."
    });
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

function normalizeCatalogBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Catalog URL must use http or https: ${value}`);
  }
  if (parsed.pathname.endsWith("/catalog.json")) {
    parsed.pathname = parsed.pathname.slice(0, -"catalog.json".length);
  } else if (!parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function fetchCatalogAsset(baseUrl: string, asset: string): Promise<string> {
  const url = new URL(asset, baseUrl).toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog asset ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchCatalogAssetOptional(baseUrl: string, asset: string): Promise<string | undefined> {
  const url = new URL(asset, baseUrl).toString();
  const response = await fetch(url);
  if (!response.ok) return undefined;
  return response.text();
}

export function assertSafePackageSpec(packageSpec: string): void {
  if (!/^[A-Za-z0-9@._:/#-]+$/.test(packageSpec)) {
    throw new Error(`Unsafe package spec for generated commands: ${packageSpec}`);
  }
}

function renderHtml(
  title: string,
  registry: Registry,
  bundlePath: string,
  packageSpec: string,
  metadata?: RegistryMetadata
): string {
  const promptQuality = scoreRegistryPrompts(registry.agents);
  const provenance = summarizeProvenance(registry.agents);
  const registryWorkflows = registryWorkflowCommands(packageSpec, bundlePath);
  const importWorkflows = importWorkflowCommands(packageSpec);
  const packs = registry.packs
    .map((pack) => {
      const summary = packCatalogSummary(registry, pack.id, bundlePath, packageSpec);
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
      return `<article class="card" data-targets="${escapeHtml(summary.targetCoverage.join(" "))}" data-search="${escapeHtml(`${pack.id} ${pack.name} ${pack.description} ${pack.tags.join(" ")} ${summary.audit.risk} ${summary.quality.grade} ${summary.targetCoverage.join(" ")}`)}">
        <div class="eyebrow">${escapeHtml(pack.tags.join(" / ") || "pack")}</div>
        <h2>${escapeHtml(pack.name)}</h2>
        <p>${escapeHtml(pack.description)}</p>
        <div class="rating">
          <strong>${summary.rating.score.toFixed(1)}/${summary.rating.max}</strong>
          <span>${escapeHtml(summary.rating.label)}</span>
        </div>
        <div class="meta">
          <span>quality: <strong>${summary.quality.averageScore}/100</strong></span>
          <span>risk: <strong>${escapeHtml(summary.audit.risk)}</strong></span>
          <span>${summary.audit.agentCount} agents</span>
          <span>${summary.audit.fileCount} files</span>
          <span>${summary.provenance.withChecksum}/${summary.audit.agentCount} checksums</span>
          ${pack.requires?.agentsMarket ? `<span>requires Agents Market ${escapeHtml(pack.requires.agentsMarket)}</span>` : ""}
        </div>
        <div class="targets">${summary.targetCoverage.map((target) => `<span>${escapeHtml(target)}</span>`).join("")}</div>
        <div class="commands">${commands}</div>
        ${warnings}
        <ul>${agents}</ul>
      </article>`;
    })
    .join("\n");

  const agents = registry.agents
    .map((agent) => agentCatalogSummary(agent))
    .map(
      (agent) => `<tr data-targets="${escapeHtml(agent.recommendedTargets.join(" "))}" data-search="${escapeHtml(`${agent.id} ${agent.name} ${agent.description} ${agent.tags.join(" ")} ${agent.provenance?.repository ?? ""} ${agent.provenance?.license ?? ""} ${agent.quality.grade} ${agent.recommendedTargets.join(" ")}`)}">
        <td><code>${escapeHtml(agent.id)}</code></td>
        <td>${escapeHtml(agent.category)}</td>
        <td>${escapeHtml(agent.permission)}</td>
        <td><strong>${agent.quality.score}/100</strong><br><span class="muted">${escapeHtml(agent.quality.grade)}</span></td>
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

  const importCommands = importWorkflows
    .map(
      (workflow) => `<div class="command">
        <div class="command-label">${escapeHtml(workflow.label)}</div>
        <pre>${escapeHtml(workflow.command)}</pre>
        <button type="button" data-copy="${escapeHtml(workflow.command)}">Copy</button>
      </div>`
    )
    .join("");
  const registryCommands = registryWorkflows
    .map(
      (workflow) => `<div class="command">
        <div class="command-label">${escapeHtml(workflow.label)}</div>
        <pre>${escapeHtml(workflow.command)}</pre>
        <button type="button" data-copy="${escapeHtml(workflow.command)}">Copy</button>
      </div>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Curated, cross-tool subagent packs for Claude Code, Codex, and OpenCode.">
  <title>${escapeHtml(title)}</title>
  ${metadata?.catalogUrl ? `<link rel="canonical" href="${escapeAttribute(metadata.catalogUrl)}">` : ""}
  <link rel="manifest" href="site.webmanifest">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: light; --ink: #172026; --muted: #5f6b76; --line: #d7dde3; --fill: #f6f8fa; --accent: #0f766e; --good: #166534; --warn: #b45309; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fff; }
    header { padding: 48px 24px 28px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, #f8fbfb 0%, #fff 100%); }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 24px 64px; }
    .hero { max-width: 1120px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-size: 40px; line-height: 1.05; letter-spacing: 0; }
    h2 { margin: 8px 0 10px; font-size: 22px; }
    p { color: var(--muted); line-height: 1.6; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 22px; }
    .stat { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #fff; }
    .stat strong { display: block; font-size: 24px; }
    .stat span { color: var(--muted); font-size: 13px; }
    .toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 24px 0; }
    input, select { min-width: min(100%, 240px); height: 40px; border: 1px solid var(--line); border-radius: 6px; padding: 0 12px; font: inherit; background: #fff; }
    a.button { display: inline-flex; align-items: center; height: 40px; border-radius: 6px; background: var(--ink); color: white; text-decoration: none; padding: 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid var(--line); border-radius: 8px; padding: 18px; background: #fff; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 13px; margin: 12px 0; }
    .meta span { border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; background: var(--fill); }
    .rating { display: flex; align-items: baseline; gap: 8px; margin: 10px 0; color: var(--good); }
    .rating strong { font-size: 24px; }
    .targets { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; }
    .targets span { border: 1px solid #b8d8d4; border-radius: 6px; padding: 3px 7px; color: var(--accent); background: #eef8f6; font-size: 12px; font-weight: 700; }
    .commands { display: grid; gap: 10px; margin: 14px 0; }
    .command { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
    .command-label { grid-column: 1 / -1; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    pre { overflow-x: auto; margin: 0; padding: 12px; border-radius: 6px; background: var(--fill); border: 1px solid var(--line); font-size: 13px; }
    button { height: 40px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); padding: 0 12px; font: inherit; cursor: pointer; }
    button.copied { border-color: var(--accent); color: var(--accent); }
    button.copy-failed { border-color: var(--warn); color: var(--warn); }
    ul { padding-left: 20px; }
    li { margin: 8px 0; color: var(--muted); }
    .warnings { border-left: 3px solid var(--warn); padding-left: 16px; }
    .changelog { display: grid; gap: 12px; }
    .changelog-entry { border-left: 3px solid var(--accent); padding: 4px 0 4px 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 12px 8px; }
    th { color: var(--muted); font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .section { margin-top: 36px; }
    .muted { color: var(--muted); font-size: 12px; }
    @media (max-width: 640px) { h1 { font-size: 32px; } header { padding-top: 32px; } }
  </style>
</head>
<body>
  <header>
    <div class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p>Curated, cross-tool subagent packs for Claude Code, Codex, and OpenCode. Preview, lock, install, update, and uninstall with one CLI.</p>
      <p class="muted">Copyable commands use <code>npx ${escapeHtml(packageSpec)}</code>.</p>
      ${renderMetadata(metadata)}
      <div class="stats">
        <div class="stat"><strong>${registry.packs.length}</strong><span>packs</span></div>
        <div class="stat"><strong>${registry.agents.length}</strong><span>agents</span></div>
        <div class="stat"><strong>${promptQuality.averageScore}/100</strong><span>average prompt quality</span></div>
        <div class="stat"><strong>${provenance.withChecksum}/${registry.agents.length}</strong><span>source checksums</span></div>
      </div>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search packs and agents" aria-label="Search packs and agents">
        <select id="target" aria-label="Filter by target">
          <option value="all">All targets</option>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
        </select>
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
      <h2>Registry Trust Workflow</h2>
      <p>Inspect and lock the hosted registry before installing packs in team projects or CI-managed repositories.</p>
      <div class="commands">${registryCommands}</div>
    </section>
    <section class="section">
      <h2>Import Workflows</h2>
      <p>Bring existing community agents into a reviewable registry, then lint, audit, and publish them through the same catalog pipeline.</p>
      <div class="commands">${importCommands}</div>
    </section>
    <section class="section">
      <h2>Agents</h2>
      <table>
        <thead><tr><th>ID</th><th>Category</th><th>Permission</th><th>Quality</th><th>Source</th><th>Description</th></tr></thead>
        <tbody>${agents}</tbody>
      </table>
    </section>
  </main>
  <script>
    const input = document.querySelector("#search");
    const target = document.querySelector("#target");
    const searchable = [...document.querySelectorAll("[data-search]")];
    function applyFilters() {
      const query = input.value.trim().toLowerCase();
      const selectedTarget = target.value;
      for (const item of searchable) {
        const textMatches = !query || item.dataset.search.toLowerCase().includes(query);
        const itemTargets = item.dataset.targets || "";
        const targetMatches = selectedTarget === "all" || itemTargets.split(" ").includes(selectedTarget);
        item.style.display = textMatches && targetMatches ? "" : "none";
      }
    }
    input.addEventListener("input", applyFilters);
    target.addEventListener("change", applyFilters);
    async function copyCommand(command) {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(command);
          return true;
        } catch {
          // Fall through to the textarea fallback for non-secure contexts or denied clipboard permissions.
        }
      }
      const textarea = document.createElement("textarea");
      textarea.value = command;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        document.body.removeChild(textarea);
      }
      return copied;
    }
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-copy]");
      if (!button) return;
      const copied = await copyCommand(button.dataset.copy);
      button.textContent = copied ? "Copied" : "Copy failed";
      button.classList.toggle("copied", copied);
      button.classList.toggle("copy-failed", !copied);
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("copied");
        button.classList.remove("copy-failed");
      }, 1400);
    });
  </script>
</body>
</html>
`;
}

function webManifest(title: string, baseUrl?: string) {
  return {
    name: title,
    short_name: "Agents Market",
    description: "Curated subagent packs for Claude Code, Codex, and OpenCode.",
    start_url: baseUrl ? baseUrl.replace(/\/+$/, "") : ".",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f766e",
    icons: [
      {
        src: "favicon.svg",
        sizes: "any",
        type: "image/svg+xml"
      }
    ]
  };
}

function renderFavicon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0f766e"/>
  <path d="M18 20h28v6H18zM18 30h20v6H18zM18 40h28v6H18z" fill="#fff"/>
  <path d="M43 29l5 4-5 4v-8z" fill="#a7f3d0"/>
</svg>
`;
}

function catalogMetadata(options: CatalogOptions, packageSpec: string): RegistryMetadata | undefined {
  const catalogUrl = options.baseUrl ? options.baseUrl.replace(/\/+$/, "") : undefined;
  const metadata: RegistryMetadata = {
    homepage: options.homepage ?? catalogUrl,
    repository: options.repository,
    catalogUrl,
    releaseUrl: options.releaseUrl,
    packageSpec,
    commit: options.commit
  };
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined && value !== "");
  return entries.length > 0 ? (Object.fromEntries(entries) as RegistryMetadata) : undefined;
}

function renderMetadata(metadata: RegistryMetadata | undefined): string {
  if (!metadata) return "";
  const links = [
    metadata.homepage ? `<a href="${escapeAttribute(metadata.homepage)}">homepage</a>` : "",
    metadata.repository ? `<a href="${escapeAttribute(metadata.repository)}">source</a>` : "",
    metadata.catalogUrl ? `<a href="${escapeAttribute(metadata.catalogUrl)}">catalog</a>` : "",
    metadata.releaseUrl ? `<a href="${escapeAttribute(metadata.releaseUrl)}">release</a>` : "",
    metadata.commit ? `<span>commit <code>${escapeHtml(metadata.commit.slice(0, 12))}</code></span>` : ""
  ].filter(Boolean);
  if (links.length === 0) return "";
  return `<p class="muted provenance-links">${links.join(" | ")}</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function renderProvenance(
  provenance:
    | { source?: string; repository?: string; license?: string; author?: string; sourceCommit?: string; sourceSha256?: string }
    | undefined
): string {
  if (!provenance) return "Bundled";
  const label = provenance.repository ?? provenance.author ?? provenance.license ?? provenance.source ?? "Imported";
  const commit = provenance.sourceCommit ? ` <span title="source commit">commit:${escapeHtml(provenance.sourceCommit.slice(0, 12))}</span>` : "";
  const checksum = provenance.sourceSha256 ? ` <span title="source SHA-256">sha256:${escapeHtml(provenance.sourceSha256.slice(0, 12))}</span>` : "";
  if (provenance.source?.startsWith("http://") || provenance.source?.startsWith("https://")) {
    return `<a href="${escapeHtml(provenance.source)}">${escapeHtml(label)}</a>${commit}${checksum}`;
  }
  return `${escapeHtml(label)}${commit}${checksum}`;
}

function packCatalogSummary(registry: Registry, packId: string, bundlePath: string, packageSpec: string) {
  const pack = registry.packs.find((candidate) => candidate.id === packId);
  if (!pack) throw new Error(`Unknown pack: ${packId}`);
  const agents = pack.agents.map((id) => registry.agents.find((agent) => agent.id === id)).filter((agent) => agent !== undefined);
  const quality = summarizeQuality(agents);
  const audit = auditPack(registry, pack.id, "all");
  const npx = `npx ${packageSpec}`;
  const previewCommand = `${npx} apply ${pack.id} --target all --registry ${bundlePath} --policy-preset balanced --json`;
  const auditCommand = `${npx} audit ${pack.id} --target all --registry ${bundlePath} --json`;
  const diffCommand = `${npx} diff ${pack.id} --target all --registry ${bundlePath} --json`;
  const installCommand = `${npx} apply ${pack.id} --target all --registry ${bundlePath} --policy-preset balanced --yes`;
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
    quality,
    rating: qualityRating(quality.averageScore),
    targetCoverage: targetCoverage(agents),
    provenance: summarizeProvenance(agents),
    agents
  };
}

function agentCatalogSummary(agent: AgentDefinition) {
  const quality = scorePromptQuality(agent);
  return {
    ...agent,
    quality: {
      score: quality.score,
      maxScore: quality.maxScore,
      grade: quality.grade,
      suggestions: quality.suggestions
    },
    rating: qualityRating(quality.score)
  };
}

function summarizeQuality(agents: AgentDefinition[]) {
  const scores = agents.map((agent) => scorePromptQuality(agent));
  const total = scores.reduce((sum, score) => sum + score.score, 0);
  const averageScore = scores.length === 0 ? 100 : Math.round(total / scores.length);
  const minScore = scores.length === 0 ? 100 : Math.min(...scores.map((score) => score.score));
  return {
    averageScore,
    minScore,
    maxScore: 100,
    grade: qualityGrade(averageScore)
  };
}

function qualityRating(score: number) {
  const value = Math.round((score / 20) * 10) / 10;
  return {
    score: value,
    max: 5,
    label: score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 60 ? "Needs work" : "Poor"
  };
}

function qualityGrade(score: number): "excellent" | "good" | "needs-work" | "poor" {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "needs-work";
  return "poor";
}

function targetCoverage(agents: AgentDefinition[]): Target[] {
  const order: Target[] = ["claude", "codex", "opencode"];
  const targets = new Set<Target>();
  for (const agent of agents) for (const target of agent.recommendedTargets) targets.add(target);
  return order.filter((target) => targets.has(target));
}

function summarizeProvenance(agents: AgentDefinition[]) {
  const licenses = new Set<string>();
  for (const agent of agents) if (agent.provenance?.license) licenses.add(agent.provenance.license);
  return {
    agentCount: agents.length,
    withProvenance: agents.filter((agent) => agent.provenance !== undefined).length,
    withChecksum: agents.filter((agent) => agent.provenance?.sourceSha256 !== undefined).length,
    licenses: [...licenses].sort()
  };
}

function registryWorkflowCommands(packageSpec: string, bundlePath: string, publicKeyPath?: string, keyId?: string) {
  const npx = `npx ${packageSpec}`;
  const commands = [
    {
      label: "Inspect Hosted Registry",
      command: `${npx} registry info --registry ${bundlePath} --json`
    }
  ];
  if (publicKeyPath && keyId) {
    commands.push({
      label: "Verify Hosted Registry Signature",
      command: `${npx} registry verify --registry ${bundlePath} --public-key ${publicKeyPath} --key-id ${keyId}`
    });
  }
  commands.push(
    {
      label: "Lock Registry In Project",
      command: `${npx} registry lock --registry ${bundlePath}${publicKeyPath && keyId ? ` --public-key ${publicKeyPath} --key-id ${keyId}` : ""}`
    },
    {
      label: "Verify Project Lock",
      command: `${npx} registry verify-lock --json`
    }
  );
  return commands;
}

function publicKeyUrlForBundle(bundlePath: string): string {
  return bundlePath.endsWith("registry.bundle.json")
    ? `${bundlePath.slice(0, -"registry.bundle.json".length)}registry-public.pem`
    : "registry-public.pem";
}

function importWorkflowCommands(packageSpec = "github:tt-a1i/agents-market") {
  const npx = `npx ${packageSpec}`;
  return [
    {
      label: "Import Markdown Agent",
      command: `${npx} import markdown ./agent.md --target claude --out ./registry/agents`
    },
    {
      label: "Import Directory Pack",
      command: `${npx} import directory ./community-agents --target claude --out ./registry/agents --pack community-pack --pack-out ./registry/packs`
    },
    {
      label: "Import GitHub Repository",
      command: `${npx} import repo owner/community-agents --target claude --path agents --out ./registry/agents --pack community-pack --pack-out ./registry/packs`
    },
    {
      label: "Review Imported Registry",
      command: `${npx} registry lint --registry ./registry --strict --json`
    }
  ];
}
