#!/usr/bin/env bash

TASK=$1

if [ -z "$TASK" ]; then
 echo "Usage: codex-plan.sh <taskfile>"
 exit 1
fi

PROMPT="Read CODEX_RULES.md and $TASK.

Analyze the repository.

Do NOT modify any files.

Return:
- findings
- implementation plan
- files that would change
"

codex exec "$PROMPT"
