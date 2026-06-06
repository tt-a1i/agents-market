# Project Policy

Agents Market can enforce a project-level policy before a pack is installed. This helps teams use a hosted registry without relying only on manual review.

## Create A Policy

```bash
agents-market policy init
agents-market policy init --preset strict
agents-market policy init --preset balanced --dry-run --json
```

This writes `.agents-market/policy.json`.

Available presets:

| Preset | Max permission | Full bash | Web | Typical use |
| --- | --- | --- | --- | --- |
| `open` | `command` | allowed | allowed | personal projects and broad experiments |
| `balanced` | `command` | blocked | allowed | default team policy for curated packs |
| `strict` | `safe-write` | blocked | blocked | CI, regulated projects, or minimal tool access |

## Check A Pack

```bash
agents-market policy check starter-dev-pack --target all
agents-market policy check starter-dev-pack --target all --json
agents-market policy check frontend-pack --target claude --registry https://example.com/registry.bundle.json
```

`policy check` exits with a non-zero status when the pack violates policy, so it can be used in CI or agent-native install workflows.

## Enforce During Install

Use `install --enforce-policy` to make the install command itself read `.agents-market/policy.json` and block before writing files when a pack violates policy:

```bash
agents-market install starter-dev-pack --target all --dry-run --enforce-policy --json
agents-market install starter-dev-pack --target all --enforce-policy
```

You can also enforce a specific file or built-in preset:

```bash
agents-market install frontend-pack --target all --policy ./.agents-market/policy.json
agents-market install frontend-pack --target all --policy-preset strict --dry-run --json
```

Policy enforcement is explicit, so existing personal workflows keep working unless they opt into a policy gate.

## Policy Fields

```json
{
  "schemaVersion": 1,
  "maxPermission": "command",
  "allowFullBash": false,
  "allowWeb": true,
  "allowedTargets": ["claude", "codex", "opencode"],
  "blockedAgents": [],
  "blockedPacks": []
}
```

- `maxPermission`: highest allowed agent permission, ordered as `readonly`, `safe-write`, `write`, `command`.
- `allowFullBash`: blocks agents that request unrestricted bash.
- `allowWeb`: blocks agents that request web access.
- `allowedTargets`: blocks installation plans for unsupported local agent tools.
- `blockedAgents`: explicit denylist for individual agent IDs.
- `blockedPacks`: explicit denylist for pack IDs.

## Recommended Flow

```bash
agents-market registry lock --registry https://tt-a1i.github.io/agents-market/registry.bundle.json
agents-market policy init --preset balanced
agents-market audit frontend-pack --target all --json
agents-market policy check frontend-pack --target all --json
agents-market diff frontend-pack --target all --json
agents-market install frontend-pack --target all --enforce-policy
```

Treat policy failures as blockers. If a team intentionally wants a broader pack, update `.agents-market/policy.json` in review instead of bypassing the check ad hoc.
