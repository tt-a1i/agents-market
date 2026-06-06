## Summary

- 

## Registry Changes

- Agents changed:
- Packs changed:
- Changelog updated:
- Source/provenance:
- Source license:

## Verification

```bash
npm run build
node dist/index.js registry lint --registry ./registry --strict --json
node dist/index.js audit <pack-id> --target all --json
node dist/index.js apply <pack-id> --target all --policy-preset balanced --json
npm test
```

## Checklist

- [ ] New or imported agents include provenance and source license when applicable.
- [ ] User-visible registry changes update `registry/changelog.json`.
- [ ] Agent permissions and tool access are minimal for the task.
- [ ] Packs are focused and include recommendation signals.
- [ ] `registry lint --strict --json` returns `ok: true`.
- [ ] Changed packs have an `audit --json` result in the PR.
- [ ] Install preview was checked with `apply --json` or `diff --json`.
