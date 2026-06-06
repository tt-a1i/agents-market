# Operations

This runbook covers the production controls that keep Agents Market safe to operate as a public agent registry and installer.

## Repository Controls

Protect `main` before accepting external contributions:

- Require pull requests before merging.
- Require passing CI on the latest commit.
- Require review from CODEOWNERS.
- Dismiss stale approvals when new commits are pushed.
- Restrict force pushes and branch deletion.

Sensitive paths are owned in `.github/CODEOWNERS`, including registry content, release workflows, dependency automation, release scripts, security policy, and package metadata. `npm run release:check` validates that the expected CODEOWNERS coverage is present.

## Required Secrets

Production npm publishing requires this GitHub repository secret:

| Secret | Purpose |
| --- | --- |
| `NPM_TOKEN` | npm automation token with publish access to `@agents-market/cli`. |

The Release workflow uses npm provenance, so it also needs the workflow `id-token: write` permission already declared in `.github/workflows/release.yml`.

## Release Readiness

Before creating a production `v*` tag:

```bash
npm ci
npm run release:check
npm run release:artifacts -- --out ./release-artifacts --catalog-base-url https://tt-a1i.github.io/agents-market --release-tag v0.1.0 --package @agents-market/cli
```

Verify:

- CI is passing on `main`.
- `package.json` version matches the release tag.
- `.github/CODEOWNERS` covers registry, workflow, release, and package metadata paths.
- `NPM_TOKEN` is configured.
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
3. Upload workflow artifacts.
4. Publish `@agents-market/cli` to npm with provenance.
5. Attach distributable artifacts to the GitHub Release.

Post-release verification:

```bash
npm view @agents-market/cli version
npx @agents-market/cli list
npx @agents-market/cli registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --json
```

## Preview Release Refresh

Use the preview release while npm publication is not configured, or when refreshing release artifacts for a pre-npm milestone:

```bash
rm -rf /tmp/agents-market-release-artifacts
npm run build
npm run release:artifacts -- --out /tmp/agents-market-release-artifacts --catalog-base-url https://tt-a1i.github.io/agents-market --release-tag preview-0.1.0 --package github:tt-a1i/agents-market
gh release upload preview-0.1.0 \
  /tmp/agents-market-release-artifacts/agents-market-catalog-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/agents-market-claude-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/agents-market-codex-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/agents-market-opencode-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/npm/agents-market-cli-0.1.0.tgz \
  /tmp/agents-market-release-artifacts/registry.bundle.json \
  /tmp/agents-market-release-artifacts/install.sh \
  /tmp/agents-market-release-artifacts/SHA256SUMS \
  /tmp/agents-market-release-artifacts/release-artifacts.json \
  --repo tt-a1i/agents-market --clobber
```

Verify the remote manifest:

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/release-artifacts.json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({commit:j.commit, artifactCount:j.artifacts.length, hasNpmTarball:j.artifacts.some(a=>a.path==='npm/agents-market-cli-0.1.0.tgz')}, null, 2));})"
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
