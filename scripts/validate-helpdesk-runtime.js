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

function spawnedWorkerHandlers() {
  return {
    builder: () => ({
      status: 'success',
      summary: 'spawned builder draft',
      spawn_session_id: 'spawn-builder-1',
      student_facing_explanation: 'Spawned builder draft.',
      code_blocks: [{ language: 'java', path: 'src/main/java/frc/robot/subsystems/SpawnedSubsystem.java', code: 'class SpawnedSubsystem {}' }]
    }),
    arbiter: () => ({
      status: 'success',
      summary: 'spawned arbiter approve',
      spawn_session_id: 'spawn-arbiter-1',
      verdict: 'approve',
      concern_list: []
    }),
    deepdebug: () => ({
      status: 'success',
      summary: 'spawned deepdebug',
      spawn_session_id: 'spawn-deepdebug-1',
      diagnosis: 'spawned',
      fix: 'spawned',
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
  assert.equal(Number.isFinite(Number(substantive.dossier.schema_version)), true);
  assert.equal(substantive.dossier.root_request_id, substantive.dossier.request_id);
  assert.equal(Array.isArray(substantive.dossier.worker_trace), true);
  assert.equal(substantive.dossier.worker_trace.some((x) => x.worker === 'coach_evaluator'), true);
  assert.equal(typeof substantive.dossier.worker_outputs.coach_evaluator, 'object');
  assert.equal(typeof substantive.dossier.self_improvement, 'object');
  assert.equal(typeof substantive.dossier.self_improvement.quality_evaluation, 'object');
  assert.equal(typeof substantive.dossier.self_improvement.telemetry, 'object');
  assert.equal(substantive.dossier.self_improvement.telemetry.worker_count >= 1, true);
  for (const stage of substantive.execution_plan) {
    assert.equal(Object.prototype.hasOwnProperty.call(substantive.dossier.worker_backend_by_stage, stage), true);
    assert.equal(Object.prototype.hasOwnProperty.call(substantive.dossier.worker_session_id_by_stage, stage), true);
    assert.equal(Object.prototype.hasOwnProperty.call(substantive.dossier.fallback_reason_by_stage, stage), true);
  }
  assert.equal(String(substantive.final_message || '').includes('working...'), false);
  assert.equal(String(substantive.final_message || '').includes('Workers used:'), true);
  console.log('ok - substantive flow includes evaluator + invocation telemetry');

  const lowEvidence = runtime.orchestrateRequest({
    peerId: 'validate-peer-low-evidence',
    route: 'helpdesk',
    userMessage: 'Create a command draft for intake state machine'
  }, {
    runtimeRoot,
    workerHandlers: {
      ...workerHandlers(),
      patternscout: () => ({
        status: 'success',
        summary: 'patternscout no evidence',
        matches: [],
        source_receipts: [],
        source_tiers_used: [],
        confidence: 'low'
      }),
      librarian: () => ({
        status: 'success',
        summary: 'librarian no evidence',
        key_apis: [],
        facts: [],
        sources: []
      })
    }
  });

  assert.equal(lowEvidence.status_markers.includes('[low evidence]'), true);
  assert.equal(String(lowEvidence.final_message || '').toLowerCase().includes('evidence is limited'), true);
  console.log('ok - low evidence path adds guarded language');

  const hybridSpawned = runtime.orchestrateRequest({
    peerId: 'validate-peer-hybrid-spawn',
    route: 'helpdesk',
    userMessage: 'Generate a drivetrain subsystem draft with safety checks'
  }, {
    runtimeRoot,
    workerInvocationMode: 'hybrid',
    workerHandlers: workerHandlers(),
    spawnWorkerHandlers: spawnedWorkerHandlers()
  });

  assert.equal(hybridSpawned.dossier.worker_backend_by_stage.builder, 'spawned');
  assert.equal(hybridSpawned.dossier.worker_backend_by_stage.arbiter, 'spawned');
  assert.equal(typeof hybridSpawned.dossier.worker_session_id_by_stage.builder, 'string');
  assert.equal(hybridSpawned.answer_mode, 'reviewed_answer');
  console.log('ok - hybrid substantive flow uses spawned builder/arbiter');

  let localBuilderCalls = 0;
  const hybridFallback = runtime.orchestrateRequest({
    peerId: 'validate-peer-hybrid-fallback',
    route: 'helpdesk',
    userMessage: 'Write intake subsystem draft with command bindings'
  }, {
    runtimeRoot,
    workerInvocationMode: 'hybrid',
    workerHandlers: {
      ...workerHandlers(),
      builder: () => {
        localBuilderCalls += 1;
        return workerHandlers().builder();
      }
    },
    spawnWorkerHandlers: {
      ...spawnedWorkerHandlers(),
      builder: () => ({
        status: 'error',
        summary: 'spawn timeout',
        error: { message: 'spawn timeout' }
      })
    }
  });

  assert.equal(hybridFallback.dossier.worker_backend_by_stage.builder, 'local');
  assert.equal(String(hybridFallback.dossier.fallback_reason_by_stage.builder || '').includes('timeout'), true);
  assert.equal(localBuilderCalls >= 1, true);
  console.log('ok - hybrid falls back to local with reason telemetry');

  const spawnOnlyFailure = runtime.orchestrateRequest({
    peerId: 'validate-peer-spawn-only',
    route: 'helpdesk',
    userMessage: 'Generate shooter subsystem with state machine behavior'
  }, {
    runtimeRoot,
    workerInvocationMode: 'spawn_only',
    workerHandlers: workerHandlers(),
    spawnWorkerHandlers: {
      ...spawnedWorkerHandlers(),
      builder: () => ({
        status: 'error',
        summary: 'spawn unavailable',
        error: { message: 'spawn unavailable' }
      }),
      arbiter: () => ({
        status: 'error',
        summary: 'spawn unavailable',
        error: { message: 'spawn unavailable' }
      })
    }
  });

  assert.equal(spawnOnlyFailure.answer_mode, 'guarded_answer');
  assert.equal(spawnOnlyFailure.dossier.worker_backend_by_stage.builder, 'spawned');
  assert.equal(String(spawnOnlyFailure.dossier.fallback_reason_by_stage.builder || '').includes('spawn'), true);
  console.log('ok - spawn_only failure guards without local fallback');

  const deepDebugIntent = runtime.quickClassify('please do a deep debug root cause analysis on this hard frc robot bug').intent;
  assert.equal(deepDebugIntent, 'deep_debug');
  console.log('ok - deep debug intent routing is not shadowed');

  const guardedWhenArbiterUnavailable = runtime.orchestrateRequest({
    peerId: 'validate-peer-guarded',
    route: 'helpdesk',
    userMessage: 'Generate a subsystem draft for intake safety and control'
  }, {
    runtimeRoot,
    workerHandlers: {
      ...workerHandlers(),
      arbiter: () => ({
        status: 'error',
        summary: 'arbiter unavailable in validation',
        skipped: true,
        warnings: ['arbiter unavailable']
      })
    }
  });

  assert.equal(guardedWhenArbiterUnavailable.answer_mode, 'guarded_answer');
  assert.equal(guardedWhenArbiterUnavailable.dossier.review_state?.guarded, true);
  assert.equal(guardedWhenArbiterUnavailable.dossier.review_state?.review_completed, false);
  console.log('ok - substantive flow is forced guarded when arbiter is unavailable');

  let deepDebugCalls = 0;
  const escalated = runtime.orchestrateRequest({
    peerId: 'validate-peer-escalate',
    route: 'helpdesk',
    userMessage: 'Generate an FRC robot drivetrain subsystem; intermittent oscillation and drift under load'
  }, {
    runtimeRoot,
    workerHandlers: {
      ...workerHandlers(),
      arbiter: () => ({
        status: 'success',
        summary: 'arbiter escalate',
        verdict: 'escalate',
        concern_list: [{ id: 'instability', message: 'intermittent drift', severity: 'warning' }]
      }),
      deepdebug: () => {
        deepDebugCalls += 1;
        return {
          status: 'success',
          summary: 'deepdebug invoked',
          diagnosis: 'mock',
          fix: 'mock',
          regression_checks: [],
          unknowns: []
        };
      }
    }
  });

  assert.equal(escalated.answer_mode, 'escalated_answer');
  assert.equal(deepDebugCalls, 1);
  assert.equal(escalated.execution_plan.includes('deepdebug'), true);
  assert.equal(escalated.dossier.self_improvement.telemetry.execution_plan.includes('deepdebug'), true);
  console.log('ok - arbiter escalation appends deepdebug to plan + telemetry');

  const classifiedWithModel = runtime.quickClassify('please review this motor CAN fault wiring', {
    modelOutput: { intent: 'explain_or_review' }
  });
  assert.equal(classifiedWithModel.hints.safety_or_hardware, true);
  assert.equal(classifiedWithModel.hints.explicit_review, true);
  console.log('ok - model classifier output does not erase heuristic safety/review hints');

  const nonFrcCanPhrase = runtime.quickClassify('can you summarize this novel for me');
  assert.equal(nonFrcCanPhrase.intent, 'general_or_non_frc');
  console.log('ok - non-FRC "can you" phrasing stays on general route');

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
  assert.equal(child.dossier.parent_request_id, parent.dossier.request_id);
  assert.equal(child.dossier.root_request_id, parent.dossier.root_request_id);
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

  const explicitParentWrongConversation = runtime.orchestrateRequest({
    peerId: 'validate-group-peer-z',
    route: 'helpdesk',
    chatId: '-100otherchat',
    threadOrTopicId: '99',
    conversationContext: {
      parent_request_id: groupParent.dossier.request_id
    },
    userMessage: 'can you use that same parent context?'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  assert.equal(explicitParentWrongConversation.dossier.parent_request_id, null);
  console.log('ok - explicit parent_request_id rejected across mismatched conversation');

  const traversalParentAttempt = runtime.orchestrateRequest({
    peerId: 'validate-group-peer-traversal',
    route: 'helpdesk',
    chatId: '-100gatorbots',
    threadOrTopicId: '42',
    conversationContext: {
      parent_request_id: '../../../../etc/passwd'
    },
    userMessage: 'Need help understanding drivetrain limits'
  }, {
    runtimeRoot,
    workerHandlers: workerHandlers()
  });

  assert.equal(traversalParentAttempt.dossier.parent_request_id, null);
  console.log('ok - traversal-like parent_request_id is rejected');

  const directTraversalLoad = runtime.loadRequestDossier('../evil', '../../outside', { runtimeRoot });
  assert.equal(directTraversalLoad, null);
  const directTraversalLabel = runtime.updateOutcomeLabel('../../outside', 'worked', { runtimeRoot });
  assert.equal(directTraversalLabel, null);
  console.log('ok - traversal-like dossier ids are ignored by load/update helpers');

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
  assert.equal(typeof digest.summary.delegationUsagePercent, 'number');
  assert.equal(typeof digest.summary.fallbackPercent, 'number');
  assert.equal(typeof digest.summary.guardedPercent, 'number');
  assert.equal(typeof digest.summary.reviewIntegrityViolations, 'number');
  assertFileExists(reportPath);
  assertFileExists(backlogPath);
  assert.equal(Array.isArray(digest.failureFiles), true);
  console.log('ok - nightly digest + backlog generation');

  console.log('\nValidation suite passed.');
}

run();
