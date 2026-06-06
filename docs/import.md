# Import Agent Templates

Agents Market can normalize third-party Markdown agent templates into the registry schema.

## Supported Sources

Current importer support is intentionally conservative:

- Claude Code-style Markdown agents with YAML frontmatter.
- OpenCode-style Markdown agents with YAML frontmatter.
- Simple YAML fields: strings, comma-separated arrays, bracket arrays, and shallow objects.

Complex YAML features such as anchors, multiline quoted values, and deeply nested objects are not supported yet.

## Import A Markdown Agent

```bash
agents-market import markdown ./code-reviewer.md --target claude --out ./registry/agents
agents-market import markdown ./review.md --target opencode --out ./registry/agents
```

Without `--out`, the normalized JSON is printed to stdout:

```bash
agents-market import markdown ./code-reviewer.md --target claude
```

## Normalization

The importer maps:

- frontmatter `name` or filename -> `id`
- frontmatter `description` -> `description`
- frontmatter `model` -> target-specific model field
- frontmatter `tools` and `permission` -> normalized permission and tools
- body -> `prompt`

The importer infers category and tags from the id and description unless you pass overrides:

```bash
agents-market import markdown ./security-reviewer.md \
  --target claude \
  --category review \
  --tag security review \
  --out ./registry/agents
```

## Import A Directory

Batch import Markdown agents from a third-party template collection:

```bash
agents-market import directory ./community-agents \
  --target claude \
  --out ./registry/agents
```

By default, directory imports scan recursively. Use `--no-recursive` to scan only the top-level directory.

Existing normalized agents are not overwritten unless you pass `--overwrite`.

## Generate A Pack During Import

Create a pack that contains the imported agents:

```bash
agents-market import directory ./community-agents \
  --target claude \
  --out ./registry/agents \
  --pack community-pack \
  --pack-out ./registry/packs \
  --tag imported community
```

The generated pack is a starting point. Review it before publishing: add recommendation signals, split large packs, and remove low-quality or overlapping agents.

## Validate Imported Content

After importing, run:

```bash
agents-market registry lint --registry ./registry
```

Imported single-target agents may produce `partial-target-support` warnings. That is expected until you review and declare support for other targets.

Generated packs may produce `no-recommendation-signals` warnings. Add `recommendedFor.frameworks`, `recommendedFor.languages`, or `recommendedFor.files` before publishing a curated pack.
