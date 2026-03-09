#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const { deepdebugWorker, matchKnownPatterns, KNOWN_FAILURE_PATTERNS } = require('../../agents/deepdebug/deepdebug_worker');

function testCanBusMatch() {
  const result = deepdebugWorker({
    request_id: 'test-dd-1',
    user_message: 'CAN bus timeout on TalonFX device not found',
    intent: 'deep_debug'
  });

  assert.equal(result.status, 'success');
  assert.equal(result.kind, 'escalation');
  assert.ok(result.diagnosis.includes('CAN bus'));
  assert.ok(result.fix.length > 0);
  assert.ok(result.regression_checks.length > 0);
  assert.ok(result.matched_patterns.includes('can_bus_timeout'));
  assert.equal(result.contract_flags.escalated, true);
  assert.equal(result.contract_flags.reviewed, false);
}

function testVendorDepMatch() {
  const result = deepdebugWorker({
    request_id: 'test-dd-2',
    user_message: 'vendor dependency version mismatch after WPILib update',
    intent: 'build_deploy_error'
  });

  assert.ok(result.matched_patterns.includes('deploy_vendor_mismatch'));
  assert.ok(result.fix.includes('vendordeps'));
}

function testPoseDriftMatch() {
  const result = deepdebugWorker({
    request_id: 'test-dd-3',
    user_message: 'odometry drift during autonomous, gyro seems off',
    intent: 'deep_debug'
  });

  assert.ok(result.matched_patterns.includes('pose_drift'));
  assert.ok(result.regression_checks.length > 0);
}

function testNoPatternMatch() {
  const result = deepdebugWorker({
    request_id: 'test-dd-4',
    user_message: 'something weird happening with unrelated stuff',
    intent: 'deep_debug'
  });

  assert.equal(result.status, 'success');
  assert.ok(result.unknowns.length > 0, 'should list unknowns when no pattern matches');
  assert.ok(result.warnings.length > 0);
  assert.ok(result.diagnosis.includes('Unable to match'));
}

function testRetryCountInDiagnosis() {
  const result = deepdebugWorker({
    request_id: 'test-dd-5',
    user_message: 'CAN bus timeout still happening',
    intent: 'deep_debug',
    dossier: {
      context: { retry_count: 2, prior_evidence: [] }
    }
  });

  assert.ok(result.diagnosis.includes('attempt 3'));
}

function testPriorEvidenceUsed() {
  const matches = matchKnownPatterns(
    'still broken',
    [{ summary: 'CAN bus error on motor controller' }]
  );

  assert.ok(matches.length > 0, 'should match via prior evidence');
  assert.ok(matches.some((m) => m.id === 'can_bus_timeout'));
}

function testMultiplePatterns() {
  const result = deepdebugWorker({
    request_id: 'test-dd-6',
    user_message: 'PID oscillation and motor stall current spike brownout',
    intent: 'deep_debug'
  });

  assert.ok(result.matched_patterns.length >= 2, 'should match multiple patterns');
  assert.ok(result.unknowns.some((u) => u.includes('Multiple failure patterns')));
}

function run() {
  testCanBusMatch();
  console.log('ok - CAN bus pattern match');

  testVendorDepMatch();
  console.log('ok - vendor dep pattern match');

  testPoseDriftMatch();
  console.log('ok - pose drift pattern match');

  testNoPatternMatch();
  console.log('ok - no pattern fallback');

  testRetryCountInDiagnosis();
  console.log('ok - retry count in diagnosis');

  testPriorEvidenceUsed();
  console.log('ok - prior evidence influences matching');

  testMultiplePatterns();
  console.log('ok - multiple pattern detection');

  console.log('\nRan 7 tests.');
}

run();
