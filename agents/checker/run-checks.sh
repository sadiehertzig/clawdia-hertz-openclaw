#!/usr/bin/env bash
set -euo pipefail

REQUEST_ID="${1:-manual_check}"
SOURCE_REPO="${2:-$(pwd)}"

node - <<'NODE' "$REQUEST_ID" "$SOURCE_REPO"
const { checkerWorker } = require('./agents/checker/checker_worker');
const requestId = process.argv[2];
const sourceRepo = process.argv[3];
const result = checkerWorker({ request_id: requestId, source_repo: sourceRepo, keep_worktree: false });
process.stdout.write(JSON.stringify(result, null, 2));
NODE
