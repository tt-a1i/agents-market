---
name: agents-market-installer
description: Use when a user asks Codex to recommend, install, update, or inspect specialized coding subagents for Claude Code, Codex, OpenCode, or multiple targets in the current repository.
---

# Agents Market Installer

Use the local `agents-market` CLI to recommend and install specialized coding subagent packs.

## Workflow

1. Inspect the repository briefly so you understand the project type.
2. Run:

   ```bash
   agents-market recommend --json
   ```

3. Pick the most relevant pack, or ask the user to choose if the recommendation is ambiguous.
4. If the user provides a registry URL or bundle path, lock it first:

   ```bash
   agents-market registry lock --registry <source>
   ```

5. Create a structured install plan:

   ```bash
   agents-market plan <pack-id> --target all
   ```

6. Audit permissions and provenance:

   ```bash
   agents-market audit <pack-id> --target all --json
   ```

7. Preview changes before writing:

   ```bash
   agents-market diff <pack-id> --target all --json
   ```

8. Explain the target files, permission implications, warnings, and source/license status.
9. After user confirmation, install:

   ```bash
   agents-market install <pack-id> --target all
   ```

10. Verify install state:

   ```bash
   agents-market status
   ```

11. Summarize installed files and how the user can invoke the new agents.

## Target Selection

- Use `--target claude` for Claude Code only.
- Use `--target codex` for Codex only.
- Use `--target opencode` for OpenCode only.
- Use `--target all` when the user wants cross-tool support or does not know which tool they will use.

## Safety

Always run `audit` and `diff` before `install`. Do not install a very large number of agents unless the user explicitly asks for broad coverage. Prefer curated packs.

Do not use `--force` with `update` or `uninstall` unless the user explicitly confirms that modified generated files should be overwritten or removed.
