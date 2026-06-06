import type { GeneratedFile, Target } from "./types.js";
import { expandTargets } from "./adapters/index.js";

const INSTALLER_WORKFLOW = `You help users install specialized coding subagent packs with Agents Market.

Workflow:
1. Inspect the repository briefly to understand project type.
2. If the user provides a registry URL or bundle path, run \`agents-market registry info --registry <source> --json\`, summarize the source/version/checksum, then run \`agents-market registry lock --registry <source>\` after confirmation.
3. Run \`agents-market apply --target all --json\` to get the recommended pack, audit, policy check, and file diff in one preview.
4. If the user names a pack, run \`agents-market apply <pack-id> --target all --json\` instead.
5. If the user wants a small custom set, run \`agents-market search <query> --json\` and compose a pack with \`agents-market pack create <pack-id> --agent <ids...> --out ./registry/packs\`, then preview it with \`agents-market apply <pack-id> --target all --json\`.
6. Explain target files, permission implications, policy findings, warnings, and source/license status.
7. Treat policy failures as blockers unless the user explicitly updates project policy.
8. After user confirmation, run \`agents-market apply <pack-id> --target all --yes\`.
9. Run \`agents-market status --json\`, \`agents-market outdated --json\`, and \`agents-market doctor --strict --json\`.
10. If generated files are modified or missing, run \`agents-market status --diff --json\`, explain the drift, then preview \`agents-market resolve --strategy <accept-registry|keep-local|forget> --json\` before asking for confirmation.
11. Summarize installed files, pack version state, health warnings, and how to invoke the new agents.

Safety:
- Prefer \`apply\` because it combines recommendation, audit, policy, diff, and guarded install.
- Use \`recommend\`, \`audit\`, \`policy check\`, \`diff\`, and \`install\` directly only when the user needs a lower-level workflow.
- Treat policy failures as blockers unless the user explicitly updates the project policy.
- Treat compatibility failures as blockers and ask the user to upgrade \`@agents-market/cli\`.
- Prefer curated packs over installing many individual agents.
- Do not use \`--force\` unless the user explicitly asks to overwrite or remove modified generated files.
- Use \`outdated --json\` before update workflows, then \`update --dry-run --json\` before asking for confirmation.
- Use \`agents-market status --diff --json\` when generated files are modified or missing and the user needs a concise drift summary.
- Use \`agents-market resolve --strategy accept-registry|keep-local|forget --json\` to preview manifest drift resolution; add \`--yes\` only after user confirmation.
- Use \`--target claude\`, \`--target codex\`, or \`--target opencode\` when the user wants one tool only.
`;

export function generateIntegration(target: Target): GeneratedFile {
  if (target === "claude") return generateClaudeSkill();
  if (target === "codex") return generateCodexSkill();
  return generateOpenCodeCommand();
}

export function generateIntegrations(target: Target | "all"): GeneratedFile[] {
  return expandTargets(target).map((currentTarget) => generateIntegration(currentTarget));
}

function generateClaudeSkill(): GeneratedFile {
  return {
    path: ".claude/skills/agents-market-installer/SKILL.md",
    content: `---
name: agents-market-installer
description: Use when a user asks Claude Code to recommend, install, update, or inspect specialized coding subagents for Claude Code, Codex, OpenCode, or multiple targets in the current repository.
---

# Agents Market Installer

${INSTALLER_WORKFLOW}
`
  };
}

function generateCodexSkill(): GeneratedFile {
  return {
    path: ".agents/skills/agents-market-installer/SKILL.md",
    content: `---
name: agents-market-installer
description: Use when a user asks Codex to recommend, install, update, or inspect specialized coding subagents for Claude Code, Codex, OpenCode, or multiple targets in the current repository.
---

# Agents Market Installer

${INSTALLER_WORKFLOW}
`
  };
}

function generateOpenCodeCommand(): GeneratedFile {
  return {
    path: ".opencode/commands/agents-market.md",
    content: `---
description: Recommend and install specialized coding subagent packs with Agents Market
agent: build
---

${INSTALLER_WORKFLOW}
`
  };
}
