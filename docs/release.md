# Release

Agents Market publishes as the npm package `@agents-market/cli`.

For repository controls, required secrets, preview refresh commands, and incident response, see [Operations](operations.md).

## Prerequisites

- npm account with publish access to `@agents-market/cli`.
- GitHub repository secret `NPM_TOKEN` with publish permission.
- Clean `main` branch with passing CI.

## Local Verification

```bash
npm ci
npm run release:check
```

`release:check` runs typecheck, build, registry strict lint with JSON assertions, registry changelog assertions, a signed registry export/verify smoke test, the registry submission gate, tests, catalog build, release artifact verification, a full CLI lifecycle smoke test, npm package dry run, npm tarball install smoke, SPDX SBOM assertions, and required tarball content checks.

`release:artifacts` builds production release artifacts into `./release-artifacts`. Use a tag- or SHA-pinned GitHub package spec for preview catalogs and `--package @agents-market/cli` for official npm-backed releases:

```bash
npm run release:artifacts -- --out ./release-artifacts --catalog-base-url https://tt-a1i.github.io/agents-market --release-tag preview-0.1.0 --package github:tt-a1i/agents-market#preview-0.1.0
npm run release:verify-artifacts -- --dir ./release-artifacts
npm run release:verify-artifacts -- --archive ./release-artifacts/agents-market-release-artifacts-0.1.0.tgz
agents-market release verify-artifacts --archive ./release-artifacts/agents-market-release-artifacts-0.1.0.tgz
```

The artifact builder stamps `registry.bundle.json`, `catalog/catalog.json`, and `release-artifacts.json` with release/source metadata: homepage, repository URL, catalog URL, release URL, package spec, and the current git commit when available. Bundle metadata is included in the registry checksum.
`release:verify-artifacts` and `agents-market release verify-artifacts` validate the manifest, `SHA256SUMS`, required release files, registry/catalog JSON, registry signatures when public keys are present, catalog static site metadata, and SPDX SBOM for a local artifact directory or a downloaded `agents-market-release-artifacts-<version>.tgz` archive.

- `registry.bundle.json`
- `registry-public.pem` when registry signing secrets are configured
- `catalog/` with `index.html`, `catalog.json`, `agents-market.json`, `registry.bundle.json`, `site.webmanifest`, `robots.txt`, and `favicon.svg`
- `agents-market-catalog-<version>.tgz`
- `agents-market-claude-<version>.tgz`
- `agents-market-codex-<version>.tgz`
- `agents-market-opencode-<version>.tgz`
- `agents-market-release-artifacts-<version>.tgz` with the complete verifiable artifact directory
- `npm/agents-market-cli-<version>.tgz`
- `sbom.spdx.json`
- `install.sh`
- `SHA256SUMS` and `release-artifacts.json`

GitHub Actions workflows run on Node.js 24 and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so hosted actions use the current JavaScript runtime. Jobs define explicit timeouts and check out source with persisted GitHub credentials disabled. Non-release workflows cancel superseded runs on the same ref; release runs are serialized without canceling an in-progress publish. The Pages workflow also runs `agents-market catalog verify --dir ./site` before uploading the static catalog artifact.

If the repository secrets `REGISTRY_SIGNING_PRIVATE_KEY`, `REGISTRY_SIGNING_PUBLIC_KEY`, and `REGISTRY_SIGNING_KEY_ID` are configured, the Release workflow signs `registry.bundle.json`, signs the catalog's hosted `registry.bundle.json`, verifies both signatures during artifact generation, and uploads `registry-public.pem` with the GitHub Release assets. The Pages workflow uses the same secrets to publish a signed hosted catalog bundle.

The Release workflow serializes runs by release tag or manual version and checks out source with persisted GitHub credentials disabled. Artifact generation, verification, attestation, and GitHub Release uploads run before the protected npm publish job so preview releases can be refreshed without npm credentials. Only the `publish-npm` job runs in the `npm-release` GitHub Actions environment, and only for `v*` release tags.

