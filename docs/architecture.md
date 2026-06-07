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

   `src/index.ts` is the execution layer. It can run locally in a repo, print diffs, install packs, export generated files, show install status, update existing installs, roll back the last update snapshot, and uninstall generated files.

5. Agent-native integrations

   Integrations should call the CLI or core library instead of rewriting generation logic. Their job is to provide a natural interaction inside Claude Code, Codex, OpenCode, and future coding agents.

   Current generated integration files:

   - `.claude/skills/agents-market-installer/SKILL.md`
   - `.codex/skills/agents-market-installer/SKILL.md`
   - `.opencode/commands/agents-market.md`

## Current Command Contract

```bash
agents-market list
agents-market recommend
agents-market apply --target all
agents-market apply <pack> --target all --yes
agents-market diff <pack> --target all
agents-market plan <pack> --target all --json
agents-market install <pack> --target all
agents-market status
agents-market update
agents-market rollback <pack> --target all
agents-market uninstall <pack> --target all
agents-market export <pack> --target all --out ./generated
agents-market registry info --registry ./registry.bundle.json
agents-market registry changelog --registry ./registry.bundle.json
agents-market registry export --out ./registry.bundle.json
agents-market registry lock --registry ./registry.bundle.json
agents-market registry lint --strict --json
agents-market integrations diff --target all
agents-market integrations install --target all
agents-market integrations package --target all --out ./integration-packages
agents-market ci init --provider github --yes
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

- `init` previews or writes the project registry lock and agent-native integration files, detects the project, recommends a pack, and emits next commands. Dry-run output starts with the confirming `init ...` command and only suggests `registry verify-lock` after a lock is written.
- `apply` combines project-aware recommendation, audit, policy checking, diff preview, and confirmed install for agent-native workflows.
- `plan` creates a project-aware confirmation payload for a selected pack, including registry source, pack metadata, file changes, audit risk, compatibility, optional policy results, readiness, and next commands.
- `apply`, `install`, and `update` check pack compatibility requirements such as `requires.agentsMarket` before writing files.
- `status` compares current files with stored hashes. With `--diff`, it reloads expected generated content from the registry and returns line-level drift summaries for modified or missing files.
- `resolve` reconciles manifest drift after review. It can restore registry-generated content, record intentional local edits as the new tracked hash, or forget tracked files while preserving user content.
- `outdated` compares installed pack versions with the current registry source and reports current, outdated, newer, unknown, or missing state. `--fail-on-outdated` makes stale or missing packs a CI blocker.
- `update` regenerates installed packs, skips user-modified files unless `--force` is set, and stores a bounded rollback snapshot before writing changed generated files. `--fail-on-skipped` makes skipped or incompatible update previews a CI blocker.
- `rollback` restores the previous update snapshot. It previews by default, requires `--yes` to write, and skips user-modified generated files unless `--force` is set.
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

`agents-market registry export --private-key <pem> --key-id <id>` signs an exported bundle with Ed25519. The signature covers the bundle checksum, and the checksum covers the registry payload. `agents-market registry verify --public-key <path-or-url> --key-id <id>` validates the checksum and signature before a hosted bundle is locked or installed from.

`agents-market registry lock` writes `.agents-market/registry-lock.json`. When the user does not pass `--registry`, project-level commands prefer that lockfile and verify its source/version/checksum when present. Signed locks can also store a public key path or URL plus key id, causing `verify-lock`, `doctor`, and CI to keep verifying the registry bundle signature. For installed-pack maintenance, the CLI then falls back to the registry source recorded in `.agents-market/manifest.json`, and only then to the bundled registry.

`agents-market registry verify-lock` gives humans, CI, and agent-native wrappers an explicit lock verification command.

This is the foundation for a hosted marketplace: the Web catalog can publish versioned registry bundles, and agent-native integrations can lock a project before installation.

## Static Catalog

`agents-market catalog build` generates a static discovery site from any registry source. `--package` controls the package spec used in copyable `npx` commands, which lets preview catalogs use a tag- or SHA-pinned GitHub package spec such as `github:tt-a1i/agents-market#preview-0.1.0` before npm publication and production catalogs use `@agents-market/cli` after npm publication. `agents-market catalog info --url` reads the hosted `agents-market.json` entrypoint from a base URL, `catalog.json`, or `agents-market.json` URL so coding agents can discover trust, integration install, CI setup, import, and pack-selection commands before installing anything. `agents-market catalog init --url` turns that discovery payload into a guarded onboarding flow: it previews or writes the registry lock, installs agent-native integrations, optionally writes the generated GitHub maintenance workflow, verifies signed hosted registries before writing a signature-aware lock, and emits project signals, recommended or `--pack`-selected pack details, audit, install plan, file diff, and next `apply` commands. Dry-run next commands show the confirming `catalog init ... --yes` command and include the hosted registry URL for preview/install until `--yes` writes a lock; written connections then switch to `registry verify-lock` and lock-backed `apply` commands. `agents-market catalog verify --url` can verify the deployed static catalog directly from its hosted URL, including the signed hosted registry bundle when `registry-public.pem` is published. Catalog and registry bundle metadata can also record homepage, repository, catalog URL, release URL, package spec, and source commit, giving users and agent-native workflows a verifiable source trail.

Outputs:

