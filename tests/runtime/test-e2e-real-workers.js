#!/usr/bin/env node
'use strict';

/**
 * End-to-end integration test — uses REAL worker implementations
 * (not mocked handlers) to validate the full orchestration pipeline.
 */

const assert = require('assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const orchestrator = require('../../agents/clawdia/runtime/helpdesk_orchestrator');
const helpers = require('../../agents/clawdia/runtime/dossier_helpers');

function makeRuntimeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawdia-e2e-test-'));
}

function assertValidDossier(dossier) {
  assert.ok(dossier.request_id, 'dossier must have request_id');
  assert.ok(dossier.session_id, 'dossier must have session_id');
  assert.ok(dossier.intent, 'dossier must have intent');
  assert.ok(dossier.answer_mode, 'dossier must have answer_mode');
  assert.ok(dossier.timestamps.created_at, 'dossier must have created_at');
  assert.ok(dossier.human_dossier_note, 'dossier must have human note');
  assert.ok(Array.isArray(dossier.worker_trace), 'dossier must have worker_trace array');
}

function assertValidMode(mode) {
  assert.ok(
    ['direct_answer', 'reviewed_answer', 'escalated_answer', 'guarded_answer'].includes(mode),
    `invalid answer mode: ${mode}`
  );
}

// --- Test 1: Non-FRC chat flows through with no workers ---

function testNonFrcDirectPath() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-nonfrc',
    route: 'helpdesk',
    userMessage: 'Tell me a joke about cats'
  }, { runtimeRoot });

  assert.equal(out.intent, 'general_or_non_frc');
  assert.equal(out.answer_mode, 'direct_answer');
  assert.equal(out.execution_plan.length, 0);
  assert.equal(out.status_markers.includes('[direct]'), true);
  assert.equal(typeof out.final_message, 'string');
  assertValidDossier(out.dossier);
}

// --- Test 2: Subsystem draft goes through full pipeline ---

function testSubsystemFullPipeline() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-subsystem',
    route: 'helpdesk',
    userMessage: 'Write a command-based intake subsystem for our FRC robot'
  }, { runtimeRoot });

  assert.ok(['subsystem_or_command_draft', 'build_deploy_error'].includes(out.intent) ||
    out.execution_plan.includes('builder'),
    'subsystem request should be classified as code-generating intent');
  assert.ok(out.execution_plan.includes('patternscout'), 'should include patternscout');
  assert.ok(out.execution_plan.includes('librarian'), 'should include librarian');
  assert.ok(out.execution_plan.includes('builder'), 'should include builder');
  assert.ok(out.execution_plan.includes('arbiter'), 'should include arbiter');

  assertValidMode(out.answer_mode);
  assertValidDossier(out.dossier);
  assert.equal(Array.isArray(out.status_markers), true);
  assert.equal(out.status_markers.some((m) => m.startsWith('[checks ')), true);
  assert.equal(typeof out.final_message, 'string');

  // Builder should have produced code
  const builderOut = out.dossier.worker_outputs.builder;
  assert.ok(builderOut, 'builder output should exist');
  assert.ok(builderOut.code_blocks || builderOut.raw?.code_blocks, 'builder should produce code blocks');

  // Arbiter should have reviewed
  const arbiterOut = out.dossier.worker_outputs.arbiter;
  assert.ok(arbiterOut, 'arbiter output should exist');
  assert.ok(['approve', 'revise', 'escalate'].includes(arbiterOut.verdict), 'arbiter should have a verdict');
}

// --- Test 3: API docs lookup is lighter pipeline ---

function testDocsLookup() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-docs',
    route: 'helpdesk',
    userMessage: 'What is the TalonFX constructor signature in Phoenix 6?'
  }, { runtimeRoot });

  assertValidMode(out.answer_mode);
  assertValidDossier(out.dossier);

  // Librarian should have been called
  const libOut = out.dossier.worker_outputs.librarian;
  assert.ok(libOut, 'librarian output should exist');
}

// --- Test 4: Sensor fault routes through arbiter ---

function testSensorFaultFlow() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-sensor',
    route: 'helpdesk',
    userMessage: 'CAN motor controller fault, sensor dropping frames, possible brownout'
  }, { runtimeRoot });

  assert.ok(out.execution_plan.includes('arbiter'), 'sensor fault should include arbiter');
  assertValidMode(out.answer_mode);
  assertValidDossier(out.dossier);
}

// --- Test 5: Deep debug path ---

function testDeepDebugPath() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-deepdebug',
    route: 'helpdesk',
    userMessage: 'Hard bug: root cause unknown, multi-file issue with pose estimator drift and CAN errors'
  }, { runtimeRoot });

  assert.ok(out.execution_plan.includes('deepdebug') || out.intent === 'deep_debug',
    'deep debug query should route to deepdebug');
  assertValidMode(out.answer_mode);
  assertValidDossier(out.dossier);

  if (out.dossier.worker_outputs.deepdebug) {
    const ddOut = out.dossier.worker_outputs.deepdebug;
    assert.ok(ddOut.diagnosis || ddOut.raw?.diagnosis, 'deepdebug should have diagnosis');
  }
}

