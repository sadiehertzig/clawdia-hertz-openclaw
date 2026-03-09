#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const tests = [
  'tests/runtime/test-intent-classifier.js',
  'tests/runtime/test-dossier-helpers.js',
  'tests/runtime/test-worker-adapters.js',
  'tests/runtime/test-helpdesk-orchestrator.js',
  'tests/runtime/smoke-helpdesk.js'
];

let failed = 0;

for (const test of tests) {
  const proc = spawnSync('node', [test], { stdio: 'inherit' });
  if (proc.status === 0) {
    console.log(`PASS ${test}`);
  } else {
    console.log(`FAIL ${test}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`Phase 1 runner failed: ${failed} test file(s)`);
  process.exit(1);
}

console.log('Phase 1 runner passed.');
