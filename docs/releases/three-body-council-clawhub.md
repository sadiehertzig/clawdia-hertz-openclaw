# Three-Body Council ClawHub Release Guide

This guide covers preflight validation and publish handoff for `agents/clawdia/skills/three-body-council`.

## Scope

- Skill package: `agents/clawdia/skills/three-body-council`
- Runtime integration touched by this skill rollout:
  - `agents/clawdia/runtime/intent_classifier.js`
  - `agents/clawdia/runtime/helpdesk_orchestrator.js`
  - `agents/clawdia/runtime/gatorbots_helpdesk_runtime.js`
- Regression validations:
  - `scripts/validate-three-body-council.js`
  - `scripts/validate-helpdesk-runtime.js`
  - `scripts/validate-patternscout-improvements.js`

## One-Command Preflight

Run:

```bash
./scripts/preflight-three-body-council-release.sh
```

The script executes:

1. Runtime/regression validation suites
2. Python compile check for `three_body_council.py`
3. Skill schema/frontmatter validation via `quick_validate.py`
4. Required-file presence checks

## Manual Publish Checklist

1. Confirm the working tree is clean except intended release files.
2. Run `./scripts/preflight-three-body-council-release.sh`.
3. Publish from `agents/clawdia/skills/three-body-council` with your standard ClawHub CLI publish command.
4. Capture and store publish metadata (owner/slug/version/published timestamp).
5. If publish created metadata files (`_meta.json`, `.clawhub/origin.json`), commit them with the release.

## Post-Publish Smoke Checks

1. Install from ClawHub into a clean environment.
2. Trigger the skill via natural-language prompt and verify response formatting.
3. Re-run:

```bash
node scripts/validate-three-body-council.js
node scripts/validate-helpdesk-runtime.js
```

4. Verify no routing regression for non-FRC prompts (`general_or_non_frc` path).
