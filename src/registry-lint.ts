import type { AgentDefinition, PackDefinition, Registry } from "./types.js";
import { CLI_VERSION } from "./constants.js";
import { scoreRegistryPrompts, type PromptQualityReport } from "./prompt-quality.js";
import { satisfiesVersionRange } from "./version.js";

export type LintSeverity = "error" | "warning";

export interface LintFinding {
  severity: LintSeverity;
  code: string;
  subject: string;
  message: string;
}

export interface LintReport {
  findings: LintFinding[];
  errorCount: number;
  warningCount: number;
  score: number;
  promptQuality: PromptQualityReport;
}

export function lintRegistry(registry: Registry): LintReport {
  const findings: LintFinding[] = [];
  const promptQuality = scoreRegistryPrompts(registry.agents);
  lintDuplicateIds("agent", registry.agents, findings);
  lintDuplicateIds("pack", registry.packs, findings);
  lintAgents(registry.agents, findings);
  lintPromptQuality(promptQuality, findings);
  lintPacks(registry, findings);

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 4);
  return { findings, errorCount, warningCount, score, promptQuality };
}

function lintDuplicateIds(
  kind: "agent" | "pack",
  values: Array<AgentDefinition | PackDefinition>,
  findings: LintFinding[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      findings.push({
        severity: "error",
        code: "duplicate-id",
        subject: `${kind}:${value.id}`,
        message: `Duplicate ${kind} id "${value.id}".`
      });
    }
    seen.add(value.id);
  }
}

function lintAgents(agents: AgentDefinition[], findings: LintFinding[]): void {
  for (const agent of agents) {
    if (!agent.description.toLowerCase().includes(agent.category.toLowerCase()) && agent.tags.length === 0) {
      findings.push({
        severity: "warning",
        code: "weak-routing-metadata",
        subject: `agent:${agent.id}`,
        message: "Agent should have category-aligned description or useful tags for routing and catalog search."
      });
    }

    if (agent.description.length < 60) {
      findings.push({
        severity: "warning",
        code: "short-description",
        subject: `agent:${agent.id}`,
        message: "Description is short; routing improves when it states the task and trigger clearly."
      });
    }

    if (!agent.prompt.includes("You are")) {
      findings.push({
        severity: "warning",
        code: "prompt-role-missing",
        subject: `agent:${agent.id}`,
        message: "Prompt should start with a clear role such as \"You are ...\"."
      });
    }

    if (agent.permission === "readonly" && (agent.tools?.edit || agent.tools?.write)) {
      findings.push({
        severity: "error",
        code: "readonly-write-tools",
        subject: `agent:${agent.id}`,
        message: "Readonly agents must not enable edit or write tools."
      });
    }

    if ((agent.permission === "readonly" || agent.permission === "safe-write") && agent.tools?.bash === "full") {
      findings.push({
        severity: "error",
        code: "unsafe-bash-permission",
        subject: `agent:${agent.id}`,
        message: "Readonly and safe-write agents must not request full bash access."
      });
    }

    if (agent.permission === "command" && agent.tools?.bash === "none") {
      findings.push({
        severity: "warning",
        code: "command-agent-without-bash",
        subject: `agent:${agent.id}`,
        message: "Command agents usually need safe bash access to run verification."
      });
    }

    if (!agent.recommendedTargets.includes("claude") || !agent.recommendedTargets.includes("codex") || !agent.recommendedTargets.includes("opencode")) {
      findings.push({
        severity: "warning",
        code: "partial-target-support",
        subject: `agent:${agent.id}`,
        message: "Agent does not declare support for all first-class targets."
      });
    }

    if (agent.tags.includes("imported") && !agent.provenance) {
      findings.push({
        severity: "warning",
        code: "missing-provenance",
        subject: `agent:${agent.id}`,
        message: "Imported agents should include provenance with source, repository, license, or author."
      });
    }

    if (agent.provenance && !agent.provenance.license) {
      findings.push({
        severity: "warning",
        code: "missing-source-license",
        subject: `agent:${agent.id}`,
        message: "Agent provenance does not include a source license."
      });
    }
  }
}

function lintPromptQuality(promptQuality: PromptQualityReport, findings: LintFinding[]): void {
  for (const score of promptQuality.agents) {
    if (score.score >= 70) continue;
    findings.push({
      severity: score.score < 50 ? "error" : "warning",
      code: "prompt-quality-low",
      subject: `agent:${score.agentId}`,
      message: `Prompt quality score is ${score.score}/${score.maxScore}; missing: ${score.suggestions.join("; ")}`
    });
  }
}

function lintPacks(registry: Registry, findings: LintFinding[]): void {
  const agentIds = new Set(registry.agents.map((agent) => agent.id));
  for (const pack of registry.packs) {
    const missing = pack.agents.filter((id) => !agentIds.has(id));
    for (const id of missing) {
      findings.push({
        severity: "error",
        code: "missing-agent-reference",
        subject: `pack:${pack.id}`,
        message: `Pack references missing agent "${id}".`
      });
    }

    if (pack.agents.length > 8) {
      findings.push({
        severity: "warning",
        code: "large-pack",
        subject: `pack:${pack.id}`,
        message: "Large packs can make routing noisy; prefer smaller curated packs unless broad coverage is intentional."
      });
    }

    if (
      (pack.recommendedFor.frameworks?.length ?? 0) === 0 &&
      (pack.recommendedFor.languages?.length ?? 0) === 0 &&
      (pack.recommendedFor.files?.length ?? 0) === 0
    ) {
      findings.push({
        severity: "warning",
        code: "no-recommendation-signals",
        subject: `pack:${pack.id}`,
        message: "Pack has no recommendation signals, so automatic recommendation will be weak."
      });
    }

    if (!pack.requires?.agentsMarket) {
      findings.push({
        severity: "warning",
        code: "missing-agents-market-version-constraint",
        subject: `pack:${pack.id}`,
        message: "Pack should declare requires.agentsMarket so older CLIs can reject incompatible packs before writing files."
      });
    } else if (satisfiesVersionRange(CLI_VERSION, pack.requires.agentsMarket) === undefined) {
      findings.push({
        severity: "error",
        code: "invalid-agents-market-version-constraint",
        subject: `pack:${pack.id}`,
        message: `Pack declares an invalid requires.agentsMarket range: ${pack.requires.agentsMarket}.`
      });
    }
  }
}
