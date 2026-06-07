import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPack } from "./audit.js";
import { buildCatalog, verifyCatalog } from "./catalog.js";
import { createPolicyPreset } from "./policy.js";
import { lintRegistry, type LintReport } from "./registry-lint.js";
import { summarizeRegistry, type LoadedRegistry } from "./registry.js";
import { runApplyWorkflow } from "./workflow.js";
import type { PackAudit } from "./audit.js";

export interface RegistryReviewOptions {
  loaded: LoadedRegistry;
  catalogBaseUrl?: string;
  packageSpec?: string;
}

export interface RegistryReviewReport {
  ok: boolean;
  registrySource: string;
  checks: string[];
  failure?: string;
  lint?: {
    ok: boolean;
    score: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    promptQuality?: {
      averageScore: number;
      minScore: number;
      maxScore: number;
    };
  };
  inventory?: {
    packCount: number;
    agentCount: number;
    changelogCount: number;
    targets: Record<"claude" | "codex" | "opencode", number>;
    packs: Array<{
      id: string;
      name: string;
      version: string;
      agentCount: number;
      requires?: { agentsMarket?: string };
    }>;
  };
  packs: Array<{
    id: string;
    version: string;
    risk: PackAudit["risk"];
    agentCount: number;
    fileCount: number;
    auditWarnings: number;
    provenance: PackAudit["provenance"];
    policyOk: boolean;
    previewChanges: number;
  }>;
  catalog?: {
    ok: boolean;
    errorCount: number;
    warningCount: number;
  };
}

export async function reviewRegistry(options: RegistryReviewOptions): Promise<RegistryReviewReport> {
  const report: RegistryReviewReport = {
    ok: false,
    registrySource: options.loaded.source.value,
    checks: [],
    packs: []
  };

  try {
    const lint = lintRegistry(options.loaded.registry);
    report.checks.push("Registry strict lint");
    report.lint = lintSummary(lint, true);
    assert(lint.errorCount === 0 && lint.warningCount === 0, "Registry strict lint failed.");
    assert(lint.score === 100, `Expected registry score 100, found ${lint.score}.`);

    const inventory = summarizeRegistry(options.loaded);
    report.checks.push("Registry inventory");
    report.inventory = {
      packCount: inventory.packCount,
      agentCount: inventory.agentCount,
      changelogCount: inventory.changelog.count,
      targets: inventory.targets,
      packs: inventory.packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        agentCount: pack.agentCount,
        requires: pack.requires
      }))
    };
    assert(inventory.packCount > 0, "Registry must contain at least one pack.");
    assert(inventory.agentCount > 0, "Registry must contain at least one agent.");
    assert(inventory.changelog.count > 0, "Registry must contain at least one changelog entry.");
    assert(inventory.targets.claude === inventory.agentCount, "All published agents must support Claude Code.");
    assert(inventory.targets.codex === inventory.agentCount, "All published agents must support Codex.");
    assert(inventory.targets.opencode === inventory.agentCount, "All published agents must support OpenCode.");

    const previewRoot = await mkdtemp(join(tmpdir(), "agents-market-registry-review-"));
    const siteDir = await mkdtemp(join(tmpdir(), "agents-market-registry-review-site-"));
    try {
      for (const pack of inventory.packs) {
        const audit = auditPack(options.loaded.registry, pack.id, "all");
        report.checks.push(`Audit ${pack.id}`);
        assert(audit.agentCount === pack.agentCount, `Audit agent count mismatch for ${pack.id}.`);
        assert(audit.fileCount >= pack.agentCount * 3, `Expected ${pack.id} to generate files for all targets.`);

        const preview = await runApplyWorkflow({
          root: previewRoot,
          registry: options.loaded.registry,
          registrySource: options.loaded.source,
          packId: pack.id,
          target: "all",
          mode: "preview",
          policy: createPolicyPreset("balanced"),
          policySource: "preset",
          policyCommandArg: " --policy-preset balanced"
        });
        report.checks.push(`Apply preview ${pack.id}`);
        assert(preview.installed === false, `Apply preview should not install ${pack.id}.`);
        assert(preview.policy?.ok === true, `Balanced policy should pass for ${pack.id}.`);
        assert(preview.changes.length === audit.fileCount, `Apply preview file count mismatch for ${pack.id}.`);
        report.packs.push({
          id: pack.id,
          version: pack.version,
          risk: audit.risk,
          agentCount: audit.agentCount,
          fileCount: audit.fileCount,
          auditWarnings: audit.warnings.length,
          provenance: audit.provenance,
          policyOk: preview.policy?.ok === true,
          previewChanges: preview.changes.length
        });
      }

      await buildCatalog(options.loaded.registry, {
        outDir: siteDir,
        version: options.loaded.source.version ?? "0.1.0",
        baseUrl: options.catalogBaseUrl ?? "https://example.com/agents-market",
        packageSpec: options.packageSpec
      });
      report.checks.push("Registry catalog build");
      const catalog = await verifyCatalog(siteDir);
      report.checks.push("Registry catalog verify");
      report.catalog = {
        ok: catalog.ok,
        errorCount: catalog.errorCount,
        warningCount: catalog.warningCount
      };
      assert(catalog.ok === true, "Registry catalog verification failed.");
    } finally {
      await rm(previewRoot, { recursive: true, force: true });
      await rm(siteDir, { recursive: true, force: true });
    }

    report.ok = true;
    return report;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    return report;
  }
}

