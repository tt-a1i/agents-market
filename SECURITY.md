# Security Policy

Agents Market installs executable-adjacent agent instructions into developer repositories. Treat registry content, import tooling, generated files, and CLI lifecycle commands as security-sensitive.

## Supported Versions

Security fixes are applied to the current `main` branch and the latest published npm package version.

## Reporting A Vulnerability

Do not open a public issue for security-sensitive findings.

Use GitHub's private vulnerability reporting flow for this repository when available. If that is not available, contact the maintainers privately and include enough detail to reproduce the issue.

Useful report details:

- Affected command, registry source, or generated target.
- Minimal reproduction steps.
- Expected impact.
- Whether the issue involves third-party imported content.
- Whether generated files can cause command execution, unsafe writes, policy bypass, or unexpected network access.

## Security-Sensitive Areas

Please report privately if you find:

- A policy bypass in `apply`, `install`, `policy check`, or `doctor`.
- Registry lock or checksum verification bypass.
- Generated target files that grant broader tools or permissions than the registry declares.
- Import behavior that misclassifies dangerous tools or permissions.
- Catalog or registry bundle output that can inject executable script or unsafe HTML.
- Update or uninstall behavior that overwrites or deletes user-modified files unexpectedly.
- Third-party content presented without provenance or source license data.

## Registry Content Review

Registry submissions are reviewed as supply-chain content. Maintainers should reject or request changes for agents that:

- Ask coding agents to bypass user confirmation.
- Ask coding agents to ignore project policy or safety checks.
- Request full bash, broad write access, or web access without a narrow need.
- Hide source, provenance, or licensing information.
- Duplicate existing agents in a way that makes routing less predictable.

See [docs/contributing-agents.md](./docs/contributing-agents.md) for the full registry review process.

