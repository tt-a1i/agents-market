# Operations

This runbook covers the production controls that keep Agents Market safe to operate as a public agent registry and installer.

## Repository Controls

Protect `main` before accepting external contributions:

- Require pull requests before merging.
- Require passing checks on the latest commit: `test`, `registry-review`, `CodeQL`, and `Dependency Review`.
- Require review from CODEOWNERS.
- Dismiss stale approvals when new commits are pushed.
- Restrict force pushes and branch deletion.

`registry-review` intentionally runs on every pull request so it can be configured as a required check. `test` runs `npm run release:check`, while the dedicated security checks keep CodeQL and dependency review visible as independent merge gates.

Sensitive paths are owned in `.github/CODEOWNERS`, including registry content, release workflows, dependency automation, release scripts, security policy, and package metadata. `npm run release:check` validates that the expected CODEOWNERS coverage is present.

## Security Automation

The repository runs a dedicated `Security` GitHub Actions workflow on pull requests, pushes to `main`, weekly schedule, and manual dispatch. It includes:

- CodeQL analysis for JavaScript and TypeScript.
- Dependency Review on pull requests with high-severity dependency changes blocked.
- OpenSSF Scorecard on pushes to `main`, weekly schedule, and manual dispatch, with SARIF upload and published results.

`npm run release:check` validates the workflow configuration so CodeQL, dependency review, OpenSSF Scorecard, required permissions, and the scheduled/manual triggers remain in place.

## Required Secrets

Production npm publishing requires this GitHub repository secret:

| Secret | Purpose |
| --- | --- |
| `NPM_TOKEN` | npm automation token with publish access to `@agents-market/cli`. |
| `REGISTRY_SIGNING_PRIVATE_KEY` | Optional Ed25519 private key PEM used to sign release registry bundles. |
| `REGISTRY_SIGNING_PUBLIC_KEY` | Optional Ed25519 public key PEM uploaded as `registry-public.pem` and used to verify the signed bundle during artifact generation. |
| `REGISTRY_SIGNING_KEY_ID` | Optional signing key id recorded in bundle signatures, for example `main`. |

The Release workflow declares job-level permissions in `.github/workflows/release.yml`: the artifact job gets `attestations: write`, `contents: write`, and `id-token: write` for GitHub Release uploads and attestations, while the protected npm publish job gets only `contents: read` and `id-token: write` for source checkout and npm provenance.

Configure all three registry signing secrets together. If any one signing secret is present without the others, the Release and Pages workflows fail before publishing.

Confirm that the GitHub Actions environment named `npm-release` exists before the first production publish. Use environment reviewers or wait timers if the project wants a final manual release gate. The Release workflow serializes release runs by tag or manual version without canceling in-progress publishes, defines job timeouts, and disables persisted checkout credentials before build scripts execute. Non-release workflows cancel superseded runs on the same ref. Only the `publish-npm` job enters the protected `npm-release` environment, so preview releases can still refresh signed and attested GitHub Release assets without npm credentials.

## Release Readiness

Before creating a production `v*` tag:

```bash
npm ci
npm run release:check
npm run release:artifacts -- --out ./release-artifacts --catalog-base-url https://tt-a1i.github.io/agents-market --release-tag v0.1.0 --package @agents-market/cli
npm run release:verify-artifacts -- --dir ./release-artifacts
agents-market release verify-artifacts --archive ./release-artifacts/agents-market-release-artifacts-0.1.0.tgz
```

When signing keys are configured, `release:verify-artifacts` and `agents-market release verify-artifacts` also verify the root and catalog registry bundle signatures with the bundled public keys.

Verify:

- CI is passing on `main`.
- The `Security` workflow is enabled and passing for CodeQL and dependency review.
- The `npm-release` GitHub Actions environment exists and has the intended reviewer policy.
- `package.json` version matches the release tag.
- `.github/CODEOWNERS` covers registry, workflow, release, and package metadata paths.
- `NPM_TOKEN` is configured.
- Registry signing secrets are either all configured or all omitted.
- The preview release and hosted catalog are healthy.

## Production Release

Create and push a `v*` tag that matches `package.json`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The Release workflow will:

1. Run `npm run release:check`.
2. Build release artifacts.
3. Verify the generated release artifact directory.
4. Create GitHub Artifact Attestations from `release-artifacts/SHA256SUMS` and the complete release archive.
5. Upload workflow artifacts.
6. Publish `@agents-market/cli` to npm with provenance.
7. Attach distributable artifacts to the GitHub Release.

Post-release verification:

