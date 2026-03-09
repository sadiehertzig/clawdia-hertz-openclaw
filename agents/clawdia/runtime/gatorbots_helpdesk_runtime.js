'use strict';

const dossier = require('./dossier_helpers');
const classifier = require('./intent_classifier');
const adapters = require('./worker_adapters');
const orchestrator = require('./helpdesk_orchestrator');

function createRequestId() {
  return dossier.makeRequestId();
}

function createSessionId(peerId) {
  return dossier.makeSessionId(peerId);
}

function createThreadKey(sessionId, rootRequestId) {
  return dossier.makeThreadKey(sessionId, rootRequestId);
}

function detectFollowUp(message, latestDossier) {
  const isFollowUp = dossier.looksLikeFollowUp(message, null);
  return {
    is_follow_up: Boolean(isFollowUp && latestDossier),
    parent_request_id: latestDossier?.request_id || null,
    thread_key: latestDossier?.thread_key || null,
    reason: isFollowUp ? 'pattern_match' : 'no_follow_up_pattern'
  };
}

function createInitialDossier(options) {
  const opts = options || {};
  const sessionId = dossier.makeSessionId(opts.peerId);
  const latest = dossier.loadLatestDossier(sessionId);
  const follow = detectFollowUp(opts.userMessage, latest);

  const d = dossier.createInitialDossier({
    peerId: opts.peerId,
    route: opts.route,
    userMessage: opts.userMessage,
    intent: opts.intent || 'general_or_non_frc',
    parentDossier: follow.is_follow_up ? latest : null
  });

  if (follow.is_follow_up && latest) {
    dossier.attachParentDossier(d, latest, {
      followUpFailure: false
    });
  }

  return d;
}

function normalizeWorkerResult(options) {
  const opts = options || {};
  return adapters.adaptWorkerOutput(opts.worker || 'generic', opts.raw, opts.request_id, {
    defaultKind: opts.defaultKind
  });
}

function recordWorkerResult(dossierObj, result) {
  const worker = result?.worker || 'unknown_worker';
  return dossier.recordWorkerOutput(dossierObj, worker, result);
}

function resolveAnswerMode(dossierObj) {
  return dossier.resolveAnswerMode(dossierObj);
}

function renderHumanDossier(dossierObj) {
  return dossier.renderHumanDossierNote(dossierObj);
}

function saveDossier(dossierObj, options) {
  return dossier.saveDossier(dossierObj, options);
}

function loadLatestDossier(sessionId, options) {
  return dossier.loadLatestDossier(sessionId, options);
}

function loadRequestDossier(sessionId, requestId, options) {
  return dossier.loadRequestDossier(sessionId, requestId, options);
}

function quickClassify(prompt, options) {
  return classifier.quickClassify(prompt, options);
}

function loadLikelyParentDossier(options) {
  return orchestrator.loadLikelyParentDossier(options);
}

function callWorker(worker, payload, runtimeCtx) {
  return orchestrator.callWorker(worker, payload, runtimeCtx);
}

function isWorkerAvailable(worker, runtimeCtx) {
  return orchestrator.isWorkerAvailable(worker, runtimeCtx);
}

function writeHumanDossierNote(requestId, note, options) {
  return dossier.writeHumanDossierNote(requestId, note, options);
}

function setOutcomeLabel(dossierObj, label, options) {
  return dossier.setOutcomeLabel(dossierObj, label, options);
}

function updateOutcomeLabel(requestId, label, options) {
  return dossier.updateOutcomeLabel(requestId, label, options);
}

function orchestrateRequest(input, runtimeCtx) {
  return orchestrator.orchestrateRequest(input, runtimeCtx);
}

function renderChatResponse(orchestrationResult, answerText) {
  const result = orchestrationResult || {};
  const markers = Array.isArray(result.status_markers) && result.status_markers.length
    ? result.status_markers.join(' ')
    : (result.answer_badge || '');

  const fallback = typeof result.final_message === 'string' ? result.final_message.trim() : '';
  const message = typeof answerText === 'string' && answerText.trim()
    ? answerText.trim()
    : fallback;

  if (!markers) return message;
  if (!message) return markers;
  if (message.startsWith(markers)) return message;
  return `${markers} ${message}`.trim();
}

module.exports = {
  createRequestId,
  createSessionId,
  createThreadKey,
  loadLatestDossier,
  loadRequestDossier,
  saveDossier,
  detectFollowUp,
  createInitialDossier,
  normalizeWorkerResult,
  recordWorkerResult,
  resolveAnswerMode,
  renderHumanDossier,
  quickClassify,
  loadLikelyParentDossier,
  callWorker,
  isWorkerAvailable,
  writeHumanDossierNote,
  setOutcomeLabel,
  updateOutcomeLabel,
  orchestrateRequest,
  renderChatResponse
};