export function renderRegistryReviewMarkdown(report: RegistryReviewReport): string {
  const lint = report.lint;
  const inventory = report.inventory;
  const catalog = report.catalog;
  const status = report.ok ? "pass" : "fail";
  const lines = [
    "<!-- agents-market-registry-review -->",
    "## Registry Review",
    "",
    `- Status: ${status}`,
    `- Registry: \`${report.registrySource}\``,
    `- Checks completed: ${report.checks.length}`,
    `- Lint score: ${formatScore(lint?.score)}${lint ? ` (${lint.errorCount} errors, ${lint.warningCount} warnings, ${lint.infoCount} info)` : ""}`,
    `- Prompt quality: ${formatPromptQuality(lint?.promptQuality)}`,
    `- Inventory: ${formatInventory(inventory)}`,
    `- Catalog verify: ${catalog ? (catalog.ok ? "pass" : "fail") : "not run"}`
  ];

  if (report.failure) {
    lines.push("", `**Failure:** ${report.failure}`);
  }

  if (report.packs.length > 0) {
    lines.push(
      "",
      "| Pack | Version | Risk | Agents | Files | Imported | Checksummed | Committed | Policy | Preview changes |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
      ...report.packs.map(
        (pack) =>
          `| \`${pack.id}\` | ${pack.version} | ${pack.risk} | ${pack.agentCount} | ${pack.fileCount} | ${pack.provenance.imported} | ${pack.provenance.withChecksum} | ${pack.provenance.withCommit} | ${pack.policyOk ? "pass" : "fail"} | ${pack.previewChanges} |`
      )
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function lintSummary(lint: LintReport, strict: boolean): NonNullable<RegistryReviewReport["lint"]> {
  return {
    ok: lint.errorCount === 0 && (!strict || lint.warningCount === 0),
    score: lint.score,
    errorCount: lint.errorCount,
    warningCount: lint.warningCount,
    infoCount: lint.infoCount,
    promptQuality: lint.promptQuality
      ? {
          averageScore: lint.promptQuality.averageScore,
          minScore: lint.promptQuality.minScore,
          maxScore: lint.promptQuality.maxScore
        }
      : undefined
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function formatScore(score: number | undefined): string {
  return typeof score === "number" ? `${score}/100` : "not run";
}

function formatPromptQuality(promptQuality: NonNullable<RegistryReviewReport["lint"]>["promptQuality"] | undefined): string {
  if (!promptQuality) return "not run";
  return `avg ${promptQuality.averageScore}/100, min ${promptQuality.minScore}/100`;
}

function formatInventory(inventory: RegistryReviewReport["inventory"] | undefined): string {
  if (!inventory) return "not run";
  return `${inventory.packCount} packs, ${inventory.agentCount} agents`;
}
