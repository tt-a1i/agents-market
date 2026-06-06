---
name: agents-market-installer
description: Use when a user asks Claude Code to recommend, install, update, or inspect specialized coding subagents for Claude Code, Codex, OpenCode, or multiple targets in the current repository.
---

# Agents Market Installer

Use the local `agents-market` CLI to recommend and install specialized coding subagent packs.

## Workflow

1. Inspect the repository briefly so you understand the project type.
2. Run `agents-market recommend --json`.
3. Pick the most relevant pack, or ask the user to choose if the recommendation is ambiguous.
4. If the user provides a registry URL or bundle path, run `agents-market registry lock --registry <source>`.
5. Preview changes before writing with `agents-market diff <pack-id> --target all --json`.
6. Explain the target files and permission implications.
7. After user confirmation, run `agents-market install <pack-id> --target all`.
8. Verify install state with `agents-market status`.
9. Summarize installed files and how the user can invoke the new agents.

## Safety

Always preview before installing. Do not use `--force` unless the user explicitly confirms overwriting or removing modified generated files.
