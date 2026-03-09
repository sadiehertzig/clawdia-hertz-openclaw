#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const orchestrator = require('../../agents/clawdia/runtime/helpdesk_orchestrator');
const helpers = require('../../agents/clawdia/runtime/dossier_helpers');

function makeRuntimeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawdia-orchestrator-test-'));
}

function defaultWorkers() {
  return {
    patternscout: () => ({
      status: 'success',
      kind: 'retrieval',
      summary: 'patternscout ok',
      matches: [{ tier: 'team_local', source_id: 'repo', path: 'A.java', excerpt: 'x' }],
      source_tiers_used: ['team_local'],
      confidence: 'high'
    }),
    librarian: () => ({
      status: 'success',
      summary: 'librarian ok',
      key_apis: [],
      facts: [],
      sources: []
    }),
    builder: () => ({
      status: 'success',
      summary: 'builder ok',
      student_facing_explanation: 'draft',
      code_blocks: [{ path: 'A.java', code: 'class A {}' }],
      facts: []
    }),
    checker: () => ({
      status: 'success',
      summary: 'checker ok',
      overall_status: 'pass',
      tests: [{ name: 'build', result: 'passed' }],
      worktree_path: '/tmp/worktree'
    }),
    arbiter: () => ({
      status: 'success',
      summary: 'arbiter approve',
      verdict: 'approve',
      concern_list: []
    }),
    deepdebug: () => ({
      status: 'success',
      summary: 'deepdebug ok',
      diagnosis: 'x',
      fix: 'y',
      regression_checks: [],
      unknowns: []
    })
  };
}

function testGeneralDirectAnswer() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'u-general',
    route: 'helpdesk',
    userMessage: 'tell me a joke'
  }, {
    runtimeRoot,
    workerHandlers: defaultWorkers()
  });

  assert.equal(out.intent, 'general_or_non_frc');
  assert.equal(out.answer_mode, 'direct_answer');
  assert.equal(out.execution_plan.length, 0);
  assert.equal(Array.isArray(out.status_markers), true);
  assert.equal(out.status_markers.includes('[direct]'), true);
  assert.equal(typeof out.final_message, 'string');
  assert.equal(out.final_message.includes('[direct]'), true);
}

function testSensorRoutesThroughArbiter() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'u-sensor',
    route: 'helpdesk',
    userMessage: 'CAN motor fault and sensor keeps dropping frames'
  }, {
    runtimeRoot,
    workerHandlers: defaultWorkers()
  });

  assert.equal(out.execution_plan.includes('arbiter'), true);
}

function testFollowUpFailureRoutesToDeepDebug() {
  const runtimeRoot = makeRuntimeRoot();
  const peerId = 'u-followup';

  const parent = helpers.createInitialDossier({
    peerId,
    route: 'helpdesk',
    userMessage: 'write subsystem',
    intent: 'subsystem_or_command_draft'
  });
  helpers.markReviewCompleted(parent, 'arbiter');
  helpers.finalizeDossier(parent);
  helpers.saveDossier(parent, { runtimeRoot });

  const out = orchestrator.orchestrateRequest({
    peerId,
    route: 'helpdesk',
    userMessage: "that didn't work, same error"
  }, {
    runtimeRoot,
    workerHandlers: defaultWorkers()
  });

  assert.equal(out.intent, 'follow_up');
  assert.equal(out.execution_plan.includes('arbiter'), true);
  assert.equal(out.execution_plan.includes('deepdebug'), true);
}

function testSkipPatternScoutCheckerGracefully() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'u-skip',
    route: 'helpdesk',
    userMessage: 'create frc intake subsystem'
  }, {
    runtimeRoot,
    workerHandlers: defaultWorkers(),
    availableWorkers: {
      patternscout: false,
      checker: false,
      librarian: true,
      builder: true,
      arbiter: true,
      deepdebug: true
    }
  });

  assert.equal(out.dossier.stage_status.patternscout, 'skipped');
  assert.equal(out.dossier.stage_status.checker, 'skipped');
  assert.notEqual(out.answer_mode, 'guarded_answer');
}

