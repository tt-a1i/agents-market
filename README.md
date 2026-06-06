# Agents Market

Agents Market is an agent-native marketplace and installer for specialized coding subagents.

It solves a simple product problem: specialized subagents are useful, but most developers will not discover, write, validate, adapt, and maintain agent files for every coding tool they use. Agents Market keeps a curated registry of agent packs and installs them into a project in each tool's native format.

## Targets

Agents Market currently generates:

| Tool | Output |
| --- | --- |
| Claude Code | `.claude/agents/*.md` |
| Codex | `.codex/agents/*.toml` |
| OpenCode | `.opencode/agents/*.md` |

## Quick Start

```bash
npm install
npm run build
npm run dev -- list --agents
npm run dev -- recommend
npm run dev -- install starter-dev-pack --target all --dry-run
npm run dev -- status
```

After publishing, the intended user flow is:

```bash
npx agents-market recommend
npx agents-market install frontend-pack --target all
```

## Product Shape

The final product has three layers:

- Registry: source-of-truth agent and pack definitions.
- CLI: reliable local execution for recommend, install, diff, export, update, and uninstall.
- Agent-native adapters: Claude Code, Codex, OpenCode, and future coding agents can call the installer from inside the coding session.

## Commands

```bash
agents-market list
agents-market list --agents
agents-market recommend
agents-market diff starter-dev-pack --target all
agents-market install starter-dev-pack --target claude
agents-market status
agents-market update
agents-market uninstall starter-dev-pack --target claude
agents-market export frontend-pack --target all --out ./generated
agents-market registry export --out ./registry.bundle.json
agents-market registry lock --registry ./registry.bundle.json
agents-market registry lint --strict
agents-market integrations diff --target all
agents-market integrations install --target all
agents-market catalog build --out ./site
```

## Install Manifest

Installs write `.agents-market/manifest.json`. The manifest records installed packs, targets, generated files, and content hashes.

This enables drift-aware operations:

- `status` reports clean, modified, and missing generated files.
- `update` refreshes installed packs from the current registry.
- `uninstall` removes generated files while skipping user-modified files by default.

Use `--force` with `update` or `uninstall` only when you intentionally want to overwrite or remove modified generated files.

## Registry Sources

Commands that read packs support a registry source:

```bash
agents-market list --registry bundled
agents-market diff starter-dev-pack --registry ./registry.bundle.json
agents-market install starter-dev-pack --registry https://example.com/registry.bundle.json
```

Supported sources:

- `bundled`: the registry shipped with the CLI.
- Directory: a local registry directory with `agents/` and `packs/`.
- Bundle file: a portable JSON bundle created by `agents-market registry export`.
- URL: an HTTP(S) registry bundle.

Lock a project to a registry source:

```bash
agents-market registry lock --registry ./registry.bundle.json
```

This writes `.agents-market/registry-lock.json`. Project commands use the lockfile automatically when `--registry` is omitted.

Lint a registry before publishing:

```bash
agents-market registry lint --strict
```

The linter checks references, duplicate IDs, routing metadata, permission/tool consistency, prompt structure, pack size, and recommendation signals.

## Built-In Packs

- `starter-dev-pack`: review, debugging, tests, and documentation research.
- `frontend-pack`: visual verification, accessibility, review, tests, and debugging.
- `nextjs-pack`: Next.js performance, frontend verification, accessibility, tests, and review.

## Agent-Native Integrations

Install the installer entrypoints into a project:

```bash
agents-market integrations install --target all
```

This writes:

| Tool | Integration file |
| --- | --- |
| Claude Code | `.claude/skills/agents-market-installer/SKILL.md` |
| Codex | `.agents/skills/agents-market-installer/SKILL.md` |
| OpenCode | `.opencode/commands/agents-market.md` |

Once installed, the user can ask their coding agent to recommend and install subagent packs from inside the coding session. The integration workflow previews with `diff`, asks for confirmation, installs with the CLI, and verifies with `status`.

## Web Catalog

Build a static marketplace catalog:

```bash
agents-market catalog build --out ./site
```

The catalog generator writes:

- `index.html`: searchable static catalog
- `catalog.json`: machine-readable catalog summary
- `registry.bundle.json`: portable registry bundle that users can install from

The repository includes GitHub Actions for CI and GitHub Pages catalog deployment.

## Repository Layout

```text
registry/
  agents/     Standard agent source definitions
  packs/      Curated installable packs
integrations/
  claude-skill/       Claude Code installer skill source
  codex-skill/        Codex installer skill source
  opencode-command/   OpenCode installer command source
src/
  adapters/   Claude Code, Codex, and OpenCode generators
  index.ts    CLI entrypoint
.github/
  workflows/  CI and GitHub Pages catalog publishing
tests/        Adapter and registry tests
```

## Design Notes

- The registry is intentionally tool-neutral.
- Target adapters own platform-specific syntax and permissions.
- Packs are curated to avoid overloading users with too many subagents.
- `recommend` scans local project signals and suggests packs rather than making the user browse a long catalog.
- The install manifest protects user edits and gives the CLI a real lifecycle, not just one-way file generation.
- Registry bundles and lockfiles provide the base for a remote marketplace and reproducible team installs.
- Static catalog generation provides a first Web discovery surface without adding a heavy frontend stack.
- Registry linting keeps marketplace content safe enough to publish and useful enough to recommend.

See [claude_code_agents_research.md](./claude_code_agents_research.md) for the underlying Claude Code, Codex, and OpenCode research.
