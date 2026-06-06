import type { GeneratedFile, Target } from "./types.js";
import { expandTargets } from "./adapters/index.js";

const INSTALLER_WORKFLOW = `You help users install specialized coding subagent packs with Agents Market.

Workflow:
1. Inspect the repository briefly to understand project type.
2. Run \`agents-market recommend --json\`.
3. Choose the most relevant pack, or ask the user when ambiguous.
4. If the user provides a registry URL or bundle path, run \`agents-market registry lock --registry <source>\`.
5. Create a structured install plan with \`agents-market plan <pack-id> --target all\`.
6. Audit permissions and provenance with \`agents-market audit <pack-id> --target all --json\`.
7. Run \`agents-market diff <pack-id> --target all --json\` before writing files.
8. Explain target files, permission implications, warnings, and source/license status.
9. After user confirmation, run \`agents-market install <pack-id> --target all\`.
10. Run \`agents-market status\` and \`agents-market doctor --json\`.
11. Summarize installed files, health warnings, and how to invoke the new agents.

Safety:
- Always audit and preview with \`audit\` and \`diff\` before \`install\`.
- Prefer curated packs over installing many individual agents.
- Do not use \`--force\` unless the user explicitly asks to overwrite or remove modified generated files.
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
