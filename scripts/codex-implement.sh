#!/usr/bin/env bash
set -euo pipefail

TASK="${1:-}"

if [ -z "$TASK" ]; then
  echo "Usage: codex-implement.sh <taskfile>"
  exit 1
fi

if [ ! -f "$TASK" ]; then
  echo "Error: task file not found: $TASK"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TASK_CONTENT="$(cat "$TASK")"

RUNTIME_JS="$REPO_ROOT/agents/clawdia/runtime/gatorbots_helpdesk_runtime.js"

DOSSIER_INFO="$(node - <<'NODE' "$RUNTIME_JS" "$TASK_CONTENT"
const runtimePath = process.argv[2];
const userMessage = process.argv[3];

const runtime = require(runtimePath);

const dossier = runtime.createInitialDossier({
  peerId: "codex-implement",
  route: "codegen",
  userMessage
});

runtime.saveDossier(dossier);

process.stdout.write(JSON.stringify({
  session_id: dossier.session_id,
  request_id: dossier.request_id
}));
NODE
)"

SESSION_ID="$(printf '%s' "$DOSSIER_INFO" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(data.session_id);')"
REQUEST_ID="$(printf '%s' "$DOSSIER_INFO" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(data.request_id);')"

PROMPT="Read CODEX_RULES.md and $TASK.

1 Produce a plan
2 Implement the plan
3 Make minimal changes
4 Run validation if possible
5 Summarize the changes
"

set +e
codex exec "$PROMPT"
CODEX_EXIT=$?
set -e

node - <<'NODE' "$RUNTIME_JS" "$SESSION_ID" "$REQUEST_ID" "$CODEX_EXIT"
const runtimePath = process.argv[2];
const sessionId = process.argv[3];
const requestId = process.argv[4];
const exitCode = Number(process.argv[5]);

const runtime = require(runtimePath);

const dossier = runtime.loadRequestDossier(sessionId, requestId);

if (!dossier) {
  throw new Error(`Could not load dossier for session_id=${sessionId} request_id=${requestId}`);
}

const result = runtime.normalizeWorkerResult({
  worker: "builder",
  request_id: requestId,
  defaultKind: "implementation_run",
  raw: {
    status: exitCode === 0 ? "success" : "error",
    kind: "implementation_run",
    summary: exitCode === 0
      ? "codex implementation run completed"
      : "codex implementation run failed",
    reviewed: false,
    escalated: false
  }
});

runtime.recordWorkerResult(dossier, result);
runtime.saveDossier(dossier);
NODE

git diff --stat

exit "$CODEX_EXIT"
