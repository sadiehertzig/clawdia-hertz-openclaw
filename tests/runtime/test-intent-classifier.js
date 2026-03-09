#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const classifier = require('../../agents/clawdia/runtime/intent_classifier');

function testValidModelJsonParse() {
  const out = classifier.quickClassify('irrelevant', {
    modelOutput: JSON.stringify({
      intent: 'api_docs_lookup',
      confidence: 'high',
      explicit_review: true
    })
  });

  assert.equal(out.intent, 'api_docs_lookup');
  assert.equal(out.confidence, 'high');
}

function testInvalidModelJsonFallsBack() {
  const out = classifier.quickClassify('tell me a joke', {
    modelOutput: '{ bad json'
  });

  assert.equal(out.intent, 'general_or_non_frc');
  assert.equal(out.confidence, 'heuristic');
}

function testHintsDetection() {
  const hints = classifier.detectRoutingHints('That did not work, same error on CAN motor, please review');
  assert.equal(hints.is_follow_up, true);
  assert.equal(hints.follow_up_failure, true);
  assert.equal(hints.safety_or_hardware, true);
  assert.equal(hints.explicit_review, true);
}

function testHeuristicClassification() {
  assert.equal(
    classifier.quickClassify('Write a command-based intake subsystem for FRC robot').intent,
    'subsystem_or_command_draft'
  );

  assert.equal(
    classifier.quickClassify('PathPlanner autonomous swerve tuning issue').intent,
    'autonomous_or_pathing'
  );

  assert.equal(
    classifier.quickClassify('why does this vision camera pipeline fail').intent,
    'vision_problem'
  );
}

function run() {
  testValidModelJsonParse();
  console.log('ok - valid model JSON parse');

  testInvalidModelJsonFallsBack();
  console.log('ok - invalid model JSON fallback');

  testHintsDetection();
  console.log('ok - hint detection');

  testHeuristicClassification();
  console.log('ok - heuristic classifications');

  console.log('\nRan 4 tests.');
}

run();
