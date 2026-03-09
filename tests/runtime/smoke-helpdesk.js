#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const orchestrator = require('../../agents/clawdia/runtime/helpdesk_orchestrator');

function makeRuntimeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawdia-smoke-test-'));
}

function workerHandlers() {
  return {
    patternscout: () => ({ status: 'success', summary: 'ps', matches: [], source_tiers_used: [], confidence: 'low' }),
    librarian: () => ({ status: 'success', summary: 'lib', key_apis: [], facts: [], sources: [] }),
    builder: () => ({ status: 'success', summary: 'build', student_facing_explanation: 'draft', code_blocks: [] }),
    checker: () => ({ status: 'success', summary: 'check', overall_status: 'skipped', tests: [], worktree_path: null }),
    arbiter: () => ({ status: 'success', summary: 'arbiter approve', verdict: 'approve', concern_list: [] }),
    deepdebug: () => ({ status: 'success', summary: 'debug', diagnosis: 'x', fix: 'y', regression_checks: [], unknowns: [] })
  };
}

function assertValidMode(mode) {
  assert.equal(['direct_answer', 'reviewed_answer', 'escalated_answer', 'guarded_answer'].includes(mode), true);
}

function runCase(name, userMessage) {
  const out = orchestrator.orchestrateRequest({
    peerId: `smoke-${name}`,
    route: 'helpdesk',
    userMessage
  }, {
    runtimeRoot: makeRuntimeRoot(),
    workerHandlers: workerHandlers()
  });

  assertValidMode(out.answer_mode);
  assert.equal(Array.isArray(out.dossier.worker_trace), true);
  return out;
}

function run() {
  runCase('intake', 'Write a command-based intake subsystem for FRC');
  console.log('ok - smoke intake subsystem request');

  runCase('docs', 'What is the constructor signature for TalonFX in this season API?');
  console.log('ok - smoke docs lookup');

  const joke = runCase('joke', 'tell me a joke about robots');
  assert.equal(joke.intent, 'general_or_non_frc');
  console.log('ok - smoke non-frc chat');

  runCase('deploy', 'Gradle deploy failed on roborio with vendor dep error');
  console.log('ok - smoke deploy error');

  runCase('auto', 'Autonomous pathing oscillates and pose estimate drifts');
  console.log('ok - smoke autonomous debug');

  console.log('\nSmoke suite passed (5 prompts).');
}

run();
