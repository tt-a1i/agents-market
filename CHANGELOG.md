# Changelog

All notable package and release changes are tracked here. Registry content changes are also recorded in `registry/changelog.json` so hosted catalogs and agent-native workflows can expose registry history.

## Unreleased

### Changed

- CLI JSON output now includes `schemaVersion` and `--json` failures return structured `{ ok: false, error }` payloads instead of plain stderr-only messages.
- `list --agents --json` now omits prompt bodies by default, with `--full`, `--limit`, and `--fields` available for bounded detailed output.

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
