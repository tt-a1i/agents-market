import { expandTargets } from "./adapters/index.js";
import { getAgentsForPack, getPack } from "./registry.js";
import type { AgentDefinition, PermissionMode, Registry, Target } from "./types.js";

export interface PackAudit {
  packId: string;
  target: Target | "all";
  risk: "low" | "medium" | "high";
  agentCount: number;
  fileCount: number;
  permissions: Record<PermissionMode, number>;
  tools: {
    read: number;
    edit: number;
    write: number;
    bashSafe: number;
    bashFull: number;
    web: number;
  };
  targetSupport: Record<Target, number>;
  provenance: {
    bundled: number;
    imported: number;
    withLicense: number;
    missingLicense: string[];
    repositories: string[];
  };
  agents: Array<{
    id: string;
    name: string;
    permission: PermissionMode;
    targets: Target[];
    tools: AgentDefinition["tools"];
    provenance: AgentDefinition["provenance"];
  }>;
  warnings: string[];
}

const permissionOrder: PermissionMode[] = ["readonly", "safe-write", "write", "command"];

export function auditPack(registry: Registry, packId: string, target: Target | "all"): PackAudit {
  const pack = getPack(registry, packId);
  const agents = getAgentsForPack(registry, pack);
  const targets = expandTargets(target);
  const permissions = Object.fromEntries(permissionOrder.map((permission) => [permission, 0])) as Record<PermissionMode, number>;
  const targetSupport = Object.fromEntries(["claude", "codex", "opencode"].map((item) => [item, 0])) as Record<Target, number>;
  const tools = {
    read: 0,
    edit: 0,
    write: 0,
    bashSafe: 0,
    bashFull: 0,
    web: 0
  };
  const missingLicense: string[] = [];
  const repositories = new Set<string>();
  let imported = 0;

  for (const agent of agents) {
    permissions[agent.permission] += 1;
    for (const recommendedTarget of agent.recommendedTargets) {
      targetSupport[recommendedTarget] += 1;
    }
    if (agent.tools?.read) tools.read += 1;
    if (agent.tools?.edit) tools.edit += 1;
    if (agent.tools?.write) tools.write += 1;
    if (agent.tools?.bash === "safe") tools.bashSafe += 1;
    if (agent.tools?.bash === "full") tools.bashFull += 1;
    if (agent.tools?.web) tools.web += 1;
    if (agent.provenance) {
      imported += 1;
      if (agent.provenance.repository) repositories.add(agent.provenance.repository);
      if (!agent.provenance.license) missingLicense.push(agent.id);
    }
  }

  const warnings: string[] = [];
  const unsupported = agents.filter((agent) => targets.some((currentTarget) => !agent.recommendedTargets.includes(currentTarget)));
  if (unsupported.length > 0) {
    warnings.push(`Some agents do not declare support for requested target ${target}: ${unsupported.map((agent) => agent.id).join(", ")}`);
  }
  if (tools.bashFull > 0) warnings.push(`${tools.bashFull} agents request full bash access.`);
  if (tools.write > 0) warnings.push(`${tools.write} agents can write files.`);
  if (permissions.command > 0) warnings.push(`${permissions.command} agents use command-level permission.`);
  if (missingLicense.length > 0) warnings.push(`Imported agents missing source license: ${missingLicense.join(", ")}`);

  return {
    packId: pack.id,
    target,
    risk: riskLevel(permissions, tools, missingLicense),
    agentCount: agents.length,
    fileCount: agents.length * targets.length,
    permissions,
    tools,
    targetSupport,
    provenance: {
      bundled: agents.length - imported,
      imported,
      withLicense: imported - missingLicense.length,
      missingLicense,
      repositories: [...repositories].sort()
    },
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      permission: agent.permission,
      targets: agent.recommendedTargets,
      tools: agent.tools,
      provenance: agent.provenance
    })),
    warnings
  };
}

function riskLevel(
  permissions: Record<PermissionMode, number>,
  tools: PackAudit["tools"],
  missingLicense: string[]
): PackAudit["risk"] {
  if (permissions.command > 0 || tools.bashFull > 0 || tools.write > 0 || missingLicense.length > 0) return "high";
  if (permissions["safe-write"] > 0 || tools.edit > 0 || tools.bashSafe > 0 || tools.web > 0) return "medium";
  return "low";
}
