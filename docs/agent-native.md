# Agent-Native Product Shape

The final user experience should happen inside the coding agent:

```text
User: 给这个 repo 配一套适合前端项目的 subagents

Agent:
I detected Next.js, TypeScript, Tailwind, and Playwright.
Recommended pack: nextjs-pack.
It will create Claude Code, Codex, and OpenCode agent files.
Shall I install it?
```

## Agent-Native Flow

1. Inspect the project.
2. If the user or organization has a registry URL, run `agents-market registry info --registry <source> --json`, summarize the source/version/checksum, verify the signature when a public key is available, then run `agents-market registry lock --registry <source> --public-key <path-or-url> --key-id <id>` after confirmation. If no public key is available, run `agents-market registry lock --registry <source>` and explain that the lock only enforces source/version/checksum.
3. Run `agents-market apply --target <target> --json` to preview the recommended pack, audit, policy result, and file diff.
4. If the user names a pack, run `agents-market apply <pack> --target <target> --json` instead.
5. Explain files, permissions, policy findings, and command-running risk.
6. After confirmation, run `agents-market apply <pack> --target <target> --yes`.
7. Run `agents-market status --json` and `agents-market doctor --strict --json`.
8. Tell the user how to invoke the installed agents.

For agent-native integrations, prefer structured output where available:

```bash
agents-market recommend --json
agents-market registry info --registry <source> --json
agents-market apply --target <target> --json
agents-market apply <pack> --target <target> --yes
agents-market search <query> --json
agents-market init --target <target> --json
agents-market ci init --provider github --json
agents-market plan <pack> --target <target> --json
agents-market audit <pack> --target <target> --json
agents-market policy check <pack> --target <target> --json
agents-market diff <pack> --target <target> --json
agents-market outdated --json
agents-market outdated --fail-on-outdated --json
agents-market update --dry-run --json
agents-market update --dry-run --fail-on-skipped --json
agents-market rollback <pack> --target <target> --json
agents-market rollback <pack> --target <target> --yes
agents-market uninstall <pack> --target <target> --dry-run --json
agents-market status --json
agents-market status --diff --json
agents-market resolve <pack> --target <target> --strategy keep-local --json
agents-market resolve <pack> --target <target> --strategy accept-registry --yes
agents-market doctor --json
agents-market doctor --strict --json
```

Use the JSON output for parsing, and translate it into concise human-facing summaries before asking for confirmation.

Use `recommend --json` when the user asks for a project-aware suggestion. Use `search --json` when the user names a domain such as accessibility, security, testing, docs, performance, frontend, or debugging.
Use `apply --json` as the default preview path because it combines recommendation, audit, policy, and diff into one agent-friendly response.
Use `plan --json` when the user has already selected a pack and wants a confirmation summary before installation. Treat `ready: false` as a blocker and explain the compatibility or policy findings before offering next steps.
Treat `apply --json` compatibility failures as blockers; ask the user to upgrade `@agents-market/cli` before installing incompatible packs.
Use `apply --yes` after explicit user confirmation to install the selected pack.
Use `pack create` when the user wants a small custom set from individual search results instead of a full curated pack.
Use `init --json` when the project does not yet have Agents Market integrations installed.
Use `ci init --json` when the user wants repository automation for ongoing drift, outdated-pack, update-preview, registry-lock, and policy checks. Run it without `--yes` first, then write the workflow only after confirmation.
Use `audit --json` before install confirmation so the user can see permissions, tool access, target support, provenance, and source license gaps.
Use `policy check --json` after `audit` when `.agents-market/policy.json` exists, and treat failures as blockers unless the user intentionally updates policy.
Use `install --enforce-policy` when policy exists so the final write step repeats the gate before creating files.
Use `status --json` and `doctor --json` after installation or updates to verify generated-file drift, manifest health, registry lock status, policy compliance, and target directories.
Use `status --diff --json` when generated files are modified or missing and the user needs a concise summary of what drifted.
Use `resolve --json` after reviewing drift when the user wants to restore registry-generated content, record intentional local edits, or forget selected tracked files. Add `--yes` only after confirmation.
Use `outdated --json` before update workflows to tell the user which installed packs are current, outdated, newer than the registry, unknown, or missing from the registry.
Use `outdated --fail-on-outdated --json` in CI when stale installed packs should block a pull request.
Use `doctor --strict --json` when an automation should fail on warnings or errors.
Use `update --dry-run --json` before updating installed packs, then ask for confirmation before running `update`.
Use `update --dry-run --fail-on-skipped --json` in CI when skipped modified files or incompatible packs should block a pull request.
Use `rollback --json` before reverting a pack update. Add `--yes` only after confirmation; use `--force` only when the user explicitly wants to overwrite modified generated files.
Use `uninstall --dry-run --json` before uninstalling packs, then ask for confirmation before running `uninstall`.

## Integration Strategy

The CLI remains the stable execution layer. Agent-native integrations should be thin wrappers:

- Claude Code: custom command, skill, plugin, or MCP wrapper that calls the CLI.
- Codex: skill or plugin that calls the CLI and follows the diff-before-install flow.
- OpenCode: custom agent/command that calls the CLI.

## Install Integrations

Use the CLI to install agent-native entrypoints into the current project:

```bash
agents-market integrations diff --target all
agents-market integrations install --target all
agents-market integrations package --target all --out ./integration-packages
```

Generated files:

- Claude Code: `.claude/skills/agents-market-installer/SKILL.md`
- Codex: `.codex/skills/agents-market-installer/SKILL.md`
- OpenCode: `.opencode/commands/agents-market.md`

After installation, users can ask the active coding agent to recommend and install subagent packs. The installed integration tells the agent to run `apply --json`, ask for confirmation, run `apply --yes`, then verify with `status` and `doctor`.

Use `integrations package` when you need distributable bundles instead of writing into the current repository. It produces Claude Code, Codex plugin, and OpenCode command packages from the same installer workflow.

## Safety Rules

- Prefer `apply` for the standard path because it runs recommendation, audit, policy, and diff before install.
- Always preview before installing.
- Run `policy check` when the project has `.agents-market/policy.json`.
- Run `status` after install/update.
- Run `status --diff` and preview `resolve` before reconciling modified or missing generated files.
- Preview `rollback --json` before reverting an update; require confirmation before `rollback --yes`.
- Use `registry lock` for organization or hosted marketplace registries before installing.
- Prefer curated packs over installing many individual agents.
- Explain permissions for command-capable agents like `test-runner` and `frontend-verifier`.
- Never overwrite unrelated user files silently.
- Do not use `--force` unless the user explicitly asks to overwrite or remove modified generated files.
- Keep installed agent count small unless the user explicitly asks for a broad pack.
