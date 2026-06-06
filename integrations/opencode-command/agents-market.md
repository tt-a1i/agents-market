---
description: Recommend and install specialized coding subagent packs with Agents Market
agent: build
---

Use the local `agents-market` CLI to recommend and install specialized coding subagent packs.

Workflow:

1. Inspect the repository briefly so you understand the project type.
2. Run `agents-market recommend --json`.
3. Pick the most relevant pack, or ask the user to choose if the recommendation is ambiguous.
4. If the user provides a registry URL or bundle path, run `agents-market registry lock --registry <source>`.
5. Create a structured install plan with `agents-market plan <pack-id> --target all`.
6. Audit permissions and provenance with `agents-market audit <pack-id> --target all --json`.
7. If the project has `.agents-market/policy.json`, check project policy with `agents-market policy check <pack-id> --target all --json`.
8. Preview changes before writing with `agents-market diff <pack-id> --target all --json`.
9. Explain the target files, permission implications, policy findings, warnings, and source/license status.
10. After user confirmation, run `agents-market install <pack-id> --target all`.
11. Verify install state with `agents-market status` and `agents-market doctor --json`.
12. Summarize installed files, health warnings, and how the user can invoke the new agents.

Safety:

- Always audit and preview before installing.
- Treat policy failures as blockers unless the user explicitly updates the project policy.
- Prefer curated packs.
- Do not use `--force` unless the user explicitly confirms overwriting or removing modified generated files.
