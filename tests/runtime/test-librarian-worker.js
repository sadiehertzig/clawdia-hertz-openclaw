#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const { librarianWorker, tokenize } = require('../../agents/librarian/librarian_worker');

function testTokenize() {
  const tokens = tokenize('TalonFX CAN bus motor controller');
  assert.ok(tokens.includes('talonfx'));
  assert.ok(tokens.includes('bus'));
  assert.ok(tokens.includes('motor'));
  assert.ok(tokens.includes('controller'));
  // 'can' is only 3 chars, should be included
  assert.ok(tokens.includes('can'));
}

function testLocalDocsHit() {
  const result = librarianWorker({
    request_id: 'test-lib-1',
    user_message: 'How do I configure a TalonFX motor with Phoenix 6?'
  });

  assert.equal(result.status, 'success');
  assert.equal(result.kind, 'docs_truth');
  assert.ok(Array.isArray(result.key_apis));
  assert.ok(Array.isArray(result.facts));
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.sources.length > 0, 'should find at least one doc source for Phoenix/TalonFX');
  assert.equal(result.contract_flags.reviewed, false);
}

function testEmptyQuery() {
  const result = librarianWorker({
    request_id: 'test-lib-2',
    user_message: ''
  });

  assert.equal(result.status, 'success');
  assert.ok(result.warnings.length > 0);
  assert.deepEqual(result.key_apis, []);
  assert.deepEqual(result.facts, []);
}

function testNoMatchQuery() {
  const result = librarianWorker({
    request_id: 'test-lib-3',
    user_message: 'zxqwrtyp vbnmlkj xyzabc123'
  });

  assert.equal(result.status, 'success');
  assert.equal(result.sources.length, 0, 'truly nonsensical query should find no sources');
}

function testWpilibDocsHit() {
  const result = librarianWorker({
    request_id: 'test-lib-4',
    user_message: 'How does the command-based scheduler work in WPILib?'
  });

  assert.equal(result.status, 'success');
  assert.ok(result.sources.length > 0, 'should find WPILib command-based docs');
}

function run() {
  testTokenize();
  console.log('ok - tokenize');

  testLocalDocsHit();
  console.log('ok - local docs hit for Phoenix/TalonFX');

  testEmptyQuery();
  console.log('ok - empty query handled');

  testNoMatchQuery();
  console.log('ok - no-match query returns empty');

  testWpilibDocsHit();
  console.log('ok - wpilib docs hit');

  console.log('\nRan 5 tests.');
}

run();
