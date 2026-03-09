#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const adapters = require('../../agents/clawdia/runtime/worker_adapters');

function testPatternScoutLegacyShape() {
  const out = adapters.adaptWorkerOutput('patternscout', {
    best_fit_pattern: { repo: 'org/repo', path: 'A.java', why: 'good' },
    alternative_pattern: { repo: 'org/alt', path: 'B.java', tradeoffs: 'more complexity' }
  }, 'req_1');

  assert.equal(out.status, 'success');
  assert.equal(Array.isArray(out.matches), true);
  assert.equal(out.matches.length, 2);
  assert.equal(out.contract_flags.pattern_only, true);
  assert.equal(out.contract_flags.implementation_safe, false);
}

function testLibrarianContractFlags() {
  const out = adapters.adaptWorkerOutput('librarian', {
    summary: 'docs lookup',
    key_apis: [],
    facts: [],
    sources: []
  }, 'req_lib');

  assert.equal(out.contract_flags.pattern_only, true);
  assert.equal(out.contract_flags.implementation_safe, false);
}

function testBuilderNeverReviewed() {
  const out = adapters.adaptWorkerOutput('builder', {
    summary: 'draft complete',
    contract_flags: { reviewed: true },
    code_blocks: [{ path: 'A.java', code: 'class A {}' }]
  }, 'req_2');

  assert.equal(out.contract_flags.reviewed, false);
  assert.equal(out.kind, 'draft');
}

function testArbiterVerdictNormalize() {
  const out = adapters.adaptWorkerOutput('arbiter', {
    verdict: 'escalate',
    concern_list: ['safety']
  }, 'req_3');

  assert.equal(out.contract_flags.escalated, true);
  assert.equal(out.contract_flags.reviewed, false);
  assert.equal(out.verdict, 'escalate');
}

function testDeepDebugLegacyRootCause() {
  const out = adapters.adaptWorkerOutput('deepdebug', {
    root_cause: 'race condition',
    recommended_fix: 'serialize access'
  }, 'req_4');

  assert.equal(out.diagnosis, 'race condition');
  assert.equal(out.fix, 'serialize access');
}

function run() {
  testPatternScoutLegacyShape();
  console.log('ok - patternscout legacy adapter');

  testLibrarianContractFlags();
  console.log('ok - librarian contract flags');

  testBuilderNeverReviewed();
  console.log('ok - builder review guard');

  testArbiterVerdictNormalize();
  console.log('ok - arbiter verdict normalization');

  testDeepDebugLegacyRootCause();
  console.log('ok - deepdebug legacy normalization');

  console.log('\nRan 5 tests.');
}

run();
