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
npm run dev -- init --target all
npm run dev -- list --agents
npm run dev -- recommend
npm run dev -- install starter-dev-pack --target all --dry-run
npm run dev -- status
```

After publishing, the intended user flow is:

```bash
npx @agents-market/cli init --target all
npx @agents-market/cli recommend
npx @agents-market/cli apply --target all
npx @agents-market/cli apply frontend-pack --target all --yes
npx @agents-market/cli install frontend-pack --target all
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
agents-market doctor
agents-market doctor --strict --json
agents-market update
agents-market update --dry-run --json
agents-market uninstall starter-dev-pack --target claude
agents-market uninstall starter-dev-pack --target claude --dry-run --json
agents-market export frontend-pack --target all --out ./generated
agents-market registry info
agents-market registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --json
agents-market registry export --out ./registry.bundle.json
agents-market registry lock --registry ./registry.bundle.json
agents-market registry verify-lock
agents-market registry lint --strict
agents-market integrations diff --target all
agents-market integrations install --target all
agents-market catalog build --out ./site
agents-market catalog build --out ./site --base-url https://example.com/agents-market
agents-market catalog verify --dir ./site
agents-market import markdown ./agent.md --target claude --out ./registry/agents
agents-market import directory ./third-party-agents --target claude --out ./registry/agents --pack imported-pack --pack-out ./registry/packs
agents-market import repo owner/community-agents --target claude --path agents --out ./registry/agents --pack community-pack --pack-out ./registry/packs
```

## Install Manifest

Installs write `.agents-market/manifest.json`. The manifest records installed packs, targets, generated files, and content hashes.

This enables drift-aware operations:

- `status` reports clean, modified, and missing generated files; use `status --json` for automation.
- `doctor` runs manifest, registry lock, policy, drift, and target directory health checks; use `doctor --strict --json` in CI.
- `update` refreshes installed packs from the current registry.
- `uninstall` removes generated files while skipping and continuing to track user-modified files by default.

Use `update --dry-run --json` and `uninstall --dry-run --json` before changing installed packs in automation. Use `--force` with `update` or `uninstall` only when you intentionally want to overwrite or remove modified generated files.

## Initialize A Project

Use `init` as the first-run setup:

```bash
agents-market init --target all
agents-market init --target claude --dry-run --json
```

`init` locks the selected registry, installs the agent-native installer entrypoints, detects the project, recommends a pack, and prints the next `audit`, `diff`, `install`, and `doctor` commands. It does not install the recommended pack automatically; pack installation still requires an explicit `install` or `apply --yes`.

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

`registry info` reports source type, source URL/path, version, checksum, pack count, agent count, target support, and pack inventory. Agent-native workflows can use the JSON output to summarize a hosted registry before asking the user to lock or install from it.

Lint a registry before publishing:

```bash
agents-market registry lint --strict
```

The linter checks references, duplicate IDs, routing metadata, permission/tool consistency, prompt structure, pack size, and recommendation signals.

## Built-In Packs

- `starter-dev-pack`: review, debugging, tests, and documentation research.
- `frontend-pack`: visual verification, accessibility, review, tests, and debugging.
- `nextjs-pack`: Next.js performance, frontend verification, accessibility, tests, and review.

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

After creating the pack, run `agents-market registry lint --registry ./registry`, then install it with `agents-market install frontend-lite --registry ./registry`.

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

- `index.html`: searchable static catalog
- `catalog.json`: machine-readable catalog with pack audits, `apply` preview/install commands, safety workflow commands, and agent metadata
- `registry.bundle.json`: portable registry bundle that users can install from

Use `--base-url` when publishing the catalog to GitHub Pages or another static host. Pack cards and `catalog.json` will then include copyable `apply --json` preview commands, confirmed `apply --yes` install commands, and lower-level audit/diff commands that use the hosted `registry.bundle.json` URL instead of a local relative path.

Run `catalog verify` before publishing static assets. It checks that `catalog.json`, `registry.bundle.json`, and `index.html` agree on pack counts, audits, `apply` workflow commands, and hosted bundle URLs.

The repository includes GitHub Actions for CI and GitHub Pages catalog deployment.

## Import Third-Party Templates

Normalize Claude Code or OpenCode Markdown agents into the registry schema:

```bash
agents-market import markdown ./code-reviewer.md --target claude --out ./registry/agents
agents-market import directory ./community-agents --target claude --out ./registry/agents --pack community-pack --pack-out ./registry/packs
agents-market import repo owner/community-agents --target claude --path agents --out ./registry/agents --pack community-pack --pack-out ./registry/packs
agents-market registry lint --registry ./registry
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

See [docs/import.md](./docs/import.md).

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
node dist/index.js registry lint --strict
npm test
npm pack --dry-run
```

Publishing is handled by the Release GitHub Actions workflow on `v*` tags. See [docs/release.md](./docs/release.md).

See [claude_code_agents_research.md](./claude_code_agents_research.md) for the underlying Claude Code, Codex, and OpenCode research.
