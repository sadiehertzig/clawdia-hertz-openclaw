#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  materializeCandidateChange,
  isSafeRelativePath,
  looksLikeUnifiedDiff
} = require('../../agents/checker/checker_worker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initGitRepoWithFile() {
  const dir = makeTempDir('checker-patch-test-');
  fs.writeFileSync(path.join(dir, 'Example.java'), 'class Example {\n  int x = 1;\n}\n', 'utf8');
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=tester', 'commit', '-m', 'init'], {
    cwd: dir,
    stdio: 'ignore'
  });
  return dir;
}

function testSafePathValidation() {
  assert.equal(isSafeRelativePath('src/main/java/A.java'), true);
  assert.equal(isSafeRelativePath('../../etc/passwd'), false);
  assert.equal(isSafeRelativePath('/abs/path'), false);
  assert.equal(isSafeRelativePath('.git/config'), false);
}

function testPathTraversalRejected() {
  const dir = makeTempDir('checker-path-test-');
  const result = materializeCandidateChange(dir, {
    builder_output: {
      target_files: [
        { path: '../../etc/passwd', content: 'bad' }
      ]
    }
  });

  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'unsafe_path');
}

function testGitPathRejected() {
  const dir = makeTempDir('checker-gitpath-test-');
  const result = materializeCandidateChange(dir, {
    builder_output: {
      target_files: [
        { path: '.git/config', content: 'bad' }
      ]
    }
  });

  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'unsafe_path');
}

function testExplicitWriteMode() {
  const dir = makeTempDir('checker-explicit-test-');
  const result = materializeCandidateChange(dir, {
    builder_output: {
      target_files: [
        { path: 'src/main/java/frc/robot/Intake.java', content: 'class Intake {}' }
      ]
    }
  });

  assert.equal(result.status, 'applied');
  const written = path.join(dir, 'src/main/java/frc/robot/Intake.java');
  assert.equal(fs.existsSync(written), true);
}

function testUnifiedDiffMode() {
  const repo = initGitRepoWithFile();
  const patch = [
    'diff --git a/Example.java b/Example.java',
    'index 7d77f73..1f35ff2 100644',
    '--- a/Example.java',
    '+++ b/Example.java',
    '@@ -1,3 +1,3 @@',
    ' class Example {',
    '-  int x = 1;',
    '+  int x = 2;',
    ' }'
  ].join('\n');

  assert.equal(looksLikeUnifiedDiff(patch), true);

  const result = materializeCandidateChange(repo, {
    builder_output: {
      patch
    }
  });

  assert.equal(result.status, 'applied');
  assert.equal(result.mode, 'unified_diff');

  const updated = fs.readFileSync(path.join(repo, 'Example.java'), 'utf8');
  assert.equal(updated.includes('int x = 2;'), true);
}

function run() {
  testSafePathValidation();
  console.log('ok - safe path validation');

  testPathTraversalRejected();
  console.log('ok - checker rejects path traversal');

  testGitPathRejected();
  console.log('ok - checker rejects .git writes');

  testExplicitWriteMode();
  console.log('ok - checker explicit write mode');

  testUnifiedDiffMode();
  console.log('ok - checker unified diff mode');

  console.log('\nRan 5 tests.');
}

run();
