# Architecture

Agents Market is built around one invariant: the registry is tool-neutral, and adapters own target-specific syntax.

## Layers

1. Registry

   `registry/agents/*.json`, `registry/packs/*.json`, and `registry/changelog.json` are the source of truth. They describe agent intent, permissions, prompts, tags, target support, pack composition, and user-visible registry changes without committing to one coding agent's file format.

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
agents-market apply --target all
agents-market apply <pack> --target all --yes
agents-market diff <pack> --target all
agents-market install <pack> --target all
agents-market status
agents-market update
agents-market uninstall <pack> --target all
agents-market export <pack> --target all --out ./generated
agents-market registry info --registry ./registry.bundle.json
agents-market registry changelog --registry ./registry.bundle.json
agents-market registry export --out ./registry.bundle.json
agents-market registry lock --registry ./registry.bundle.json
agents-market registry lint --strict --json
agents-market integrations diff --target all
agents-market integrations install --target all
agents-market catalog build --out ./site
agents-market catalog verify --dir ./site
agents-market import markdown ./agent.md --target claude --out ./registry/agents
agents-market import directory ./agents --target claude --out ./registry/agents --pack imported-pack --pack-out ./registry/packs
```

## Manifest Lifecycle

Installing a pack writes `.agents-market/manifest.json`.

The manifest records:

- pack id
- installed pack version
- target
- install timestamp
- generated file paths
- target platform per file
- source agent id per file
- sha256 hash of generated content

This gives the installer a lifecycle:

- `apply` combines project-aware recommendation, audit, policy checking, diff preview, and confirmed install for agent-native workflows.
- `apply`, `install`, and `update` check pack compatibility requirements such as `requires.agentsMarket` before writing files.
- `status` compares current files with stored hashes. With `--diff`, it reloads expected generated content from the registry and returns line-level drift summaries for modified or missing files.
- `resolve` reconciles manifest drift after review. It can restore registry-generated content, record intentional local edits as the new tracked hash, or forget tracked files while preserving user content.
- `outdated` compares installed pack versions with the current registry source and reports current, outdated, newer, unknown, or missing state.
- `update` regenerates installed packs and skips user-modified files unless `--force` is set.
- `uninstall` removes generated files and skips user-modified files unless `--force` is set. Skipped files remain in the manifest so later `status`, `doctor`, or forced uninstall can still find them.

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
- changelog entries
- sha256 checksum
- optional Ed25519 signatures

`agents-market registry info` reports source type, version, checksum, pack count, agent count, target support, changelog status, and pack inventory for bundled, local, file, or hosted registry sources. `agents-market registry changelog` exposes release history for humans and agent-native wrappers.

`agents-market registry export --private-key <pem> --key-id <id>` signs an exported bundle with Ed25519. The signature covers the bundle checksum, and the checksum covers the registry payload. `agents-market registry verify --public-key <pem> --key-id <id>` validates the checksum and signature before a hosted bundle is locked or installed from.

`agents-market registry lock` writes `.agents-market/registry-lock.json`. When the user does not pass `--registry`, project-level commands prefer that lockfile and verify its source/version/checksum when present. For installed-pack maintenance, the CLI then falls back to the registry source recorded in `.agents-market/manifest.json`, and only then to the bundled registry.

`agents-market registry verify-lock` gives humans, CI, and agent-native wrappers an explicit lock verification command.

This is the foundation for a hosted marketplace: the Web catalog can publish versioned registry bundles, and agent-native integrations can lock a project before installation.

## Static Catalog

`agents-market catalog build` generates a static discovery site from any registry source.

Outputs:

- `index.html`: searchable catalog for humans
- `catalog.json`: machine-readable catalog with pack audits, `apply` preview/install commands, safety workflow commands, compatibility requirements, changelog entries, and agent metadata
- `registry.bundle.json`: installable registry bundle

The catalog has no runtime framework dependency. It can be served from GitHub Pages, a CDN, an object bucket, or any static file host. Pack cards include copyable commands for `apply --json` preview, lower-level audit/diff inspection, and confirmed `apply --yes` installation from the generated bundle. `agents-market catalog verify` checks that `catalog.json`, `registry.bundle.json`, and `index.html` agree on pack counts, changelog metadata, audits, `apply` workflow commands, and hosted bundle URLs. The included Pages workflow builds and verifies the catalog from the bundled registry on every push to `main`.

## Custom Packs

`agents-market pack create` lets users and agent-native wrappers compose a small pack from individual search results. This keeps installation lifecycle operations pack-based while still allowing precise selection of specialized agents.

## Registry Quality Gate

`agents-market registry lint` checks registry content before publication.

Current checks include:

- duplicate agent and pack IDs
- missing pack agent references
- weak routing metadata
- short descriptions
- missing prompt role framing
- prompt quality scores for role framing, task specificity, context gathering, safety/scope constraints, expected output, domain specificity, and verification posture
- imported agents without provenance
- provenance without source license
- readonly agents requesting write tools
- unsafe full bash on readonly or safe-write agents
- command agents without command capability
- packs with too many agents
- packs without recommendation signals

CI runs `npm run registry:check` through the release gate. This treats warnings as failures for the published registry, verifies all agents support Claude Code, Codex, and OpenCode, audits every pack, previews `apply --json` for every pack under the balanced policy, and verifies a catalog built from `./registry`.

Deterministic prompt quality scoring gives reviewers a comparable baseline before publication. Static scoring is still not sufficient on its own: new or imported registry content also follows the review process in [contributing-agents.md](./contributing-agents.md): provenance, source license data, permission review, pack scope review, `audit --json`, and `apply --json` preview evidence are required before merge.

Security-sensitive findings, including policy bypasses, unsafe generated files, registry checksum issues, or dangerous third-party content, follow [../SECURITY.md](../SECURITY.md) and should not be filed as public issues.

## Import Pipeline

`agents-market import markdown` normalizes third-party Claude Code and OpenCode Markdown agent templates into `registry/agents/*.json`.

The importer is intentionally conservative:

- It parses simple YAML frontmatter.
- It preserves the Markdown body as the agent prompt.
- It infers category, tags, permissions, and tools.
- It can write normalized JSON or print to stdout.

Imported agents should always go through `registry lint` before being included in a published pack.

`agents-market import directory` applies the same normalization to a folder of Markdown templates and can write a provisional pack. This is the first step toward ingesting large GitHub template collections, but it deliberately keeps human review in the loop.

Imported agents can include provenance:

- source URL
- source repository
- source license
- source author
- import timestamp

The catalog surfaces provenance, and `registry lint` warns when imported agents are missing provenance or source license data.

## Future Production Requirements

- Signature or checksum verification for third-party packs.
- Review automation for third-party registry submissions.
- Packaged plugin distribution for Claude Code, Codex, and OpenCode.
- Richer Web catalog with ratings, provenance, and import flows.

## Release Pipeline

The repository includes three GitHub Actions workflows:

- CI: typecheck, build, registry lint, and tests.
- Pages: static catalog generation and GitHub Pages deployment.
- Release: npm package verification and publish on `v*` tags.

The release workflow uses npm provenance and requires `NPM_TOKEN` in repository secrets.
