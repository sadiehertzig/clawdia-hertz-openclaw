# College App Essay Coach ClawHub Release Guide

Skill path: `agents/clawdia/skills/college-essay`

## Automated Validation

Run:

```bash
./scripts/preflight-college-essay-coach-release.sh
```

This validates:

1. README attribution to Sadie Hertzig
2. Coverage of all documented coaching/refusal capabilities in `SKILL.md`
3. Red-team matrix presence in `README.md`
4. Frontmatter/schema compatibility via `quick_validate.py`

## Publish Flow

1. Ensure the working tree is clean except intended release files.
2. Run `./scripts/preflight-college-essay-coach-release.sh`.
3. Publish from `agents/clawdia/skills/college-essay` with your ClawHub CLI command.
4. If publish generates metadata (`_meta.json`, `.clawhub/origin.json`), commit those files with the release.