```bash
npm view @agents-market/cli version
npx @agents-market/cli list
npx @agents-market/cli registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --json
npx @agents-market/cli catalog verify --url https://tt-a1i.github.io/agents-market/catalog.json --json
gh attestation verify ./release-artifacts/registry.bundle.json --repo tt-a1i/agents-market
gh attestation verify ./release-artifacts/SHA256SUMS --repo tt-a1i/agents-market
gh attestation verify ./release-artifacts/agents-market-release-artifacts-0.1.0.tgz --repo tt-a1i/agents-market
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/v0.1.0/install.sh | AGENTS_MARKET_REQUIRE_ATTESTATION=1 sh
```

## Preview Release Refresh

Use the preview release while npm publication is not configured, or when refreshing release artifacts for a pre-npm milestone:

```bash
git tag -f preview-0.1.0 HEAD
git push --force origin refs/tags/preview-0.1.0
```

The Release workflow will run the same verification, signing, GitHub Artifact Attestation, workflow artifact upload, and GitHub Release upload chain as a production release. It also updates the GitHub Release target commit and notes on every refresh so the tag, release metadata, `release-artifacts.json`, and attached assets point at the same source commit. Preview tags skip `npm publish --provenance`, do not enter the protected `npm-release` environment, and build catalogs with the tag-pinned package spec `github:tt-a1i/agents-market#preview-0.1.0`.

The workflow can also be started manually from GitHub Actions with `preview-<package.json version>` as the `version` input.

Use the local upload path only as a fallback if GitHub Actions is unavailable. This fallback cannot create GitHub Artifact Attestations, so strict installer mode will fail until the release is refreshed through the workflow:

```bash
rm -rf /tmp/agents-market-release-artifacts
npm run build
npm run release:artifacts -- --out /tmp/agents-market-release-artifacts --catalog-base-url https://tt-a1i.github.io/agents-market --release-tag preview-0.1.0 --package github:tt-a1i/agents-market#preview-0.1.0
npm run release:verify-artifacts -- --dir /tmp/agents-market-release-artifacts
npm run release:verify-artifacts -- --archive /tmp/agents-market-release-artifacts/agents-market-release-artifacts-0.1.0.tgz
agents-market release verify-artifacts --archive /tmp/agents-market-release-artifacts/agents-market-release-artifacts-0.1.0.tgz
assets=(
  /tmp/agents-market-release-artifacts/agents-market-catalog-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/agents-market-claude-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/agents-market-codex-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/agents-market-opencode-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/agents-market-release-artifacts-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/npm/agents-market-cli-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/sbom.spdx.json \
  /tmp/agents-market-release-artifacts/registry.bundle.json \
  /tmp/agents-market-release-artifacts/install.sh \
  /tmp/agents-market-release-artifacts/SHA256SUMS \
  /tmp/agents-market-release-artifacts/release-artifacts.json
)
if [ -f /tmp/agents-market-release-artifacts/registry-public.pem ]; then
  assets+=(/tmp/agents-market-release-artifacts/registry-public.pem)
fi
gh release upload preview-0.1.0 "${assets[@]}" --repo tt-a1i/agents-market --clobber
```

Verify the remote manifest:

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/release-artifacts.json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({commit:j.commit, artifactCount:j.artifacts.length, hasNpmTarball:j.artifacts.some(a=>a.path==='npm/agents-market-cli-0.1.0.tgz')}, null, 2));})"
```

If `registry-public.pem` was uploaded, verify the hosted bundle signature:

```bash
agents-market registry verify --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --public-key https://tt-a1i.github.io/agents-market/registry-public.pem --key-id main
agents-market catalog verify --url https://tt-a1i.github.io/agents-market/catalog.json --json
agents-market registry lock --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --public-key https://tt-a1i.github.io/agents-market/registry-public.pem --key-id main
```

## Registry Change Review

Treat registry content as executable-adjacent supply-chain input. For every new agent or pack:

- Run `npm run dev -- registry lint --strict --json`.
- Run `npm run dev -- registry review --registry ./registry --summary-json registry-review.json --summary-markdown registry-review.md`.
- Check that prompts have a clear role, task, context-gathering instructions, safety constraints, output shape, and verification posture.
- Prefer narrow, auditable agents over broad workflow-changing agents.
- Require human review before accepting third-party imported prompts.

## Incident Response

If a published registry bundle, release artifact, or npm package is compromised:

1. Remove or supersede the affected registry entry.
2. Publish a patched registry bundle and release artifact set.
3. Publish a patched npm version when npm is affected.
4. Document the affected versions and mitigation in `SECURITY.md` or a GitHub Security Advisory.
5. Ask users to run `agents-market registry verify-lock`, `agents-market doctor --strict`, and `agents-market update` after the fix is available.
