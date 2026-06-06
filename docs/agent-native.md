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
4. Run `agents-market diff <pack> --target <target>`.
5. Explain files, permissions, and command-running risk.
6. After confirmation, run `agents-market install <pack> --target <target>`.
7. Tell the user how to invoke the installed agents.

## Integration Strategy

The CLI remains the stable execution layer. Agent-native integrations should be thin wrappers:

- Claude Code: custom command, skill, plugin, or MCP wrapper that calls the CLI.
- Codex: skill or plugin that calls the CLI and follows the diff-before-install flow.
- OpenCode: custom agent/command that calls the CLI.

## Safety Rules

- Always run `diff` before `install`.
- Prefer curated packs over installing many individual agents.
- Explain permissions for command-capable agents like `test-runner` and `frontend-verifier`.
- Never overwrite unrelated user files silently.
- Keep installed agent count small unless the user explicitly asks for a broad pack.
