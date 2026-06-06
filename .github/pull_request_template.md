## Summary

- 

## Registry Changes

- Agents changed:
- Packs changed:
- Changelog updated:
- Source/provenance:
- Source license:
- Target support:
- Permission/tool changes:
- Safety and policy notes:

## Verification

```bash
npm run build
node dist/index.js registry lint --registry ./registry --strict --json
node dist/index.js registry review --registry ./registry --summary-json registry-review.json --summary-markdown registry-review.md
node dist/index.js audit <pack-id> --target all --json
node dist/index.js apply <pack-id> --target all --policy-preset balanced --json
npm test
```

## Checklist

- [ ] New or imported agents include provenance and source license when applicable.
- [ ] Imported GitHub agents include source commit and source checksum provenance.
- [ ] User-visible registry changes update `registry/changelog.json`.
- [ ] Agent permissions and tool access are minimal for the task.
- [ ] Packs are focused and include recommendation signals.
- [ ] `registry lint --strict --json` returns `ok: true`.
- [ ] `registry review` JSON or Markdown evidence is attached or summarized.
- [ ] Changed packs have an `audit --json` result in the PR.
- [ ] Install preview was checked with `apply --json` or `diff --json`.
- [ ] Registry Review workflow summary or PR comment matches the evidence above.
