#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const path = require('path');

const { checkerWorker } = require('../../agents/checker/checker_worker');

function fixturePath(name) {
  return path.resolve(__dirname, '..', 'fixtures', name);
}

function testMissingPath() {
  const out = checkerWorker({ request_id: 'req_missing', source_repo: '/definitely/missing/path' });
  assert.equal(out.status, 'error');
  assert.equal(out.overall_status, 'error');
  assert.equal(Array.isArray(out.tests), true);
}

function testMissingGradlew() {
  const out = checkerWorker({
    request_id: 'req_skip',
    source_repo: fixturePath('checker-missing-gradlew'),
    builder_output: {
      target_files: [
        { path: 'src/main/java/frc/robot/Example.java', content: 'class Example {}' }
      ]
    }
  });
  assert.equal(out.status, 'success');
  assert.equal(out.overall_status, 'skipped');
  assert.equal(out.tests.length > 0, true);
  assert.equal(out.tests.every((t) => t.result === 'skipped'), true);
}

function testHappyPath() {
  const out = checkerWorker({
    request_id: 'req_happy',
    source_repo: fixturePath('checker-happy'),
    builder_output: {
      target_files: [
        { path: 'src/main/java/frc/robot/Example.java', content: 'class Example {}' }
      ]
    }
  });
  assert.equal(out.status, 'success');
  assert.equal(out.overall_status, 'passed');
  assert.equal(out.tests.some((t) => t.result === 'passed'), true);
}

function run() {
  testMissingPath();
  console.log('ok - checker missing path');

  testMissingGradlew();
  console.log('ok - checker missing gradlew -> skipped');

  testHappyPath();
  console.log('ok - checker happy path');

  console.log('\nRan 3 tests.');
}

run();
