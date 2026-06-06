# Privacy

Agents Market is a local CLI for installing and maintaining coding-agent instructions in a repository. It does not include telemetry, analytics, tracking pixels, crash reporting, or background reporting.

## Local Data

The CLI reads local project files only to detect project shape, preview generated files, compare manifest drift, and write requested agent files. It writes state under `.agents-market/` and target-native agent folders such as `.claude/`, `.codex/`, and `.opencode/` only when the user runs commands that create, update, resolve, rollback, or remove generated content.

## Network Access

Agents Market performs network requests only when a command uses an explicit remote source or release path, including:

- Remote registry bundle URLs passed with `--registry`.
- Public key URLs passed with `--public-key`.
- Hosted catalog URLs passed with `catalog verify --url`.
- GitHub repository imports requested with `import repo`.
- GitHub Release assets downloaded by `install.sh`.
- npm or GitHub package downloads performed by `npm` or `npx`.

The bundled registry, local registry directories, local bundle files, local catalog verification, local install previews, and generated-file maintenance commands do not contact an Agents Market service.

## Registry And Contributions

Registry submissions, issue templates, pull requests, and GitHub Actions artifacts are public repository content. Do not submit private credentials, proprietary prompts, private repository paths, customer data, or vulnerability details in public issues or pull requests. Use the private reporting path described in `SECURITY.md` for security-sensitive findings.

## Logs

Machine-readable command output is printed to stdout when `--json` is used. Avoid pasting private project content into public issues unless you have reviewed the output and removed sensitive details.
