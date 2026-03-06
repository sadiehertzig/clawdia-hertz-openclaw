#!/usr/bin/env bash

TASK=$1

if [ -z "$TASK" ]; then
 echo "Usage: codex-implement.sh <taskfile>"
 exit 1
fi

PROMPT="Read CODEX_RULES.md and $TASK.

1 Produce a plan
2 Implement the plan
3 Make minimal changes
4 Run npm test if available
5 Summarize the changes"

codex exec "$PROMPT"

git diff --stat
