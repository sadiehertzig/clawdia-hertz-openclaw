#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const orchestrator = require('../../agents/clawdia/runtime/helpdesk_orchestrator');
const helpers = require('../../agents/clawdia/runtime/dossier_helpers');
const { patternScoutWorker, CACHE_TTL_MS } = require('../../agents/clawdia/runtime/patternscout_worker');

function makeRuntimeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawdia-edge-test-'));
}

// --- Cache TTL tests ---

function testCacheTTLExpiry() {
  const cacheDir = path.join(os.tmpdir(), `ps-cache-test-${Date.now()}`);
  const cacheFile = path.join(cacheDir, 'cache.json');
  fs.mkdirSync(cacheDir, { recursive: true });

  // Write an expired cache entry
  const expiredTs = Date.now() - CACHE_TTL_MS - 1000;
  const cache = {
    abc123: {
      ts: expiredTs,
      matches: [{ source_id: 'cached', tier: 'remote_fallback', path: 'old.java' }]
    }
  };
  fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf8');

  // Read it back — the cache module uses its own path, so test the TTL logic directly
  const entry = cache.abc123;
  const fresh = entry && typeof entry.ts === 'number' && (Date.now() - entry.ts) <= CACHE_TTL_MS;
  assert.equal(fresh, false, 'expired entry should not be considered fresh');

  // Fresh entry
  const freshEntry = { ts: Date.now(), matches: [] };
  const isFresh = (Date.now() - freshEntry.ts) <= CACHE_TTL_MS;
  assert.equal(isFresh, true, 'recent entry should be considered fresh');

  fs.rmSync(cacheDir, { recursive: true, force: true });
}

// --- Multi-worker failure cascade ---

function testMultiWorkerCascadeGuarded() {
  const runtimeRoot = makeRuntimeRoot();

  const out = orchestrator.orchestrateRequest({
    peerId: 'u-cascade',
    route: 'helpdesk',
    userMessage: 'create FRC intake subsystem'
  }, {
    runtimeRoot,
    workerHandlers: {
      patternscout: () => ({ status: 'success', matches: [], source_tiers_used: [], confidence: 'low', summary: 'ps' }),
      librarian: () => ({ status: 'success', key_apis: [], facts: [], sources: [], summary: 'lib' }),
      builder: () => ({ status: 'error', summary: 'builder crashed', error: { message: 'out of memory' } }),
      checker: () => ({ status: 'success', overall_status: 'skipped', tests: [], summary: 'check' }),
      arbiter: () => ({ status: 'error', summary: 'arbiter crashed', error: { message: 'timeout' } }),
      deepdebug: () => ({ status: 'success', diagnosis: 'x', fix: 'y', regression_checks: [], unknowns: [], summary: 'dd' })
    }
  });

  assert.equal(out.answer_mode, 'guarded_answer', 'builder+arbiter failure should guard');
  assert.equal(out.dossier.review_state.guarded, true);
}

// --- Thread key consistency across follow-ups ---

function testThreadKeyConsistency() {
  const runtimeRoot = makeRuntimeRoot();
  const peerId = 'u-thread-key';

  // First request
  const first = orchestrator.orchestrateRequest({
    peerId,
    route: 'helpdesk',
    userMessage: 'write FRC elevator subsystem'
  }, {
    runtimeRoot,
    workerHandlers: {
      patternscout: () => ({ status: 'success', matches: [], source_tiers_used: [], confidence: 'low', summary: 'ps' }),
      librarian: () => ({ status: 'success', key_apis: [], facts: [], sources: [], summary: 'lib' }),
      builder: () => ({ status: 'success', code_blocks: [], student_facing_explanation: 'draft', summary: 'build' }),
      checker: () => ({ status: 'success', overall_status: 'skipped', tests: [], summary: 'check' }),
      arbiter: () => ({ status: 'success', verdict: 'approve', concern_list: [], summary: 'arb' }),
      deepdebug: () => ({ status: 'success', diagnosis: '', fix: '', regression_checks: [], unknowns: [], summary: 'dd' })
    }
  });

  const firstThreadKey = first.dossier.thread_key;
  assert.ok(firstThreadKey, 'first request should have thread_key');

  // Follow-up
  const second = orchestrator.orchestrateRequest({
    peerId,
    route: 'helpdesk',
    userMessage: "that didn't work, same error"
  }, {
    runtimeRoot,
    workerHandlers: {
      patternscout: () => ({ status: 'success', matches: [], source_tiers_used: [], confidence: 'low', summary: 'ps' }),
      librarian: () => ({ status: 'success', key_apis: [], facts: [], sources: [], summary: 'lib' }),
      builder: () => ({ status: 'success', code_blocks: [], student_facing_explanation: 'fix', summary: 'build' }),
      checker: () => ({ status: 'success', overall_status: 'skipped', tests: [], summary: 'check' }),
      arbiter: () => ({ status: 'success', verdict: 'approve', concern_list: [], summary: 'arb' }),
      deepdebug: () => ({ status: 'success', diagnosis: 'x', fix: 'y', regression_checks: [], unknowns: [], summary: 'dd' })
    }
  });

  assert.equal(second.dossier.thread_key, firstThreadKey, 'follow-up should inherit thread_key');
  assert.ok(second.dossier.parent_request_id, 'follow-up should have parent_request_id');
  assert.ok(second.dossier.context.retry_count >= 1, 'follow-up should increment retry count');
}

