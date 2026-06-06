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

   `src/index.ts` is the execution layer. It can run locally in a repo, print diffs, install packs, export generated files, show install status, update existing installs, and uninstall generated files.

5. Agent-native integrations

   Integrations should call the CLI or core library instead of rewriting generation logic. Their job is to provide a natural interaction inside Claude Code, Codex, OpenCode, and future coding agents.

   Current generated integration files:

   - `.claude/skills/agents-market-installer/SKILL.md`
   - `.agents/skills/agents-market-installer/SKILL.md`
   - `.opencode/commands/agents-market.md`

## Current Command Contract

```bash
agents-market list
agents-market recommend
agents-market diff <pack> --target all
agents-market install <pack> --target all
agents-market status
agents-market update
agents-market uninstall <pack> --target all
agents-market export <pack> --target all --out ./generated
agents-market registry export --out ./registry.bundle.json
agents-market registry lock --registry ./registry.bundle.json
agents-market registry lint --strict
agents-market integrations diff --target all
agents-market integrations install --target all
agents-market catalog build --out ./site
agents-market import markdown ./agent.md --target claude --out ./registry/agents
agents-market import directory ./agents --target claude --out ./registry/agents --pack imported-pack --pack-out ./registry/packs
```

## Manifest Lifecycle

Installing a pack writes `.agents-market/manifest.json`.

The manifest records:

- pack id
- target
- install timestamp
- generated file paths
- target platform per file
- source agent id per file
- sha256 hash of generated content

This gives the installer a lifecycle:

- `status` compares current files with stored hashes.
- `update` regenerates installed packs and skips user-modified files unless `--force` is set.
- `uninstall` removes generated files and skips user-modified files unless `--force` is set.

The manifest is intentionally not ignored. Teams can commit it when they want deterministic pack lifecycle tracking.

## Registry Sources And Lockfiles

The CLI supports multiple registry sources:

- bundled registry included in the package
- local registry directory
- portable registry bundle file
- HTTP(S) registry bundle URL

`agents-market registry export` creates a single JSON bundle with:

- schema version
- registry name
- registry version
- export timestamp
- agents
- packs
- sha256 checksum

`agents-market registry lock` writes `.agents-market/registry-lock.json`. When the user does not pass `--registry`, project-level commands read that lockfile first and fall back to the bundled registry only when no lockfile exists.

This is the foundation for a hosted marketplace: the Web catalog can publish versioned registry bundles, and agent-native integrations can lock a project before installation.

## Static Catalog

`agents-market catalog build` generates a static discovery site from any registry source.

Outputs:

- `index.html`: searchable catalog for humans
- `catalog.json`: compact machine-readable summary
- `registry.bundle.json`: installable registry bundle

The catalog has no runtime framework dependency. It can be served from GitHub Pages, a CDN, an object bucket, or any static file host. The included Pages workflow builds the catalog from the bundled registry on every push to `main`.

## Registry Quality Gate

`agents-market registry lint` checks registry content before publication.

Current checks include:

- duplicate agent and pack IDs
- missing pack agent references
- weak routing metadata
- short descriptions
- missing prompt role framing
- readonly agents requesting write tools
- unsafe full bash on readonly or safe-write agents
- command agents without command capability
- packs with too many agents
- packs without recommendation signals

CI runs `node dist/index.js registry lint --strict`, which treats warnings as failures for the bundled registry.

## Import Pipeline

`agents-market import markdown` normalizes third-party Claude Code and OpenCode Markdown agent templates into `registry/agents/*.json`.

The importer is intentionally conservative:

- It parses simple YAML frontmatter.
- It preserves the Markdown body as the agent prompt.
- It infers category, tags, permissions, and tools.
- It can write normalized JSON or print to stdout.

Imported agents should always go through `registry lint` before being included in a published pack.

`agents-market import directory` applies the same normalization to a folder of Markdown templates and can write a provisional pack. This is the first step toward ingesting large GitHub template collections, but it deliberately keeps human review in the loop.

## Future Production Requirements

- Pack version constraints and update checks.
- Registry signature verification.
- Manifest conflict resolution and richer drift reports.
- Prompt quality scoring beyond static heuristics.
- Signature or checksum verification for third-party packs.
- Batch import from GitHub template repositories with provenance metadata.
- Packaged plugin distribution for Claude Code, Codex, and OpenCode.
- Richer Web catalog with ratings, provenance, and import flows.

## Release Pipeline

The repository includes three GitHub Actions workflows:

- CI: typecheck, build, registry lint, and tests.
- Pages: static catalog generation and GitHub Pages deployment.
- Release: npm package verification and publish on `v*` tags.

The release workflow uses npm provenance and requires `NPM_TOKEN` in repository secrets.
