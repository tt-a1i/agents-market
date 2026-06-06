# Support

Agents Market is maintained through GitHub. Choose the path that matches the type of request so maintainers can route it quickly.

## Usage Questions

Open a GitHub discussion or issue for questions about:

- Choosing a pack.
- Installing generated agents into Claude Code, Codex, or OpenCode.
- Understanding `recommend`, `plan`, `apply`, `status`, `update`, `rollback`, or `doctor` output.
- Verifying a hosted registry, catalog, release artifact, or signed registry lock.

Include the command, CLI version, target tool, registry source, and sanitized output. Use `--json` output when it helps, but review it before posting.

## Agent And Pack Proposals

Use the "Agent or pack submission" issue form for proposals that are not ready as pull requests. Registry proposals should include the use case, target tools, source/license data for third-party content, expected permissions, safety notes, and validation evidence.

For pull requests, follow `docs/contributing-agents.md` and keep the pull request template filled in. Registry changes should include strict lint, registry review, audit, and apply-preview evidence.

## Bugs

Use the bug report issue form for reproducible CLI, registry, catalog, or adapter defects. Include:

- Exact command and version.
- Operating system and Node.js version.
- Target tool: Claude Code, Codex, OpenCode, or all.
- Registry source: bundled, local directory, bundle file, or URL.
- Minimal reproduction steps.

## Security Reports

Do not open a public issue for vulnerabilities, policy bypasses, unsafe generated files, or registry supply-chain risks. Use GitHub private vulnerability reporting or the private path described in `SECURITY.md`.

## Privacy

Agents Market has no telemetry or analytics. See `PRIVACY.md` for local file and network access boundaries before sharing command output publicly.

## Release And npm Issues

For release artifact, attestation, GitHub Pages catalog, or npm package issues, include the release tag, artifact name, checksum or attestation command, and the exact install or verify command that failed.
