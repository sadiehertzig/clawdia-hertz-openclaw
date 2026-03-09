#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtime = require('../agents/clawdia/runtime/gatorbots_helpdesk_runtime');
const { generateNightlyDigest } = require('./helpdesk-nightly-digest');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function workerHandlers() {
  return {
    patternscout: () => ({
      status: 'success',
      summary: 'patternscout mock hit',
      matches: [
        {
          tier: 'docs_memory',
          source_id: 'memory/wpilib-command-based.md',
          path: 'memory/wpilib-command-based.md',
          symbol: 'SubsystemBase'
        }
      ],
      source_tiers_used: ['docs_memory'],
      confidence: 'medium'
    }),
    librarian: () => ({
      status: 'success',
      summary: 'librarian mock hit',
      key_apis: ['SubsystemBase', 'Command'],
      facts: ['Use SubsystemBase for subsystem logic.', 'Use Command for stateful operations.'],
      sources: [{ path: 'memory/wpilib/command-based.md', score: 0.8 }]
    }),
    builder: () => ({
      status: 'success',
      summary: 'builder mock draft',
      student_facing_explanation: 'Draft command-based intake subsystem with clear lifecycle methods and safe motor defaults.',
      code_blocks: [{ language: 'java', path: 'src/main/java/frc/robot/subsystems/IntakeSubsystem.java', code: 'class IntakeSubsystem {}' }]
    }),
    checker: () => ({
      status: 'success',
      summary: 'checker mock passed',
      overall_status: 'passed',
      tests: []
    }),
    arbiter: () => ({
      status: 'success',
      summary: 'arbiter approve',
      verdict: 'approve',
      concern_list: []
    }),
    deepdebug: () => ({
      status: 'success',
      summary: 'deepdebug noop',
      diagnosis: 'none',
      fix: 'none',
      regression_checks: [],
      unknowns: []
    })
  };
}

function assertFileExists(filePath) {
  assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
}

function run() {
  const runtimeRoot = makeTempDir('clawdia-validate-runtime-');
  const outDir = makeTempDir('clawdia-validate-reports-');
  const reportPath = path.join(outDir, 'helpdesk-nightly-digest.md');
  const backlogPath = path.join(outDir, 'helpdesk-regression-backlog.md');
  const failureDir = path.join(outDir, 'failures');

  const substantive = runtime.orchestrateRequest({
    peerId: 'validate-peer',
    route: 'helpdesk',
    userMessage: 'Write intake subsystem with TalonFX and beam break safety'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  assert.equal(Array.isArray(substantive.execution_plan), true);
  assert.equal(substantive.execution_plan.includes('coach_evaluator'), true);
  assert.equal(Array.isArray(substantive.dossier.worker_trace), true);
  assert.equal(substantive.dossier.worker_trace.some((x) => x.worker === 'coach_evaluator'), true);
  assert.equal(typeof substantive.dossier.worker_outputs.coach_evaluator, 'object');
  assert.equal(typeof substantive.dossier.self_improvement, 'object');
  assert.equal(typeof substantive.dossier.self_improvement.quality_evaluation, 'object');
  assert.equal(typeof substantive.dossier.self_improvement.telemetry, 'object');
  assert.equal(substantive.dossier.self_improvement.telemetry.worker_count >= 1, true);
  console.log('ok - substantive flow includes evaluator + telemetry');

  const general = runtime.orchestrateRequest({
    peerId: 'validate-peer-general',
    route: 'helpdesk',
    userMessage: 'tell me a robot joke'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  assert.equal(general.intent, 'general_or_non_frc');
  assert.equal(general.execution_plan.includes('coach_evaluator'), true);
  assert.equal(general.dossier.self_improvement.outcome.label, 'unknown');
  console.log('ok - direct path still records evaluator + default outcome');

  const parent = runtime.orchestrateRequest({
    peerId: 'validate-followup-peer',
    route: 'helpdesk',
    userMessage: 'Help me write a shooter command'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  const child = runtime.orchestrateRequest({
    peerId: 'validate-followup-peer',
    route: 'helpdesk',
    userMessage: "that didn't work, still failing on deployment"
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  assert.equal(child.intent, 'follow_up');
  const reloadedParent = runtime.loadRequestDossier(parent.dossier.session_id, parent.dossier.request_id, { runtimeRoot });
  assert.equal(reloadedParent?.self_improvement?.outcome?.label, 'failed');
  assert.equal(reloadedParent?.self_improvement?.outcome?.source, 'follow_up_inference');
  console.log('ok - follow-up failure auto-labels parent outcome');

  const groupParent = runtime.orchestrateRequest({
    peerId: 'validate-group-peer-a',
    route: 'helpdesk',
    chatId: '-100gatorbots',
    threadOrTopicId: '42',
    userMessage: 'Need help with drivetrain brownout issue'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  const groupChild = runtime.orchestrateRequest({
    peerId: 'validate-group-peer-b',
    route: 'helpdesk',
    chatId: '-100gatorbots',
    threadOrTopicId: '42',
    userMessage: 'still failing after trying that fix'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  assert.equal(groupChild.intent, 'follow_up');
  assert.equal(groupChild.dossier.parent_request_id, groupParent.dossier.request_id);
  assert.equal(groupChild.dossier.chat_id, '-100gatorbots');
  assert.equal(groupChild.dossier.thread_or_topic_id, '42');
  console.log('ok - cross-user follow-up links by chat/topic context');

  const explicitParentAcrossSessions = runtime.orchestrateRequest({
    peerId: 'validate-group-peer-c',
    route: 'helpdesk',
    chatId: '-100gatorbots',
    threadOrTopicId: '42',
    conversationContext: {
      parent_request_id: groupParent.dossier.request_id
    },
    userMessage: 'Can you explain why that previous fix did not stick?'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  assert.equal(explicitParentAcrossSessions.dossier.parent_request_id, groupParent.dossier.request_id);
  assert.equal(explicitParentAcrossSessions.dossier.context.parent_intent, groupParent.intent);
  console.log('ok - explicit parent_request_id resolves across peer sessions');

  const labeled = runtime.updateOutcomeLabel(child.dossier.request_id, 'worked', {
    source: 'manual',
    note: 'Verified manually in validation script',
    runtimeRoot
  });
  assert.equal(labeled?.self_improvement?.outcome?.label, 'worked');
  assert.equal(labeled?.self_improvement?.outcome?.source, 'manual');
  console.log('ok - manual outcome labeling updates dossier');

  const digest = generateNightlyDigest({
    runtimeRoot,
    reportPath,
    backlogPath,
    failureDir,
    lookbackHours: 72,
    maxFailures: 10
  });

  assert.equal(digest.summary.totalRequests >= 4, true);
  assert.equal(typeof digest.summary.failureCount, 'number');
  assert.equal(typeof digest.summary.patternscoutLearning, 'object');
  assertFileExists(reportPath);
  assertFileExists(backlogPath);
  assert.equal(Array.isArray(digest.failureFiles), true);
  console.log('ok - nightly digest + backlog generation');

  console.log('\nValidation suite passed.');
}

run();
