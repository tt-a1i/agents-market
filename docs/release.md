# Release

Agents Market publishes as the npm package `@agents-market/cli`.

## Prerequisites

- npm account with publish access to `@agents-market/cli`.
- GitHub repository secret `NPM_TOKEN` with publish permission.
- Clean `main` branch with passing CI.

## Local Verification

```bash
npm ci
npm run release:check
```

`release:check` runs typecheck, build, registry strict lint with JSON assertions, registry changelog assertions, a signed registry export/verify smoke test, the registry submission gate, tests, catalog build, a full CLI lifecycle smoke test, npm package dry run, and required tarball content checks.

`release:artifacts` builds production release artifacts into `./release-artifacts`. Use `--package github:tt-a1i/agents-market` for preview catalogs and `--package @agents-market/cli` for official npm-backed releases:

```bash
npm run release:artifacts -- --out ./release-artifacts --catalog-base-url https://tt-a1i.github.io/agents-market --release-tag preview-0.1.0 --package github:tt-a1i/agents-market
```

The artifact builder stamps `registry.bundle.json`, `catalog/catalog.json`, and `release-artifacts.json` with release/source metadata: homepage, repository URL, catalog URL, release URL, package spec, and the current git commit when available. Bundle metadata is included in the registry checksum.

- `registry.bundle.json`
- `catalog/` with `index.html`, `catalog.json`, and `registry.bundle.json`
- `agents-market-catalog-<version>.tgz`
- `agents-market-claude-<version>.tgz`
- `agents-market-codex-<version>.tgz`
- `agents-market-opencode-<version>.tgz`
- `npm/agents-market-cli-<version>.tgz`
- `install.sh`
- `SHA256SUMS` and `release-artifacts.json`

GitHub Actions workflows run on Node.js 24 and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so hosted actions use the current JavaScript runtime. The Pages workflow also runs `agents-market catalog verify --dir ./site` before uploading the static catalog artifact.

## Release Flow

### npm Release

1. Update `package.json` version.
2. Commit the version change.
3. Create and push a tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. The Release workflow runs `npm run release:check`, builds release artifacts, uploads them to the workflow run, publishes to npm with provenance, and attaches distributable artifacts to the GitHub Release.

### Preview Release

When npm credentials are not configured yet, publish a non-`v*` prerelease tag such as `preview-0.1.0` after running `npm run release:artifacts`. This does not trigger the npm publishing workflow, but it can distribute:

- the registry bundle
- Claude Code, Codex, and OpenCode installer archives
- the npm tarball for manual inspection
- `install.sh` for checksum-verified installation from the release tarball
- `SHA256SUMS` and `release-artifacts.json`

The current preview release is [preview-0.1.0](https://github.com/tt-a1i/agents-market/releases/tag/preview-0.1.0). The production npm release is still gated on the `NPM_TOKEN` secret.

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/install.sh | sh
```

## Manual Dispatch

The workflow can also be started manually from GitHub Actions. The input must match `v<package.json version>` so manual releases cannot publish a mismatched package version by accident. Manual dispatch uses that input as the release tag for artifact metadata and GitHub Release uploads; tag pushes use the pushed tag name.

## Post-Release Checks

```bash
npm view @agents-market/cli version
npx @agents-market/cli list
npx @agents-market/cli registry lint --strict --json
```
