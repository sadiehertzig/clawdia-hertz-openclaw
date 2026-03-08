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