The Release workflow also creates GitHub Artifact Attestations from `release-artifacts/SHA256SUMS` and separately attests the complete release artifact archive after `release:verify-artifacts` passes. After downloading release assets, verify attested files with GitHub CLI:

```bash
gh attestation verify ./release-artifacts/registry.bundle.json --repo tt-a1i/agents-market
gh attestation verify ./release-artifacts/npm/agents-market-cli-0.1.0.tgz --repo tt-a1i/agents-market
gh attestation verify ./release-artifacts/agents-market-release-artifacts-0.1.0.tgz --repo tt-a1i/agents-market
```

`install.sh` requires `curl`, `npm`, and either `sha256sum` or `shasum`. It always verifies the npm tarball against `SHA256SUMS` before installing, then runs `npm install -g --ignore-scripts` so npm lifecycle scripts are not executed. Set `AGENTS_MARKET_REQUIRE_ATTESTATION=1` to require GitHub CLI attestation verification for both `SHA256SUMS` and the npm tarball before checksum validation:

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/v0.1.0/install.sh | AGENTS_MARKET_REQUIRE_ATTESTATION=1 sh
```

## Release Flow

### npm Release

1. Update `package.json` version.
2. Commit the version change.
3. Create and push a tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. The Release workflow runs `npm run release:check`, builds and verifies release artifacts, creates GitHub Artifact Attestations from `SHA256SUMS` and the complete release archive, uploads them to the workflow run, publishes to npm with provenance, and attaches distributable artifacts to the GitHub Release.

### Preview Release

When npm credentials are not configured yet, create a non-`v*` prerelease tag such as `preview-0.1.0`, or manually dispatch the Release workflow with `preview-<package.json version>`. Preview releases run the same verification, artifact generation, GitHub Artifact Attestation, workflow artifact upload, and GitHub Release upload chain as production releases, but they skip `npm publish --provenance` and stamp catalogs with the tag-pinned GitHub package spec.

Preview releases distribute:

- the registry bundle
- the registry public key when signing is configured
- Claude Code, Codex, and OpenCode installer archives
- the npm tarball for manual inspection
- `sbom.spdx.json` for dependency transparency
- `install.sh` for checksum-verified installation from the release tarball
- `SHA256SUMS` and `release-artifacts.json`

The current preview release is [preview-0.1.0](https://github.com/tt-a1i/agents-market/releases/tag/preview-0.1.0). The production npm release is still gated on the `NPM_TOKEN` secret.

```bash
git tag preview-0.1.0
git push origin preview-0.1.0

curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/install.sh | sh
```

When the release was produced by the Release workflow and has GitHub Artifact Attestations, use the stricter installer mode:

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/install.sh | AGENTS_MARKET_REQUIRE_ATTESTATION=1 sh
```

When a public key is attached to a release or hosted catalog, verify the hosted bundle before locking or installing it:

```bash
agents-market registry verify --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --public-key https://tt-a1i.github.io/agents-market/registry-public.pem --key-id main
agents-market registry lock --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --public-key https://tt-a1i.github.io/agents-market/registry-public.pem --key-id main
```

## Manual Dispatch

The workflow can also be started manually from GitHub Actions. The input must match `v<package.json version>` for production releases or `preview-<package.json version>` for preview releases, so manual releases cannot publish a mismatched package version by accident. Manual dispatch uses that input as the release tag for artifact metadata and GitHub Release uploads; tag pushes use the pushed tag name.

## Post-Release Checks

```bash
npm view @agents-market/cli version
npx @agents-market/cli list
npx @agents-market/cli registry lint --strict --json
npx @agents-market/cli registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --json
gh attestation verify ./release-artifacts/registry.bundle.json --repo tt-a1i/agents-market
gh attestation verify ./release-artifacts/agents-market-release-artifacts-0.1.0.tgz --repo tt-a1i/agents-market
agents-market release verify-artifacts --archive ./release-artifacts/agents-market-release-artifacts-0.1.0.tgz
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/v0.1.0/install.sh | AGENTS_MARKET_REQUIRE_ATTESTATION=1 sh
```