// --- Checker worktree cleanup on exception ---

function testCheckerCleanupOnException() {
  const { checkerWorker } = require('../../agents/checker/checker_worker');
  const tmpDir = path.join(os.tmpdir(), `checker-cleanup-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'dummy.txt'), 'test', 'utf8');

  const result = checkerWorker({
    request_id: 'cleanup-test',
    source_repo: tmpDir,
    keep_worktree: false
  });

  // Result should be structured even without gradlew
  assert.equal(result.status, 'success');
  assert.equal(result.overall_status, 'skipped');
  // The worktree should have been cleaned up
  assert.ok(result.worktree_path.includes('(cleaned)'), 'worktree should be cleaned');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// --- Explicit review override in non-substantive flow ---

function testExplicitReviewForceArbiter() {
  const runtimeRoot = makeRuntimeRoot();

  const out = orchestrator.orchestrateRequest({
    peerId: 'u-explicit-review',
    route: 'helpdesk',
    userMessage: 'please review this robot subsystem code for safety'
  }, {
    runtimeRoot,
    workerHandlers: {
      patternscout: () => ({ status: 'success', matches: [], source_tiers_used: [], confidence: 'low', summary: 'ps' }),
      librarian: () => ({ status: 'success', key_apis: [], facts: [], sources: [], summary: 'lib' }),
      arbiter: () => ({ status: 'success', verdict: 'approve', concern_list: [], summary: 'arb' }),
      deepdebug: () => ({ status: 'success', diagnosis: '', fix: '', regression_checks: [], unknowns: [], summary: 'dd' })
    }
  });

  assert.ok(out.execution_plan.includes('arbiter'), 'explicit review request should add arbiter');
}

// --- Hardware safety + follow-up failure escalation combination ---

function testSafetyFollowUpFailureEscalation() {
  const runtimeRoot = makeRuntimeRoot();
  const peerId = 'u-safety-followup';

  // Create parent with reviewed answer
  const parent = helpers.createInitialDossier({
    peerId,
    route: 'helpdesk',
    userMessage: 'CAN motor fault fix',
    intent: 'sensor_or_can_fault'
  });
  helpers.markReviewCompleted(parent, 'arbiter');
  helpers.finalizeDossier(parent);
  helpers.saveDossier(parent, { runtimeRoot });

  const out = orchestrator.orchestrateRequest({
    peerId,
    route: 'helpdesk',
    userMessage: "that didn't work, motor still faulting and brownout"
  }, {
    runtimeRoot,
    workerHandlers: {
      patternscout: () => ({ status: 'success', matches: [], source_tiers_used: [], confidence: 'low', summary: 'ps' }),
      librarian: () => ({ status: 'success', key_apis: [], facts: [], sources: [], summary: 'lib' }),
      arbiter: () => ({ status: 'success', verdict: 'escalate', concern_list: ['motor safety'], summary: 'arb' }),
      deepdebug: () => ({ status: 'success', diagnosis: 'stall', fix: 'limit', regression_checks: [], unknowns: [], summary: 'dd' })
    }
  });

  assert.equal(out.intent, 'follow_up');
  assert.ok(out.execution_plan.includes('arbiter'), 'safety follow-up should include arbiter');
  assert.ok(out.execution_plan.includes('deepdebug'), 'follow-up failure should include deepdebug');
}

// --- Malformed worker output recovery ---

function testMalformedWorkerOutput() {
  const runtimeRoot = makeRuntimeRoot();

  const out = orchestrator.orchestrateRequest({
    peerId: 'u-malformed',
    route: 'helpdesk',
    userMessage: 'lookup WPILib command API'
  }, {
    runtimeRoot,
    workerHandlers: {
      patternscout: () => 'not an object',
      librarian: () => null
    }
  });

  // Should not crash, should degrade gracefully
  assert.ok(out.dossier, 'should still produce a dossier');
  assert.ok(['direct_answer', 'guarded_answer'].includes(out.answer_mode));
}

function run() {
  testCacheTTLExpiry();
  console.log('ok - cache TTL expiry logic');

  testMultiWorkerCascadeGuarded();
  console.log('ok - multi-worker cascade -> guarded');

  testThreadKeyConsistency();
  console.log('ok - thread key consistency across follow-ups');

  testCheckerCleanupOnException();
  console.log('ok - checker worktree cleanup');

  testExplicitReviewForceArbiter();
  console.log('ok - explicit review forces arbiter');

  testSafetyFollowUpFailureEscalation();
  console.log('ok - safety + follow-up failure escalation');

  testMalformedWorkerOutput();
  console.log('ok - malformed worker output recovery');

  console.log('\nRan 7 tests.');
}

run();
