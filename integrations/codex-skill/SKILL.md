---
name: agents-market-installer
description: Use when a user asks Codex to recommend, install, update, or inspect specialized coding subagents for Claude Code, Codex, OpenCode, or multiple targets in the current repository.
---

# Agents Market Installer

Use the local `agents-market` CLI to recommend and install specialized coding subagent packs.

## Workflow

1. Inspect the repository briefly so you understand the project type.
2. If the user provides a registry URL or bundle path, run `agents-market registry lock --registry <source>`.
3. Run `agents-market apply --target all --json` to preview the recommended pack, audit, policy result, and file diff.
4. If the user names a pack, run `agents-market apply <pack-id> --target all --json` instead.
5. If the user wants a small custom set, run `agents-market search <query> --json`, create a pack with `agents-market pack create <pack-id> --agent <ids...> --out ./registry/packs`, then preview it with `agents-market apply <pack-id> --target all --json`.
6. Explain target files, permission implications, policy findings, warnings, and source/license status.
7. After user confirmation, run `agents-market apply <pack-id> --target all --yes`.
8. Verify install state with `agents-market status --json` and `agents-market doctor --strict --json`.
9. Summarize installed files, health warnings, and how the user can invoke the new agents.

## Target Selection

- Use `--target claude` for Claude Code only.
- Use `--target codex` for Codex only.
- Use `--target opencode` for OpenCode only.
- Use `--target all` when the user wants cross-tool support or does not know which tool they will use.

## Safety

Prefer `apply` because it combines recommendation, audit, policy, diff, and guarded install. Use lower-level commands such as `recommend`, `audit`, `policy check`, `diff`, and `install` only when the user needs custom control or troubleshooting.

Treat policy failures as blockers unless the user explicitly updates project policy. Do not install a very large number of agents unless the user explicitly asks for broad coverage. Prefer curated packs.

Do not use `--force` with `update` or `uninstall` unless the user explicitly confirms that modified generated files should be overwritten or removed.
