import type { GeneratedFile, Target } from "./types.js";
import { expandTargets } from "./adapters/index.js";
import { CLI_VERSION } from "./constants.js";

const INSTALLER_WORKFLOW = `You help users install specialized coding subagent packs with Agents Market.

Workflow:
1. Inspect the repository briefly to understand project type.
2. If the user provides a registry URL or bundle path, run \`agents-market registry info --registry <source> --json\`, summarize the source/version/checksum, verify the signature when a public key is available, then run \`agents-market registry lock --registry <source> --public-key <path-or-url> --key-id <id>\` after confirmation. If no public key is available, lock without signature metadata and explain the weaker trust posture.
3. If a registry lock exists, run \`agents-market registry verify-lock --json\` before previewing or installing packs. Treat lock verification failures as blockers until the user confirms a new trusted registry source.
4. Run \`agents-market apply --target all --json\` to get the recommended pack, audit, policy check, and file diff in one preview.
5. If the user names a pack, run \`agents-market apply <pack-id> --target all --json\` instead.
6. If the user wants a small custom set, run \`agents-market search <query> --json\` and compose a pack with \`agents-market pack create <pack-id> --agent <ids...> --out ./registry/packs\`, then preview it with \`agents-market apply <pack-id> --target all --json\`.
7. Explain target files, permission implications, policy findings, warnings, and source/license status.
8. Treat policy failures as blockers unless the user explicitly updates project policy.
9. After user confirmation, run \`agents-market apply <pack-id> --target all --yes\`.
10. Run \`agents-market registry verify-lock --json\` when a lock exists, then run \`agents-market status --json\`, \`agents-market outdated --json\`, and \`agents-market doctor --strict --json\`.
11. If generated files are modified or missing, run \`agents-market status --diff --json\`, explain the drift, then preview \`agents-market resolve --strategy <accept-registry|keep-local|forget> --json\` before asking for confirmation.
12. For rollback requests after an update, run \`agents-market rollback <pack-id> --target all --json\` first, then ask for confirmation before adding \`--yes\`.
13. Summarize installed files, pack version state, health warnings, and how to invoke the new agents.

Safety:
- Prefer \`apply\` because it combines recommendation, audit, policy, diff, and guarded install.
- Use \`recommend\`, \`audit\`, \`policy check\`, \`diff\`, and \`install\` directly only when the user needs a lower-level workflow.
- Treat policy failures as blockers unless the user explicitly updates the project policy.
- Treat compatibility failures as blockers and ask the user to upgrade \`@agents-market/cli\`.
- Treat registry lock verification failures as blockers until the user confirms a new trusted registry source.
- Prefer curated packs over installing many individual agents.
- Do not use \`--force\` unless the user explicitly asks to overwrite or remove modified generated files.
- Use \`outdated --json\` before update workflows, then \`update --dry-run --json\` before asking for confirmation.
- Use \`rollback --json\` before rollback workflows, then add \`--yes\` only after user confirmation.
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

export function generateIntegrationPackages(target: Target | "all"): GeneratedFile[] {
  return expandTargets(target).flatMap((currentTarget) => {
    if (currentTarget === "claude") return generateClaudePackage();
    if (currentTarget === "codex") return generateCodexPackage();
    return generateOpenCodePackage();
  });
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
    path: ".codex/skills/agents-market-installer/SKILL.md",
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

function generateClaudePackage(): GeneratedFile[] {
  const skill = generateClaudeSkill();
  return [
    {
      path: "agents-market-claude/README.md",
      content: packageReadme("Claude Code", ".claude/skills/agents-market-installer/SKILL.md")
    },
    {
      path: `agents-market-claude/${skill.path}`,
      content: skill.content
    }
  ];
}

function generateCodexPackage(): GeneratedFile[] {
  const skill = generateCodexSkill();
  const manifest = {
    name: "agents-market-installer",
    version: CLI_VERSION,
    description: "Agents Market installer plugin for Codex",
    author: {
      name: "Agents Market contributors"
    },
    skills: "./skills/",
    interface: {
      displayName: "Agents Market Installer",
      shortDescription: "Recommend and install specialized coding subagents.",
      longDescription: "Use the Agents Market CLI from Codex to preview, install, update, and audit subagent packs for Claude Code, Codex, and OpenCode.",
      developerName: "Agents Market contributors",
      category: "Productivity",
      capabilities: [],
      defaultPrompt: "Recommend specialized coding subagents for this repository."
    }
  };

  return [
    {
      path: "agents-market-codex/README.md",
      content: packageReadme("Codex", "skills/agents-market-installer/SKILL.md")
    },
    {
      path: "agents-market-codex/.codex-plugin/plugin.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`
    },
    {
      path: "agents-market-codex/skills/agents-market-installer/SKILL.md",
      content: skill.content
    }
  ];
}

function generateOpenCodePackage(): GeneratedFile[] {
  const command = generateOpenCodeCommand();
  return [
    {
      path: "agents-market-opencode/README.md",
      content: packageReadme("OpenCode", ".opencode/commands/agents-market.md")
    },
    {
      path: `agents-market-opencode/${command.path}`,
      content: command.content
    }
  ];
}

function packageReadme(toolName: string, entrypoint: string): string {
  return `# Agents Market Installer for ${toolName}

This package contains the agent-native installer integration for ${toolName}.

## Contents

- \`${entrypoint}\`

## Usage

Copy this package's contents into a project or user-level ${toolName} configuration location, then ask the coding agent to recommend or install Agents Market subagent packs. The integration previews with \`agents-market apply --json\`, asks for confirmation, installs with \`agents-market apply --yes\`, verifies any existing registry lock with \`agents-market registry verify-lock --json\`, and finishes with \`agents-market status --json\` and \`agents-market doctor --strict --json\`.

The local \`agents-market\` CLI must be available on PATH, or invoked through \`npx @agents-market/cli\` by the parent agent.
`;
}
