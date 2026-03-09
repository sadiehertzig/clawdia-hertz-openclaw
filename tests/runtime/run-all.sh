#!/usr/bin/env bash
set -euo pipefail

node tests/runtime/test-intent-classifier.js
node tests/runtime/test-dossier-helpers.js
node tests/runtime/test-worker-adapters.js
node tests/runtime/test-patternscout-worker.js
node tests/runtime/test-checker-worker.js
node tests/runtime/test-checker-materialization.js
node tests/runtime/test-librarian-worker.js
node tests/runtime/test-builder-worker.js
node tests/runtime/test-arbiter-worker.js
node tests/runtime/test-deepdebug-worker.js
node tests/runtime/test-helpdesk-orchestrator.js
node tests/runtime/test-edge-cases.js
node tests/runtime/smoke-helpdesk.js
node tests/runtime/test-e2e-real-workers.js
