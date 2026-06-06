# Architecture

Agents Market is built around one invariant: the registry is tool-neutral, and adapters own target-specific syntax.

## Layers

1. Registry

   `registry/agents/*.json` and `registry/packs/*.json` are the source of truth. They describe agent intent, permissions, prompts, tags, and target support without committing to one coding agent's file format.

2. Core library

   `src/registry.ts`, `src/project.ts`, `src/recommend.ts`, and `src/install.ts` provide reusable logic for CLI, web, and agent-native integrations.

3. Target adapters

   `src/adapters/*` converts standard agent definitions into:

   - Claude Code Markdown under `.claude/agents/`
   - Codex TOML under `.codex/agents/`
   - OpenCode Markdown under `.opencode/agents/`

4. CLI

   `src/index.ts` is the execution layer. It can run locally in a repo, print diffs, install packs, or export generated files.

5. Agent-native integrations

   Integrations should call the CLI or core library instead of rewriting generation logic. Their job is to provide a natural interaction inside Claude Code, Codex, OpenCode, and future coding agents.

## Current Command Contract

```bash
agents-market list
agents-market recommend
agents-market diff <pack> --target all
agents-market install <pack> --target all
agents-market export <pack> --target all --out ./generated
```

## Future Production Requirements

- Remote registry download and lockfile support.
- Pack version constraints and update checks.
- Install manifests for uninstall and drift detection.
- Registry linting and prompt quality scoring.
- Signature or checksum verification for third-party packs.
- Agent-native integrations for Claude Code, Codex, and OpenCode.
- Web catalog backed by the same registry metadata.
