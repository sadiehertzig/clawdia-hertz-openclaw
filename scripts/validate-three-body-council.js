#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtime = require('../agents/clawdia/runtime/gatorbots_helpdesk_runtime');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeWorkerHandlers(overrides) {
  return {
    patternscout: () => ({
      status: 'success',
      summary: 'patternscout council mock',
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
      summary: 'librarian council mock',
      key_apis: ['SubsystemBase', 'Command'],
      facts: ['Use SubsystemBase for subsystem logic.'],
      sources: [{ path: 'memory/wpilib/command-based.md', score: 0.9 }]
    }),
    builder: () => ({
      status: 'success',
      summary: 'builder council draft',
      student_facing_explanation: 'Draft subsystem with safe defaults and clear command lifecycle.',
      code_blocks: [
        {
          language: 'java',
          path: 'src/main/java/frc/robot/subsystems/IntakeSubsystem.java',
          code: 'class IntakeSubsystem {}'
        }
      ]
    }),
    checker: () => ({
      status: 'success',
      summary: 'checker council pass',
      overall_status: 'passed',
      tests: []
    }),
    arbiter: () => ({
      status: 'success',
      summary: 'arbiter council approve',
      verdict: 'approve',
      concern_list: []
    }),
    deepdebug: () => ({
      status: 'success',
      summary: 'deepdebug council noop',
      diagnosis: 'none',
      fix: 'none',
      regression_checks: [],
      unknowns: []
    }),
    coach_evaluator: () => ({
      status: 'success',
      summary: 'coach evaluator mock',
      overall_score: 85,
      scores: { overall: 85, correctness: 85, safety: 85, teaching: 85, evidence: 85 },
      flags: [],
      recommendations: []
    }),
    ...(overrides || {})
  };
}

function runApproveScenario(runtimeRoot) {
  const result = runtime.orchestrateRequest({
    peerId: 'council-approve',
    route: 'helpdesk',
    userMessage: 'Generate FRC intake subsystem command draft'
  }, {
    runtimeRoot,
    workerHandlers: makeWorkerHandlers()
  });

  assert.equal(result.intent, 'subsystem_or_command_draft');
  assert.equal(result.answer_mode, 'reviewed_answer');
  assert.equal(result.execution_plan.includes('builder'), true);
  assert.equal(result.execution_plan.includes('checker'), true);
  assert.equal(result.execution_plan.includes('arbiter'), true);
  assert.equal(result.execution_plan.includes('coach_evaluator'), true);
  assert.equal(result.execution_plan.includes('deepdebug'), false);
  assert.equal(result.dossier.review_state?.review_completed, true);
  console.log('ok - approve flow runs builder/checker/arbiter and returns reviewed mode');
}

function runReviseScenario(runtimeRoot) {
  const result = runtime.orchestrateRequest({
    peerId: 'council-revise',
    route: 'helpdesk',
    userMessage: 'Generate FRC intake subsystem command draft'
  }, {
    runtimeRoot,
    workerHandlers: makeWorkerHandlers({
      checker: () => ({
        status: 'success',
        summary: 'checker council failed',
        overall_status: 'failed',
        tests: [{ name: './gradlew build', result: 'failed' }]
      }),
      arbiter: () => ({
        status: 'success',
        summary: 'arbiter council revise',
        verdict: 'revise',
        concern_list: [{ id: 'checker_failed', message: 'compile failed', severity: 'warning' }],
        revised_output: [{ language: 'java', path: 'src/main/java/frc/robot/subsystems/IntakeSubsystem.java', code: 'class IntakeSubsystem { }' }]
      })
    })
  });

  assert.equal(result.answer_mode, 'reviewed_answer');
  assert.equal(result.checker_badge, '[checks failed]');
  assert.equal(result.dossier.worker_outputs?.arbiter?.verdict, 'revise');
  assert.equal(Array.isArray(result.dossier.worker_outputs?.arbiter?.revised_output), true);
  console.log('ok - revise flow preserves reviewed mode and surfaces checker failure badge');
}

function runEscalateScenario(runtimeRoot) {
  let deepDebugCalls = 0;
  const result = runtime.orchestrateRequest({
    peerId: 'council-escalate',
    route: 'helpdesk',
    userMessage: 'Generate FRC intake subsystem command; intermittent oscillation and random drift persists'
  }, {
    runtimeRoot,
    workerHandlers: makeWorkerHandlers({
      arbiter: () => ({
        status: 'success',
        summary: 'arbiter council escalate',
        verdict: 'escalate',
        concern_list: [{ id: 'intermittent', message: 'intermittent instability', severity: 'warning' }]
      }),
      deepdebug: () => {
        deepDebugCalls += 1;
        return {
          status: 'success',
          summary: 'deepdebug council invoked',
          diagnosis: 'intermittent race',
          fix: 'add deterministic state machine',
          regression_checks: ['run autonomous sim'],
          unknowns: []
        };
      }
    })
  });

  assert.equal(result.answer_mode, 'escalated_answer');
  assert.equal(deepDebugCalls, 1);
  assert.equal(result.execution_plan.includes('deepdebug'), true);
  assert.equal(result.dossier.self_improvement.telemetry.execution_plan.includes('deepdebug'), true);
  assert.equal(result.dossier.worker_trace.filter((entry) => entry.worker === 'deepdebug').length, 1);
  console.log('ok - escalate flow invokes deepdebug once and records it in execution telemetry');
}

function runGuardedScenario(runtimeRoot) {
  const result = runtime.orchestrateRequest({
    peerId: 'council-guarded',
    route: 'helpdesk',
    userMessage: 'Generate FRC subsystem draft for intake'
  }, {
    runtimeRoot,
    workerHandlers: makeWorkerHandlers({
      arbiter: () => ({
        status: 'error',
        summary: 'arbiter unavailable in council validation',
        skipped: true,
        warnings: ['arbiter unavailable']
      })
    })
  });

  assert.equal(result.answer_mode, 'guarded_answer');
  assert.equal(result.dossier.review_state?.guarded, true);
  console.log('ok - guarded flow triggers when arbiter is unavailable');
}

function runClassifierRegressionChecks() {
  const withModel = runtime.quickClassify('please review this motor CAN fault wiring', {
    modelOutput: { intent: 'explain_or_review' }
  });
  assert.equal(withModel.hints.safety_or_hardware, true);
  assert.equal(withModel.hints.explicit_review, true);

  const nonFrc = runtime.quickClassify('can you summarize this novel for me');
  assert.equal(nonFrc.intent, 'general_or_non_frc');
  console.log('ok - classifier keeps heuristic hints and avoids false FRC routing for "can you" chat');
}

function run() {
  const runtimeRoot = makeTempDir('clawdia-three-body-council-');
  runApproveScenario(runtimeRoot);
  runReviseScenario(runtimeRoot);
  runEscalateScenario(runtimeRoot);
  runGuardedScenario(runtimeRoot);
  runClassifierRegressionChecks();
  console.log('\nThree-body-council validation passed.');
}

run();
