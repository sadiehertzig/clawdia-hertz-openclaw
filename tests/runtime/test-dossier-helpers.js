#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const helpers = require('../../agents/clawdia/runtime/dossier_helpers');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawdia-dossier-test-'));
}

function testAnswerModePriority() {
  const d = helpers.createInitialDossier({ peerId: 'u1', userMessage: 'x', route: 'helpdesk', intent: 'subsystem_or_command_draft' });

  assert.equal(helpers.resolveAnswerMode(d), 'direct_answer');

  helpers.markReviewCompleted(d, 'arbiter');
  assert.equal(helpers.resolveAnswerMode(d), 'reviewed_answer');

  helpers.markEscalated(d, 'deepdebug');
  assert.equal(helpers.resolveAnswerMode(d), 'escalated_answer');

  helpers.markGuarded(d, 'arbiter_unavailable');
  assert.equal(helpers.resolveAnswerMode(d), 'guarded_answer');
}

function testParentLinkageRetryIncrement() {
  const parent = helpers.createInitialDossier({
    peerId: 'u2',
    userMessage: 'first',
    route: 'helpdesk',
    intent: 'subsystem_or_command_draft'
  });
  parent.context.retry_count = 2;
  parent.retrieval_sources = [{ tier: 'team_local', source: 'repo' }];

  const child = helpers.createInitialDossier({
    peerId: 'u2',
    userMessage: "that didn't work",
    route: 'helpdesk',
    intent: 'follow_up'
  });

  helpers.attachParentDossier(child, parent, { followUpFailure: true });

  assert.equal(child.parent_request_id, parent.request_id);
  assert.equal(child.context.retry_count, 3);
  assert.equal(child.context.follow_up_failure, true);
  assert.equal(child.context.parent_intent, 'subsystem_or_command_draft');
  assert.ok(Array.isArray(child.context.prior_evidence));
  assert.equal(child.context.prior_evidence.length > 0, true);
}

function testSaveAndLoad() {
  const tempRoot = makeTempRoot();

  const d = helpers.createInitialDossier({
    peerId: 'u3',
    userMessage: 'hello',
    route: 'helpdesk',
    intent: 'general_or_non_frc'
  });
  helpers.finalizeDossier(d);
  helpers.saveDossier(d, { runtimeRoot: tempRoot });

  const loadedLatest = helpers.loadLatestDossier(d.session_id, { runtimeRoot: tempRoot });
  const loadedReq = helpers.loadRequestDossier(d.session_id, d.request_id, { runtimeRoot: tempRoot });

  assert.equal(loadedLatest.request_id, d.request_id);
  assert.equal(loadedReq.request_id, d.request_id);
  assert.equal(typeof loadedReq.human_dossier_note, 'string');
}

function run() {
  testAnswerModePriority();
  console.log('ok - answer mode priority');

  testParentLinkageRetryIncrement();
  console.log('ok - parent linkage + retry increment');

  testSaveAndLoad();
  console.log('ok - save/load dossier');

  console.log('\nRan 3 tests.');
}

run();
