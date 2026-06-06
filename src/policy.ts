import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { auditPack } from "./audit.js";
import type { PermissionMode, Registry, Target } from "./types.js";

export type PolicyPreset = "open" | "balanced" | "strict";
export type PolicySeverity = "error" | "warning";

export interface AgentPolicy {
  schemaVersion: 1;
  maxPermission: PermissionMode;
  allowFullBash: boolean;
  allowWeb: boolean;
  allowedTargets: Target[];
  blockedAgents: string[];
  blockedPacks: string[];
}

export interface PolicyFinding {
  severity: PolicySeverity;
  code: string;
  subject: string;
  message: string;
}

export interface PolicyCheckReport {
  ok: boolean;
  packId: string;
  target: Target | "all";
  policy: AgentPolicy;
  errorCount: number;
  warningCount: number;
  findings: PolicyFinding[];
}

const permissionOrder: PermissionMode[] = ["readonly", "safe-write", "write", "command"];

const policySchema = z.object({
  schemaVersion: z.literal(1),
  maxPermission: z.enum(["readonly", "safe-write", "write", "command"]),
  allowFullBash: z.boolean(),
  allowWeb: z.boolean(),
  allowedTargets: z.array(z.enum(["claude", "codex", "opencode"])).min(1),
  blockedAgents: z.array(z.string()).default([]),
  blockedPacks: z.array(z.string()).default([])
});

export function policyPath(root: string): string {
  return join(root, ".agents-market", "policy.json");
}

export function createPolicyPreset(preset: PolicyPreset): AgentPolicy {
  if (preset === "open") {
    return {
      schemaVersion: 1,
      maxPermission: "command",
      allowFullBash: true,
      allowWeb: true,
      allowedTargets: ["claude", "codex", "opencode"],
      blockedAgents: [],
      blockedPacks: []
    };
  }
  if (preset === "strict") {
    return {
      schemaVersion: 1,
      maxPermission: "safe-write",
      allowFullBash: false,
      allowWeb: false,
      allowedTargets: ["claude", "codex", "opencode"],
      blockedAgents: [],
      blockedPacks: []
    };
  }
  return {
    schemaVersion: 1,
    maxPermission: "command",
    allowFullBash: false,
    allowWeb: true,
    allowedTargets: ["claude", "codex", "opencode"],
    blockedAgents: [],
    blockedPacks: []
  };
}

export async function loadPolicy(path: string): Promise<AgentPolicy> {
  return policySchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function savePolicy(path: string, policy: AgentPolicy): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}

export function checkPackPolicy(registry: Registry, packId: string, target: Target | "all", policy: AgentPolicy): PolicyCheckReport {
  const audit = auditPack(registry, packId, target);
  const findings: PolicyFinding[] = [];

  if (policy.blockedPacks.includes(packId)) {
    findings.push({
      severity: "error",
      code: "blocked-pack",
      subject: `pack:${packId}`,
      message: "Pack is blocked by project policy."
    });
  }

  const requestedTargets = target === "all" ? (["claude", "codex", "opencode"] as Target[]) : [target];
  for (const requestedTarget of requestedTargets) {
    if (!policy.allowedTargets.includes(requestedTarget)) {
      findings.push({
        severity: "error",
        code: "target-not-allowed",
        subject: `target:${requestedTarget}`,
        message: `Target "${requestedTarget}" is not allowed by project policy.`
      });
    }
  }

  for (const agent of audit.agents) {
    if (policy.blockedAgents.includes(agent.id)) {
      findings.push({
        severity: "error",
        code: "blocked-agent",
        subject: `agent:${agent.id}`,
        message: "Agent is blocked by project policy."
      });
    }

    if (permissionRank(agent.permission) > permissionRank(policy.maxPermission)) {
      findings.push({
        severity: "error",
        code: "permission-exceeds-policy",
        subject: `agent:${agent.id}`,
        message: `Agent permission "${agent.permission}" exceeds policy maxPermission "${policy.maxPermission}".`
      });
    }

    if (!policy.allowFullBash && agent.tools?.bash === "full") {
      findings.push({
        severity: "error",
        code: "full-bash-not-allowed",
        subject: `agent:${agent.id}`,
        message: "Agent requests full bash access, which is not allowed by project policy."
      });
    }

    if (!policy.allowWeb && agent.tools?.web) {
      findings.push({
        severity: "error",
        code: "web-not-allowed",
        subject: `agent:${agent.id}`,
        message: "Agent requests web access, which is not allowed by project policy."
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  return {
    ok: errorCount === 0,
    packId,
    target,
    policy,
    errorCount,
    warningCount,
    findings
  };
}

function permissionRank(permission: PermissionMode): number {
  return permissionOrder.indexOf(permission);
}
