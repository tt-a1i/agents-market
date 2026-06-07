# Changelog

All notable package and release changes are tracked here. Registry content changes are also recorded in `registry/changelog.json` so hosted catalogs and agent-native workflows can expose registry history.

## Unreleased

### Added

- Claude Code plugin marketplace: `/plugin marketplace add tt-a1i/agents-market` followed by `/plugin install agents-market-installer@agents-market` installs the installer skill without touching project files. The marketplace manifest lives at `.claude-plugin/marketplace.json` and the plugin source under `integrations/claude-plugin/`.
- The Claude installer skill now documents the `npx` fallback for environments where the `agents-market` CLI is not installed.
- Homebrew tap: `brew install tt-a1i/tap/agents-market` installs the CLI from a commit-pinned source archive ([tt-a1i/homebrew-tap](https://github.com/tt-a1i/homebrew-tap)); the formula switches to the npm registry tarball once `@agents-market/cli` is published.
- Marketing landing page: `catalog build` now generates a dark-first landing page as `index.html` (IBM Plex, live registry stats, featured packs/agents, install methods, trust chain) and moves the searchable browse catalog to `catalog.html`. `catalog verify` checks both pages, including landing stats consistency with the registry bundle.

## 0.1.0

First npm release, published as [@agents-market/cli](https://www.npmjs.com/package/@agents-market/cli). Includes everything from the preview release plus the changes below.

### Added

- Registry tiers: every agent and pack now declares `tier: core` (curated, maintained by Agents Market) or `tier: community` (imported collections). Missing tiers resolve to `community` so third-party registries cannot claim the curated tier implicitly.
- `--tier <core|community|all>` filters for `list` and `search`, and `tier` fields in `list`, `search`, `recommend`, `apply`, `plan`, `init`, and catalog JSON output.
- Prompt boilerplate detection: paragraphs shared verbatim across five or more agents are excluded from prompt quality scoring, and the lint report includes a `prompt-boilerplate` summary finding.
- `info` lint severity and `infoCount` in lint reports. Community-tier agents with low prompt quality produce `info` findings that surface in reports without failing strict CI; core-tier agents keep the strict warning/error bar.
- `core-pack-community-agent` lint warning when a core pack references community-tier agents.

### Changed

- CLI JSON output now includes `schemaVersion` and `--json` failures return structured `{ ok: false, error }` payloads instead of plain stderr-only messages.
- `list --agents --json` now omits prompt bodies by default, with `--full`, `--limit`, and `--fields` available for bounded detailed output.
- `recommend` now ranks core packs above community packs regardless of signal score, so `apply` without a pack id always auto-selects curated content when any core pack matches.
- Prompt quality scores are now computed with shared boilerplate excluded, so imported template text no longer inflates per-agent scores. The Web catalog shows the adjusted scores and groups packs into Core and Community sections.

## 0.1.0 - Preview

Preview release: https://github.com/tt-a1i/agents-market/releases/tag/preview-0.1.0

### Added

- Initial CLI for listing, searching, recommending, planning, applying, updating, rolling back, uninstalling, exporting, and auditing curated subagent packs.
- Native generation for Claude Code `.claude/agents/*.md`, Codex `.codex/agents/*.toml`, and OpenCode `.opencode/agents/*.md`.
- Curated starter, frontend, Next.js, and security packs with prompt-quality, permission, compatibility, and provenance review gates.
- Agent-native installer integrations for Claude Code skills, Codex skills/plugins, and OpenCode commands.
- Static catalog generation with copyable install workflows, hosted registry bundle verification, catalog URL verification, signatures, provenance summaries, and GitHub Pages support.
- Signed registry bundles, signed registry locks, SPDX SBOMs, SHA256 manifests, complete release archives, GitHub Artifact Attestations, and strict installer verification mode.
- Import tooling for Markdown files, local template directories, and GitHub repositories with compact JSON reports and commit/checksum provenance.
- GitHub Actions for CI, registry review, release artifacts, Pages deployment, CodeQL, dependency review, OpenSSF Scorecard, and downstream installed-pack maintenance workflows.
- Public contribution, support, security, and privacy documentation for operating Agents Market as a curated public marketplace.
