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

`release:check` runs typecheck, build, registry strict lint with JSON assertions, the registry submission gate, tests, catalog build, a full CLI lifecycle smoke test, npm package dry run, and required tarball content checks.

GitHub Actions workflows run on Node.js 24 and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so hosted actions use the current JavaScript runtime. The Pages workflow also runs `agents-market catalog verify --dir ./site` before uploading the static catalog artifact.

## Release Flow

1. Update `package.json` version.
2. Commit the version change.
3. Create and push a tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. The Release workflow runs `npm run release:check` and publishes to npm with provenance.

## Manual Dispatch

The workflow can also be started manually from GitHub Actions. It still publishes the package version from `package.json`; the workflow input is only a human-readable release label.

## Post-Release Checks

```bash
npm view @agents-market/cli version
npx @agents-market/cli list
npx @agents-market/cli registry lint --strict --json
```
