#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const tests = [
  'tests/runtime/test-patternscout-worker.js',
  'tests/runtime/test-checker-worker.js',
  'tests/runtime/test-checker-materialization.js',
  'tests/runtime/test-edge-cases.js',
  'tests/runtime/test-e2e-real-workers.js'
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
  console.error(`Phase 2 runner failed: ${failed} test file(s)`);
  process.exit(1);
}

console.log('Phase 2 runner passed.');
