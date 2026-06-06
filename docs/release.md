# Release

Agents Market publishes as the npm package `@agents-market/cli`.

## Prerequisites

- npm account with publish access to `@agents-market/cli`.
- GitHub repository secret `NPM_TOKEN` with publish permission.
- Clean `main` branch with passing CI.

## Local Verification

```bash
npm ci
npm run lint
npm run build
node dist/index.js registry lint --strict
npm test
npm pack --dry-run
```

## Release Flow

1. Update `package.json` version.
2. Commit the version change.
3. Create and push a tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. The Release workflow runs tests, validates the registry, checks package contents, and publishes to npm with provenance.

## Manual Dispatch

The workflow can also be started manually from GitHub Actions. It still publishes the package version from `package.json`; the workflow input is only a human-readable release label.

## Post-Release Checks

```bash
npm view @agents-market/cli version
npx @agents-market/cli list
npx @agents-market/cli registry lint --strict
```