- `index.html`: marketing landing page generated from the registry (real agent/pack counts, featured tiers, install methods, trust chain) linking to the browse catalog
- `catalog.html`: searchable catalog for humans with target filters, quality ratings, provenance summaries, social preview metadata, copyable workflow commands, and import workflow commands
- `catalog.json`: machine-readable catalog with pack audits, prompt quality scores, ratings, provenance coverage, `apply` preview/install commands, safety workflow commands, registry trust workflow commands, compatibility requirements, changelog entries, import workflow commands, release/source metadata, and agent metadata
- `agents-market.json`: compact agent-readable marketplace manifest with registry bundle/public-key URLs, trust commands, agent-native integration install commands, CI setup commands, import commands, and pack summaries
- `registry.bundle.json`: installable registry bundle
- `site.webmanifest`, `robots.txt`, `sitemap.xml`, and `favicon.svg`: static site metadata and discovery files for production hosting

The catalog has no runtime framework dependency. It can be served from GitHub Pages, a CDN, an object bucket, or any static file host. Pack cards include copyable commands for `apply --json` preview, lower-level audit/diff inspection, and confirmed `apply --yes` installation from the generated bundle. The registry trust workflow gives teams copyable commands for `registry info`, `registry lock`, and `registry verify-lock` before installation. `agents-market.json` gives coding agents a compact entrypoint for the same trust workflow plus integration install, CI setup, import, and pack-selection commands without scraping HTML. The import workflow section gives maintainers copyable commands for normalizing Markdown, local directories, and GitHub repositories into a reviewable registry. `agents-market catalog verify` checks that `catalog.json`, `agents-market.json`, `registry.bundle.json`, `index.html`, and static site metadata agree on pack counts, changelog metadata, audits, quality scores, provenance summaries, registry trust workflow commands, agent-readable install/automation commands, import workflow commands, `apply` workflow commands, hosted bundle URLs, copy controls and runtime fallbacks, manifest metadata, favicon/sitemap wiring, social preview metadata, and registry signatures when public keys are present. The included Pages workflow builds and verifies the catalog from the bundled registry on every push to `main` and stamps it with the GitHub repository, preview release URL, package spec, and commit.

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
- template boilerplate detection: paragraphs shared verbatim across five or more agents are excluded from prompt quality scoring and reported in a `prompt-boilerplate` finding
- tier-aware severity: low prompt quality is a warning or error for core-tier agents and an `info` finding for community-tier agents, so imported collections surface honestly without blocking strict CI
- core packs referencing community-tier agents
- imported agents without provenance
- provenance without source license
- GitHub provenance without source commit
- provenance without source checksum
- readonly agents requesting write tools
- unsafe full bash on readonly or safe-write agents
- command agents without command capability
- packs with too many agents
- packs without recommendation signals

CI runs `npm run registry:check` through the release gate. This delegates to `agents-market registry review`, treats warnings as failures for the published registry, verifies all agents support Claude Code, Codex, and OpenCode, audits every pack, previews `apply --json` for every pack under the balanced policy, and verifies a catalog built from `./registry`.

Registry-related pull requests also run the `Registry Review` workflow. It builds the CLI, runs the compatibility wrapper `scripts/registry-submission-check.mjs --summary-json --summary-markdown`, writes a pack-by-pack Markdown review summary to the GitHub Actions job summary, maintains a sticky PR comment, and uploads JSON/Markdown artifacts for maintainers and agent-native reviewers.

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
- source commit
- source license
- source author
- source SHA-256 checksum
- import timestamp

The catalog surfaces provenance, short source commits, and short source checksums. `registry lint` warns when imported agents are missing provenance, source license data, source commits for GitHub imports, or source checksums.

## Integration Packages

`agents-market integrations package` generates distributable installer bundles for Claude Code, Codex, and OpenCode.

- `agents-market-claude/` contains the Claude Code skill under `.claude/skills/agents-market-installer/`.
- `agents-market-codex/` contains a Codex plugin manifest at `.codex-plugin/plugin.json` plus the installer skill under `skills/`.
- `agents-market-opencode/` contains the OpenCode command under `.opencode/commands/`.

These packages reuse the same generated instructions as `integrations install`, but target release artifacts, team templates, or marketplace ingestion instead of writing directly into the current project.

## Project CI

`agents-market ci init --provider github` generates `.github/workflows/agents-market.yml` for installed-pack maintenance. The workflow verifies the registry lock, runs drift status, strict outdated-pack checks, strict update previews, and `doctor --strict --json` on pull requests, pushes to `main`, and manual dispatch. By default it uses `npx @agents-market/cli@<version>` so downstream projects pin the CLI version instead of executing a floating GitHub source. It is intentionally generated into the user's project so teams can review, commit, and customize their own policy for ongoing agent-pack health.

## Release Pipeline

The repository includes five GitHub Actions workflows:

- CI: typecheck, build, registry lint, and tests.
- Registry Review: focused registry submission automation for registry-related pull requests.
- Security: CodeQL analysis, pull request dependency review, and OpenSSF Scorecard.
- Pages: static catalog generation and GitHub Pages deployment.
- Release: npm package verification, artifact attestation, and publish on `v*` tags.

The release workflow uses npm provenance, GitHub Artifact Attestations, and requires `NPM_TOKEN` in repository secrets.
