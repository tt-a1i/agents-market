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

Try the CLI directly from GitHub:

```bash
npx github:tt-a1i/agents-market init --target all
npx github:tt-a1i/agents-market recommend
npx github:tt-a1i/agents-market apply --target all
npx github:tt-a1i/agents-market apply frontend-pack --target all --yes
```

Preview release artifacts are available at [preview-0.1.0](https://github.com/tt-a1i/agents-market/releases/tag/preview-0.1.0), including the registry bundle, npm tarball, checksum manifest, and Claude Code, Codex, and OpenCode installer archives.

Install the preview CLI from the GitHub Release with checksum verification:

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/install.sh | sh
```

For local development:

```bash
npm install
npm run build
npm run dev -- init --target all
npm run dev -- list --agents
npm run dev -- recommend
npm run dev -- install starter-dev-pack --target all --dry-run
npm run dev -- status
```

After npm publication, use the package name:

```bash
npx @agents-market/cli init --target all
npx @agents-market/cli recommend
npx @agents-market/cli apply --target all
npx @agents-market/cli apply frontend-pack --target all --yes
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
agents-market list --agents --json
agents-market init --target all
agents-market init --target all --dry-run --json
agents-market search accessibility --target claude
agents-market search --type agents --category frontend --json
agents-market recommend
agents-market recommend --json
agents-market apply --target all
agents-market apply nextjs-pack --target all --json
agents-market apply nextjs-pack --target all --policy-preset balanced --yes
agents-market plan starter-dev-pack --target all
agents-market plan security-pack --target claude --policy-preset balanced --json
agents-market audit starter-dev-pack --target all
agents-market policy init --preset balanced
agents-market policy check starter-dev-pack --target all
agents-market policy check starter-dev-pack --target all --json
agents-market diff starter-dev-pack --target all
agents-market diff starter-dev-pack --target all --json
agents-market install starter-dev-pack --target claude
agents-market install starter-dev-pack --target all --enforce-policy
agents-market pack create frontend-lite --agent code-reviewer accessibility-auditor --out ./registry/packs
agents-market status
agents-market status --json
agents-market status --diff --json
agents-market resolve starter-dev-pack --target claude --strategy keep-local --yes
agents-market resolve starter-dev-pack --target claude --strategy accept-registry --file .claude/agents/code-reviewer.md --json
agents-market doctor
agents-market doctor --strict --json
agents-market outdated
agents-market outdated --json
agents-market update
agents-market update --dry-run --json
agents-market uninstall starter-dev-pack --target claude
agents-market uninstall starter-dev-pack --target claude --dry-run --json
agents-market export frontend-pack --target all --out ./generated
agents-market registry info
agents-market registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --json
agents-market registry changelog
agents-market registry changelog --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --json
agents-market registry export --out ./registry.bundle.json
agents-market registry export --out ./registry.bundle.json --private-key ./registry-private.pem --key-id main
agents-market registry verify --registry ./registry.bundle.json --public-key ./registry-public.pem --key-id main --json
agents-market registry lock --registry ./registry.bundle.json
agents-market registry verify-lock
agents-market registry lint --strict
agents-market registry lint --strict --json
agents-market integrations diff --target all
agents-market integrations install --target all
agents-market integrations package --target all --out ./integration-packages
agents-market catalog build --out ./site
agents-market catalog build --out ./site --base-url https://example.com/agents-market
agents-market catalog verify --dir ./site
agents-market import markdown ./agent.md --target claude --out ./registry/agents
agents-market import directory ./third-party-agents --target claude --out ./registry/agents --pack imported-pack --pack-out ./registry/packs
agents-market import repo owner/community-agents --target claude --path agents --out ./registry/agents --pack community-pack --pack-out ./registry/packs
```

## Install Manifest

Installs write `.agents-market/manifest.json`. The manifest records installed packs, pack versions, targets, generated files, and content hashes.

This enables drift-aware operations:

- `status` reports clean, modified, and missing generated files; use `status --json` for automation and `status --diff --json` when you need line-level drift summaries for modified or missing generated files.
- `resolve` reconciles manifest drift after review. Use `--strategy accept-registry` to restore generated content from the registry, `--strategy keep-local` to record intentional local edits as the new tracked hash, or `--strategy forget` to stop tracking selected files.
- `doctor` runs manifest, registry lock, policy, drift, and target directory health checks; use `doctor --strict --json` in CI.
- `outdated` compares installed pack versions with the current registry; use `outdated --json` before update automation.
- `update` refreshes installed packs from the current registry.
- `uninstall` removes generated files while skipping and continuing to track user-modified files by default.

Use `status --diff --json`, `resolve --json`, `outdated --json`, `update --dry-run --json`, and `uninstall --dry-run --json` before changing installed packs in automation. Use `--force` with `update` or `uninstall` only when you intentionally want to overwrite or remove modified generated files.

## Initialize A Project

Use `init` as the first-run setup:

```bash
agents-market init --target all
agents-market init --target claude --dry-run --json
```

`init` locks the selected registry, installs the agent-native installer entrypoints, detects the project, recommends a pack, and prints the next `apply --json`, `apply --yes`, and `doctor --strict --json` commands. It does not install the recommended pack automatically; pack installation still requires explicit confirmation with `apply --yes`.

## Registry Sources

Commands that read packs support a registry source:

```bash
agents-market list --registry bundled
agents-market registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json
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

This writes `.agents-market/registry-lock.json`. Project commands use the lockfile automatically when `--registry` is omitted and verify the locked checksum when the lock includes one.

Installed packs also remember the registry source used at install time. If a project has no lockfile, maintenance commands such as `update` and policy-aware `doctor` checks fall back to the install manifest's registry source before using the bundled registry.

Verify a lock explicitly:

```bash
agents-market registry verify-lock
agents-market registry verify-lock --json
```

Inspect a registry before locking or installing:

```bash
agents-market registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json
agents-market registry info --registry ./registry.bundle.json --json
```

`registry info` reports source type, source URL/path, version, checksum, pack count, agent count, target support, changelog status, and pack inventory. Agent-native workflows can use the JSON output to summarize a hosted registry before asking the user to lock or install from it.

View registry release history:

```bash
agents-market registry changelog
agents-market registry changelog --registry ./registry.bundle.json --json
```

Sign and verify a portable bundle:

```bash
agents-market registry export --out ./registry.bundle.json --private-key ./registry-private.pem --key-id main
agents-market registry verify --registry ./registry.bundle.json --public-key ./registry-public.pem --key-id main --json
```

Bundle signatures use Ed25519 and cover the registry bundle checksum. `registry verify` always validates the bundle checksum while loading the source; when a public key is provided, it also verifies the matching signature. Hosted marketplace catalogs can publish the public key separately so agent-native installers can verify a bundle before locking or installing from it.

Lint a registry before publishing:

```bash
agents-market registry lint --strict
agents-market registry lint --strict --json
```

The linter checks references, duplicate IDs, routing metadata, permission/tool consistency, prompt quality, pack size, and recommendation signals. Use `--json` in CI or agent-native workflows to parse `{ ok, score, findings, promptQuality }`.

`promptQuality` is a deterministic, explainable score for every agent prompt. It grades role framing, task specificity, context gathering, safety/scope constraints, expected output, domain specificity, and verification posture. Low-scoring prompts create lint findings so imported or third-party templates can be improved before publication.

Published packs declare `requires.agentsMarket`, for example `>=0.1.0`. `apply`, `install`, and `update` check this constraint before writing files so older CLIs reject incompatible registry content cleanly.

## Built-In Packs

- `starter-dev-pack`: review, debugging, tests, and documentation research.
- `frontend-pack`: visual verification, accessibility, review, tests, and debugging.
- `nextjs-pack`: Next.js performance, frontend verification, accessibility, tests, and review.
- `security-pack`: application security audit, dependency risk, secrets scanning, and review.

## Discover Agents

Search packs and individual agents before installing:

```bash
agents-market search accessibility
agents-market search "next performance" --type packs
agents-market search --type agents --target claude --category frontend
agents-market search review --json
```

Search supports bundled, local, bundle-file, and URL registries through `--registry`, the same as install commands.

Create a small project-specific pack from individual search results:

```bash
agents-market pack create frontend-lite \
  --agent code-reviewer accessibility-auditor \
  --tag custom frontend \
  --framework react \
  --language typescript \
  --out ./registry/packs
```

After creating the pack, run `agents-market registry lint --registry ./registry --json`, then preview it with `agents-market apply frontend-lite --registry ./registry --json`.

`pack create` adds a default `requires.agentsMarket` constraint for the current CLI version. Keep that constraint accurate when manually editing pack JSON.

## Agent-Native Integrations

Install the installer entrypoints into a project:

```bash
agents-market integrations install --target all
agents-market integrations package --target all --out ./integration-packages
```

This writes:

| Tool | Integration file |
| --- | --- |
| Claude Code | `.claude/skills/agents-market-installer/SKILL.md` |
| Codex | `.agents/skills/agents-market-installer/SKILL.md` |
| OpenCode | `.opencode/commands/agents-market.md` |

`integrations package` writes distributable bundles for release artifacts, team templates, or marketplace ingestion:

- `agents-market-claude/`
- `agents-market-codex/` with `.codex-plugin/plugin.json`
- `agents-market-opencode/`

Once installed, the user can ask their coding agent to recommend and install subagent packs from inside the coding session. The integration workflow previews with `apply --json`, asks for confirmation, installs with `apply --yes`, and verifies with `status` and `doctor`.

Agent-native wrappers can use structured output:

```bash
agents-market apply --target all --json
agents-market apply nextjs-pack --target all --json
agents-market recommend --json
agents-market plan nextjs-pack --target all
agents-market audit nextjs-pack --target all --json
agents-market diff nextjs-pack --target all --json
```

Use `apply` as the high-level agent-native workflow. Without a pack id, it detects the project and selects the top recommendation. By default it previews the audit, policy check, and file diff without writing files. Add `--yes` only after confirmation to install the selected pack and record it in `.agents-market/manifest.json`.

Use `plan --json` before installation when you need a project-aware confirmation payload. It includes registry source, pack metadata, file changes, audit risk, compatibility, optional policy results, readiness, and next `apply`/`doctor` commands.

Use `audit` before installation to summarize permissions, tool access, target support, provenance, and source license coverage.

## Project Policy

Create a team policy before installing packs from a shared or hosted registry:

```bash
agents-market policy init --preset balanced
agents-market policy check frontend-pack --target all --json
```

This writes `.agents-market/policy.json` and lets CI or agent-native workflows block packs that exceed project rules for max permission, full bash, web access, allowed targets, blocked agents, or blocked packs.

Use `policy check` after `audit` and before `diff`/`install`. It exits non-zero on policy violations, so it is safe to run in CI.

Use `install --enforce-policy` when a project has `.agents-market/policy.json`; the CLI will block installation before writing files if the pack violates policy.

`doctor --strict --json` also checks installed packs against policy, so CI can detect policy drift after installation.

See [docs/policy.md](./docs/policy.md).

## Web Catalog

Build a static marketplace catalog:

```bash
agents-market catalog build --out ./site
agents-market catalog build --out ./site --base-url https://example.com/agents-market
agents-market catalog verify --dir ./site
```

The catalog generator writes:

- `index.html`: searchable static catalog with target filters, quality ratings, provenance summaries, and import workflow commands
- `catalog.json`: machine-readable catalog with pack audits, prompt quality scores, ratings, provenance coverage, `apply` preview/install commands, safety workflow commands, pack compatibility requirements, changelog entries, import workflow commands, and agent metadata
- `registry.bundle.json`: portable registry bundle that users can install from

Use `--base-url` when publishing the catalog to GitHub Pages or another static host. Pack cards and `catalog.json` will then include copyable `apply --json` preview commands, confirmed `apply --yes` install commands, and lower-level audit/diff commands that use the hosted `registry.bundle.json` URL instead of a local relative path.

Run `catalog verify` before publishing static assets. It checks that `catalog.json`, `registry.bundle.json`, and `index.html` agree on pack counts, audits, quality scores, provenance summaries, import workflow commands, `apply` workflow commands, and hosted bundle URLs.

The repository includes GitHub Actions for CI and GitHub Pages catalog deployment.

## Import Third-Party Templates

Normalize Claude Code or OpenCode Markdown agents into the registry schema:

```bash
agents-market import markdown ./code-reviewer.md --target claude --out ./registry/agents
agents-market import directory ./community-agents --target claude --out ./registry/agents --pack community-pack --pack-out ./registry/packs
agents-market import repo owner/community-agents --target claude --path agents --out ./registry/agents --pack community-pack --pack-out ./registry/packs
agents-market registry lint --registry ./registry --json
```

Preserve provenance when importing community templates:

```bash
agents-market import directory ./community-agents \
  --target claude \
  --out ./registry/agents \
  --source-repo owner/repo \
  --source-license MIT \
  --source-url https://github.com/owner/repo
```

For public GitHub template repositories, `import repo` derives the repository provenance automatically:

```bash
agents-market import repo owner/repo \
  --target claude \
  --path agents \
  --ref main \
  --out ./registry/agents \
  --source-license MIT
```

When provenance is present, import commands record `provenance.sourceSha256` for the original Markdown source. Registry lint, audit output, the Web catalog, and registry review summaries surface checksum coverage for imported content.

See [docs/import.md](./docs/import.md).

## Contributing Marketplace Content

Agents Market is curated. Before adding or importing registry content, read [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/contributing-agents.md](./docs/contributing-agents.md).

Registry pull requests should include provenance, source checksums, source license data for third-party content, strict registry lint output, pack audit output, and an install preview. The pull request template lists the required evidence.

Registry-related pull requests also run the `Registry Review` GitHub Actions workflow. It uploads JSON and Markdown review artifacts, writes the same pack-by-pack report to the Actions summary, and maintains a sticky PR comment with lint, prompt quality, catalog verification, audit, and apply-preview results.

Registry content changes should also update `registry/changelog.json` so hosted bundles and catalogs can explain what changed.

Do not open public issues for vulnerabilities, policy bypasses, unsafe generated files, or registry supply-chain risks. Use the private reporting path in [SECURITY.md](./SECURITY.md).

## Repository Layout

```text
registry/
  agents/     Standard agent source definitions
  packs/      Curated installable packs
  changelog.json  Versioned registry release notes
integrations/
  claude-skill/       Claude Code installer skill source
  codex-skill/        Codex installer skill source
  opencode-command/   OpenCode installer command source
src/
  adapters/   Claude Code, Codex, and OpenCode generators
  index.ts    CLI entrypoint
.github/
  workflows/  CI, GitHub Pages catalog publishing, and npm release
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
- Import tooling creates a path from popular community template collections into curated, linted packs.

## Release

The package is prepared for npm publication as `@agents-market/cli`.

Before release:

```bash
npm run lint
npm run build
node dist/index.js registry lint --strict --json
npm test
npm run release:artifacts -- --out ./release-artifacts
npm pack --dry-run
```

Publishing is handled by the Release GitHub Actions workflow on `v*` tags. It publishes the npm package, uploads release artifacts, and attaches the registry bundle plus Claude Code, Codex, and OpenCode installer archives to the GitHub Release. See [docs/release.md](./docs/release.md).

See [claude_code_agents_research.md](./claude_code_agents_research.md) for the underlying Claude Code, Codex, and OpenCode research.