function testArbiterUnavailableGuarded() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'u-guard',
    route: 'helpdesk',
    userMessage: 'create frc shooter command and review this'
  }, {
    runtimeRoot,
    workerHandlers: defaultWorkers(),
    availableWorkers: {
      patternscout: true,
      librarian: true,
      builder: true,
      checker: true,
      arbiter: false,
      deepdebug: true
    }
  });

  assert.equal(out.answer_mode, 'guarded_answer');
}

function testArbiterEscalateAddsDeepDebugOnce() {
  const runtimeRoot = makeRuntimeRoot();
  const workers = defaultWorkers();
  let deepdebugCalls = 0;

  workers.arbiter = () => ({
    status: 'success',
    summary: 'needs escalation',
    verdict: 'escalate',
    concern_list: ['complex failure']
  });
  workers.deepdebug = () => {
    deepdebugCalls += 1;
    return {
      status: 'success',
      summary: 'deepdebug done',
      diagnosis: 'x',
      fix: 'y',
      regression_checks: [],
      unknowns: []
    };
  };

  const out = orchestrator.orchestrateRequest({
    peerId: 'u-escalate',
    route: 'helpdesk',
    userMessage: 'create frc intake subsystem'
  }, {
    runtimeRoot,
    workerHandlers: workers
  });

  assert.equal(deepdebugCalls, 1);
  assert.equal(out.answer_mode, 'escalated_answer');
}

function testBuilderErrorGuarded() {
  const runtimeRoot = makeRuntimeRoot();
  const workers = defaultWorkers();
  workers.builder = () => ({
    status: 'error',
    summary: 'builder failed',
    error: { message: 'tool failed' }
  });

  const out = orchestrator.orchestrateRequest({
    peerId: 'u-builder-fail',
    route: 'helpdesk',
    userMessage: 'generate frc intake subsystem'
  }, {
    runtimeRoot,
    workerHandlers: workers
  });

  assert.equal(out.answer_mode, 'guarded_answer');
}

function testCheckerStatusMarkers() {
  const runtimeRoot = makeRuntimeRoot();
  const workersFailed = defaultWorkers();
  workersFailed.checker = () => ({
    status: 'success',
    summary: 'checker failed',
    overall_status: 'failed',
    tests: [{ name: 'build', result: 'failed' }],
    worktree_path: '/tmp/worktree'
  });

  const failed = orchestrator.orchestrateRequest({
    peerId: 'u-check-failed',
    route: 'helpdesk',
    userMessage: 'write frc intake subsystem'
  }, {
    runtimeRoot,
    workerHandlers: workersFailed
  });

  assert.equal(failed.checker_badge, '[checks failed]');
  assert.equal(failed.status_markers.includes('[checks failed]'), true);

  const workersSkipped = defaultWorkers();
  workersSkipped.checker = () => ({
    status: 'success',
    summary: 'checker skipped',
    overall_status: 'skipped',
    tests: [],
    worktree_path: null
  });

  const skipped = orchestrator.orchestrateRequest({
    peerId: 'u-check-skipped',
    route: 'helpdesk',
    userMessage: 'write frc shooter subsystem'
  }, {
    runtimeRoot,
    workerHandlers: workersSkipped
  });

  assert.equal(skipped.checker_badge, '[checks skipped]');
  assert.equal(skipped.status_markers.includes('[checks skipped]'), true);
}

function run() {
  testGeneralDirectAnswer();
  console.log('ok - general non-frc direct answer');

  testSensorRoutesThroughArbiter();
  console.log('ok - sensor route includes arbiter');

  testFollowUpFailureRoutesToDeepDebug();
  console.log('ok - follow-up failure route');

  testSkipPatternScoutCheckerGracefully();
  console.log('ok - patternscout/checker skip policy');

  testArbiterUnavailableGuarded();
  console.log('ok - arbiter unavailable guarded');

  testArbiterEscalateAddsDeepDebugOnce();
  console.log('ok - arbiter escalate deepdebug once');

  testBuilderErrorGuarded();
  console.log('ok - builder error guarded');

  testCheckerStatusMarkers();
  console.log('ok - checker status markers');

  console.log('\nRan 8 tests.');
}

run();
