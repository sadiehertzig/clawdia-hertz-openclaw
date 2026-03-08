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
6 End your final response with exactly one of these lines:
FINAL_STATUS: success
or
FINAL_STATUS: failure

Use FINAL_STATUS: failure if the engineering task was not actually completed, even if you handled the situation cleanly.
"

CODEX_LOG="$(mktemp)"

set +e
codex exec "$PROMPT" 2>&1 | tee "$CODEX_LOG"
CODEX_EXIT=${PIPESTATUS[0]}
set -e

set +e
node - <<'NODE' "$RUNTIME_JS" "$SESSION_ID" "$REQUEST_ID" "$CODEX_EXIT" "$CODEX_LOG"
const fs = require("fs");

const runtimePath = process.argv[2];
const sessionId = process.argv[3];
const requestId = process.argv[4];
const exitCode = Number(process.argv[5]);
const logPath = process.argv[6];

const runtime = require(runtimePath);

const dossier = runtime.loadRequestDossier(sessionId, requestId);

if (!dossier) {
  throw new Error(`Could not load dossier for session_id=${sessionId} request_id=${requestId}`);
}

let semanticStatus = "success";
let summary = "codex implementation run completed";

if (exitCode !== 0) {
  semanticStatus = "error";
  summary = "codex implementation run failed";
} else {
  const logText = fs.readFileSync(logPath, "utf8");

  if (/FINAL_STATUS:\s*failure/i.test(logText)) {
    semanticStatus = "error";
    summary = "codex implementation run completed but reported task failure";
  } else if (/FINAL_STATUS:\s*success/i.test(logText)) {
    semanticStatus = "success";
    summary = "codex implementation run completed";
  } else {
    semanticStatus = "error";
    summary = "codex implementation run completed without a final status marker";
  }
}

const result = runtime.normalizeWorkerResult({
  worker: "builder",
  request_id: requestId,
  defaultKind: "implementation_run",
  raw: {
    status: semanticStatus,
    kind: "implementation_run",
    summary,
    reviewed: false,
    escalated: false
  }
});

runtime.recordWorkerResult(dossier, result);
runtime.saveDossier(dossier);
NODE
DOSSIER_RECORD_EXIT=$?
set -e

rm -f "$CODEX_LOG"

if [ "$DOSSIER_RECORD_EXIT" -ne 0 ]; then
  echo "Warning: failed to record dossier result, preserving original Codex exit code $CODEX_EXIT" >&2
fi

git diff --stat

exit "$CODEX_EXIT"
