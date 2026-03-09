#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const { builderWorker, inferCodeCategory } = require('../../agents/builder/builder_worker');

function testInferCategory() {
  assert.equal(inferCodeCategory('subsystem_or_command_draft', 'write intake subsystem'), 'subsystem');
  assert.equal(inferCodeCategory('autonomous_or_pathing', 'create auto path'), 'autonomous');
  assert.equal(inferCodeCategory('vision_problem', 'limelight not working'), 'vision');
  assert.equal(inferCodeCategory('build_deploy_error', 'deploy fails'), 'command');
  // Fallback from message content
  assert.equal(inferCodeCategory('general_or_non_frc', 'write a shooter subsystem'), 'subsystem');
}

function testBasicDraft() {
  const result = builderWorker({
    request_id: 'test-build-1',
    intent: 'subsystem_or_command_draft',
    user_message: 'Write a FRC intake subsystem'
  });

  assert.equal(result.status, 'success');
  assert.equal(result.kind, 'draft');
  assert.ok(result.code_blocks.length > 0, 'should produce at least one code block');
  assert.ok(result.student_facing_explanation.length > 0);
  assert.equal(result.contract_flags.reviewed, false, 'Builder must never claim review');
  assert.equal(result.contract_flags.escalated, false);
}

function testNeverReviewed() {
  const result = builderWorker({
    request_id: 'test-build-2',
    intent: 'vision_problem',
    user_message: 'Create vision pipeline for AprilTags'
  });

  assert.equal(result.contract_flags.reviewed, false);
  assert.ok(result.code_blocks.some((b) => b.code.includes('PhotonCamera')));
}

function testUsesLibrarianContext() {
  const result = builderWorker({
    request_id: 'test-build-3',
    intent: 'subsystem_or_command_draft',
    user_message: 'Write elevator subsystem',
    dossier: {
      worker_outputs: {
        librarian: {
          facts: ['TalonFX requires current limit config', 'Use MotionMagic for elevator'],
          key_apis: ['TalonFX(int deviceId)'],
          sources: []
        }
      }
    }
  });

  assert.equal(result.status, 'success');
  assert.ok(result.student_facing_explanation.includes('TalonFX requires current limit'));
  assert.ok(result.facts.length > 0);
}

function testCodeBlockStructure() {
  const result = builderWorker({
    request_id: 'test-build-4',
    intent: 'autonomous_or_pathing',
    user_message: 'Create autonomous routine'
  });

  for (const block of result.code_blocks) {
    assert.ok(block.language, 'code block must have language');
    assert.ok(block.code, 'code block must have code');
    assert.ok(block.path, 'code block must have path');
  }
}

function run() {
  testInferCategory();
  console.log('ok - infer code category');

  testBasicDraft();
  console.log('ok - basic draft production');

  testNeverReviewed();
  console.log('ok - builder never claims review');

  testUsesLibrarianContext();
  console.log('ok - uses librarian context');

  testCodeBlockStructure();
  console.log('ok - code block structure');

  console.log('\nRan 5 tests.');
}

run();