// --- Test 6: Follow-up inherits parent context ---

function testFollowUpInheritsContext() {
  const runtimeRoot = makeRuntimeRoot();
  const peerId = 'e2e-followup';

  // First request
  const first = orchestrator.orchestrateRequest({
    peerId,
    route: 'helpdesk',
    userMessage: 'Write FRC shooter subsystem with two Falcon motors'
  }, { runtimeRoot });

  assertValidDossier(first.dossier);

  // Follow-up
  const second = orchestrator.orchestrateRequest({
    peerId,
    route: 'helpdesk',
    userMessage: "that didn't work, the motors spin opposite directions"
  }, { runtimeRoot });

  assert.equal(second.intent, 'follow_up');
  assert.ok(second.dossier.parent_request_id, 'should link to parent');
  assert.ok(second.dossier.context.retry_count >= 1, 'retry count should increment');
  assertValidMode(second.answer_mode);
  assertValidDossier(second.dossier);
}

// --- Test 7: Vision problem full flow ---

function testVisionProblemFlow() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-vision',
    route: 'helpdesk',
    userMessage: 'PhotonVision camera not detecting AprilTags, limelight alternative?'
  }, { runtimeRoot });

  assert.ok(out.execution_plan.includes('builder'), 'vision should include builder');
  assert.ok(out.execution_plan.includes('arbiter'), 'vision should include arbiter');
  assertValidMode(out.answer_mode);
  assertValidDossier(out.dossier);
}

// --- Test 8: Worker traces are complete and sensible ---

function testWorkerTracesComplete() {
  const runtimeRoot = makeRuntimeRoot();
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-traces',
    route: 'helpdesk',
    userMessage: 'Create autonomous path with PathPlanner'
  }, { runtimeRoot });

  const trace = out.dossier.worker_trace;
  assert.ok(trace.length > 0, 'should have worker traces');

  for (const entry of trace) {
    assert.ok(entry.worker, 'trace entry must have worker name');
    assert.ok(entry.at, 'trace entry must have timestamp');
    assert.ok(['success', 'error', 'unknown'].includes(entry.status), `trace status should be valid: ${entry.status}`);
    assert.ok(typeof entry.summary === 'string', 'trace summary should be string');
  }

  // All planned workers should have a trace entry
  for (const worker of out.execution_plan) {
    assert.ok(
      trace.some((t) => t.worker === worker),
      `worker ${worker} should have a trace entry`
    );
  }
}

// --- Test 9: Dossier persists and can be loaded ---

function testDossierPersistence() {
  const runtimeRoot = makeRuntimeRoot();
  const peerId = 'e2e-persist';

  const out = orchestrator.orchestrateRequest({
    peerId,
    route: 'helpdesk',
    userMessage: 'Write FRC arm subsystem'
  }, { runtimeRoot });

  const sessionId = out.dossier.session_id;
  const requestId = out.dossier.request_id;

  // Load latest
  const latest = helpers.loadLatestDossier(sessionId, { runtimeRoot });
  assert.ok(latest, 'should be able to load latest dossier');
  assert.equal(latest.request_id, requestId);

  // Load by request ID
  const byId = helpers.loadRequestDossier(sessionId, requestId, { runtimeRoot });
  assert.ok(byId, 'should be able to load by request ID');
  assert.equal(byId.request_id, requestId);
  assert.equal(byId.answer_mode, out.answer_mode);
}

// --- Test 10: Guarded mode appears when expected ---

function testGuardedModeWithRealWorkers() {
  const runtimeRoot = makeRuntimeRoot();

  // Force arbiter unavailable on substantive flow
  const out = orchestrator.orchestrateRequest({
    peerId: 'e2e-guarded',
    route: 'helpdesk',
    userMessage: 'Generate a FRC climber subsystem with two motors'
  }, {
    runtimeRoot,
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
  assert.equal(out.dossier.review_state.guarded, true);
  assert.ok(out.answer_badge.includes('unreviewed'));
  assert.equal(out.status_markers.includes('[⚠️ unreviewed]'), true);
}

function run() {
  testNonFrcDirectPath();
  console.log('ok - e2e non-FRC direct path');

  testSubsystemFullPipeline();
  console.log('ok - e2e subsystem full pipeline');

  testDocsLookup();
  console.log('ok - e2e docs lookup');

  testSensorFaultFlow();
  console.log('ok - e2e sensor fault flow');

  testDeepDebugPath();
  console.log('ok - e2e deep debug path');

  testFollowUpInheritsContext();
  console.log('ok - e2e follow-up inherits context');

  testVisionProblemFlow();
  console.log('ok - e2e vision problem flow');

  testWorkerTracesComplete();
  console.log('ok - e2e worker traces complete');

  testDossierPersistence();
  console.log('ok - e2e dossier persistence');

  testGuardedModeWithRealWorkers();
  console.log('ok - e2e guarded mode');

  console.log('\nEnd-to-end suite passed (10 tests).');
}

run();
