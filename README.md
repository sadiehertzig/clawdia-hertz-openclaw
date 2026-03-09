# Codex Workflow

This repository contains the GatorBots help desk runtime integration.

Run planning only:

```bash
./scripts/codex-plan.sh docs/audits/test_task.md
```

Run plan + implementation:

```bash
./scripts/codex-implement.sh docs/audits/test_task.md
```

`scripts/codex-implement.sh` now creates a runtime dossier at start and updates it again with the run result.

Self-improvement utilities:

```bash
node scripts/validate-helpdesk-runtime.js
node scripts/validate-patternscout-improvements.js
node scripts/helpdesk-nightly-digest.js
node scripts/label-dossier-outcome.js <request_id> <worked|partially_worked|failed|unsafe>
node scripts/patternscout-learn.js
node scripts/patternscout-build-cards.js
```
