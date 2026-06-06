# Contributing

Agents Market accepts changes to the CLI, registry, documentation, and generated catalog. The registry is the product surface users install from, so agent and pack changes need a little more evidence than ordinary documentation updates.

## Local Setup

```bash
npm ci
npm run build
npm test
```

Before opening a pull request, run the full release gate:

```bash
npm run release:check
```

## Agent And Pack Contributions

Read [docs/contributing-agents.md](./docs/contributing-agents.md) before adding or importing agents.

Every registry pull request should include:

- A clear use case and routing trigger for each new agent or pack.
- Provenance for third-party or imported templates.
- Source license information for third-party content.
- A passing strict registry lint report.
- An `audit --json` summary for every new or changed pack.
- A preview command showing the files that would be installed.

Useful commands:

```bash
node dist/index.js registry lint --registry ./registry --strict --json
node dist/index.js audit <pack-id> --target all --json
node dist/index.js apply <pack-id> --target all --policy-preset balanced --json
node dist/index.js catalog build --out ./site --base-url https://example.com/agents-market
node dist/index.js catalog verify --dir ./site --json
```

## Review Standard

Maintainers should prefer small, focused packs over broad collections. A pack should be easy to explain, safe to audit, and useful enough that a coding agent can recommend it from project signals.

Do not merge registry content that:

- Enables broader tools than the agent task requires.
- Uses full bash without a specific, reviewed reason.
- Lacks provenance or license data for third-party content.
- Duplicates an existing agent without a clearer scope.
- Has no recommendation signals.
- Fails `registry lint --strict`.

