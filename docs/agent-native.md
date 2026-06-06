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
2. Run `agents-market recommend`.
3. Pick the best pack or ask the user to choose when ambiguous.
4. If the user or organization has a registry URL, run `agents-market registry lock --registry <source>`.
5. Run `agents-market diff <pack> --target <target>`.
6. Explain files, permissions, and command-running risk.
7. After confirmation, run `agents-market install <pack> --target <target>`.
8. Run `agents-market status` and summarize the installed files.
9. Tell the user how to invoke the installed agents.

For agent-native integrations, prefer structured output where available:

```bash
agents-market recommend --json
agents-market search <query> --json
agents-market plan <pack> --target <target>
agents-market diff <pack> --target <target> --json
```

Use the JSON output for parsing, and translate it into concise human-facing summaries before asking for confirmation.

Use `recommend --json` when the user asks for a project-aware suggestion. Use `search --json` when the user names a domain such as accessibility, security, testing, docs, performance, frontend, or debugging.

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
```

Generated files:

- Claude Code: `.claude/skills/agents-market-installer/SKILL.md`
- Codex: `.agents/skills/agents-market-installer/SKILL.md`
- OpenCode: `.opencode/commands/agents-market.md`

After installation, users can ask the active coding agent to recommend and install subagent packs. The installed integration tells the agent to run `recommend`, `diff`, `install`, and `status` in that order.

## Safety Rules

- Always run `diff` before `install`.
- Run `status` after install/update.
- Use `registry lock` for organization or hosted marketplace registries before installing.
- Prefer curated packs over installing many individual agents.
- Explain permissions for command-capable agents like `test-runner` and `frontend-verifier`.
- Never overwrite unrelated user files silently.
- Do not use `--force` unless the user explicitly asks to overwrite or remove modified generated files.
- Keep installed agent count small unless the user explicitly asks for a broad pack.
