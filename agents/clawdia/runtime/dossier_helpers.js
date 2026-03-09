'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_RUNTIME_ROOT = path.resolve(__dirname, '..', '..', '..', 'runtime_state', 'dossiers', 'sessions');

function nowIso(date) {
  return (date instanceof Date ? date : new Date()).toISOString();
}

function sanitizeIdPart(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  const safe = normalized
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe || fallback;
}

function makeRequestId(now) {
  const ts = (typeof now === 'number' ? now : Date.now()).toString(36);
  const rnd = crypto.randomBytes(4).toString('hex');
  return `req_${ts}_${rnd}`;
}

function makeSessionId(peerId) {
  const base = sanitizeIdPart(peerId, 'anonymous');
  const hash = crypto
    .createHash('sha1')
    .update(String(peerId || 'anonymous'))
    .digest('hex')
    .slice(0, 10);
  return `sess_${base}_${hash}`;
}

function makeThreadKey(sessionId, rootRequestId) {
  return `thread_${sanitizeIdPart(sessionId, 'session')}_${sanitizeIdPart(rootRequestId, 'root')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ensureSessionDirs(sessionId, options) {
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const sessionDir = path.join(runtimeRoot, sessionId);
  const requestsDir = path.join(sessionDir, 'requests');
  fs.mkdirSync(requestsDir, { recursive: true });
  return { sessionDir, requestsDir };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadLatestDossier(sessionId, options) {
  if (!sessionId) return null;
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  return readJsonIfExists(path.join(runtimeRoot, sessionId, 'latest.json'));
}

function loadRequestDossier(sessionId, requestId, options) {
  if (!sessionId || !requestId) return null;
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  return readJsonIfExists(path.join(runtimeRoot, sessionId, 'requests', `${requestId}.json`));
}

function looksLikeFollowUp(userMessage, conversationContext) {
  const text = String(userMessage || '').trim().toLowerCase();
  const mergedContext = asText(conversationContext).toLowerCase();
  const followUpPatterns = [
    "that didn't work",
    'same error',
    'what about',
    'instead',
    'ok now',
    'try again',
    'also',
    'now add',
    'can you fix',
    'still failing',
    'still broken',
    'same issue',
    'same problem',
    'it failed'
  ];

  return followUpPatterns.some((pattern) => {
    return text.includes(pattern) || mergedContext.includes(pattern);
  });
}

function createInitialDossier(options) {
  const opts = options || {};
  const createdAt = nowIso();
  const requestId = makeRequestId();
  const sessionId = makeSessionId(opts.peerId);
  const parent = opts.parentDossier || null;
  const inferredFollowUp = parent && looksLikeFollowUp(opts.userMessage, opts.conversationContext);
  const parentRequestId = parent ? parent.request_id || null : null;
  const rootRequestId = parent && parent.thread_key
    ? String(parent.thread_key).split('_').slice(-2).join('_')
    : requestId;

  const retryBase = Number(parent?.context?.retry_count || 0);
  const retryCount = inferredFollowUp ? retryBase + 1 : 0;

  const dossier = {
    request_id: requestId,
    parent_request_id: parentRequestId,
    chat_id: opts.chatId || opts.peerId || null,
    thread_or_topic_id: opts.threadOrTopicId || null,
    session_id: sessionId,
    thread_key: parent?.thread_key || makeThreadKey(sessionId, rootRequestId),
    route: opts.route || 'unclassified',
    user_message: String(opts.userMessage || ''),
    intent: opts.intent || 'general_or_non_frc',
    answer_mode: 'direct_answer',
    stage_status: {
      intake: 'started'
    },
    elapsed_time_ms_by_stage: {},
    worker_outputs: {},
    worker_trace: [],
    retrieval_sources: [],
    serving_model_by_stage: {},
    fallback_events: [],
    final_status: 'in_progress',
    review_state: {
      review_completed: false,
      reviewer: null,
      escalation_completed: false,
      escalation_worker: null,
      guarded: false,
      guarded_reason: null
    },
    context: {
      retry_count: retryCount,
      follow_up_failure: false,
      parent_intent: parent?.intent || null,
      prior_evidence: asArray(parent?.retrieval_sources).slice(0, 24),
      constraints: [],
      assumptions: [],
      notes: []
    },
    human_dossier_note: '',
    timestamps: {
      created_at: createdAt,
      updated_at: createdAt
    }
  };

  if (parent && inferredFollowUp) {
    dossier.context.notes.push('Detected likely follow-up; attached parent dossier context.');
  }

  return dossier;
}

function noteStageStatus(dossier, stage, status) {
  if (!dossier || !stage) return dossier;
  dossier.stage_status = dossier.stage_status || {};
  dossier.stage_status[stage] = status || 'unknown';
  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function noteHumanEvent(dossier, label, status) {
  if (!dossier) return dossier;
  dossier.context = dossier.context || {};
  dossier.context.notes = asArray(dossier.context.notes);
  dossier.context.notes.push(`${label || 'event'}: ${status || 'unknown'}`);
  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function mergeTelemetry(dossier, stage, hints) {
  if (!dossier) return dossier;
  const data = hints || {};

  dossier.elapsed_time_ms_by_stage = dossier.elapsed_time_ms_by_stage || {};
  dossier.serving_model_by_stage = dossier.serving_model_by_stage || {};
  dossier.fallback_events = asArray(dossier.fallback_events);

  if (typeof data.elapsed_time_ms === 'number' && Number.isFinite(data.elapsed_time_ms)) {
    dossier.elapsed_time_ms_by_stage[stage] = data.elapsed_time_ms;
  }

  if (data.serving_model) {
    dossier.serving_model_by_stage[stage] = String(data.serving_model);
  }

  if (data.fallback_event) {
    dossier.fallback_events.push(data.fallback_event);
  }

  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function recordWorkerOutput(dossier, worker, result) {
  if (!dossier || !worker) return dossier;

  const normalizedResult = result && typeof result === 'object'
    ? result
    : {
        status: 'error',
        summary: 'worker result missing',
        warnings: ['worker result missing'],
        contract_flags: {
          reviewed: false,
          escalated: false,
          implementation_safe: false,
          pattern_only: false
        }
      };

  dossier.worker_outputs = dossier.worker_outputs || {};
  dossier.worker_trace = asArray(dossier.worker_trace);
  dossier.retrieval_sources = asArray(dossier.retrieval_sources);

  dossier.worker_outputs[worker] = normalizedResult;
  dossier.worker_trace.push({
    at: nowIso(),
    worker,
    status: normalizedResult.status || 'unknown',
    summary: asText(normalizedResult.summary).slice(0, 300),
    skipped: Boolean(normalizedResult.skipped),
    error: normalizedResult.error || null
  });

  if (Array.isArray(normalizedResult.matches)) {
    for (const match of normalizedResult.matches) {
      if (match && typeof match === 'object') {
        dossier.retrieval_sources.push({
          tier: match.tier || 'unknown',
          source: match.source_id || match.repo || 'unknown',
          path: match.path || null,
          symbol: match.symbol || null,
          url: match.url || null
        });
      }
    }
  }

  if (normalizedResult.contract_flags?.reviewed) {
    markReviewCompleted(dossier, worker);
  }

  if (normalizedResult.contract_flags?.escalated) {
    markEscalated(dossier, worker);
  }

  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function attachParentDossier(dossier, parentDossier, options) {
  if (!dossier || !parentDossier) return dossier;

  const opts = options || {};
  dossier.parent_request_id = parentDossier.request_id || dossier.parent_request_id;
  dossier.context = dossier.context || {};
  dossier.context.parent_intent = parentDossier.intent || dossier.context.parent_intent || null;

  const parentRetry = Number(parentDossier.context?.retry_count || 0);
  dossier.context.retry_count = Number.isFinite(parentRetry) ? parentRetry + 1 : 1;

  dossier.context.prior_evidence = asArray(parentDossier.retrieval_sources)
    .concat(asArray(parentDossier.context?.prior_evidence))
    .slice(0, 48);

  dossier.context.follow_up_failure = Boolean(opts.followUpFailure);
  dossier.thread_key = parentDossier.thread_key || dossier.thread_key;
  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();

  return dossier;
}

function markGuarded(dossier, reason) {
  if (!dossier) return dossier;
  dossier.review_state = dossier.review_state || {};
  dossier.review_state.guarded = true;
  dossier.review_state.guarded_reason = reason || 'unknown';
  dossier.final_status = 'guarded';
  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function markReviewCompleted(dossier, reviewer) {
  if (!dossier) return dossier;
  dossier.review_state = dossier.review_state || {};
  dossier.review_state.review_completed = true;
  dossier.review_state.reviewer = reviewer || dossier.review_state.reviewer || null;
  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function markEscalated(dossier, worker) {
  if (!dossier) return dossier;
  dossier.review_state = dossier.review_state || {};
  dossier.review_state.escalation_completed = true;
  dossier.review_state.escalation_worker = worker || dossier.review_state.escalation_worker || null;
  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function resolveAnswerMode(dossier) {
  const reviewState = dossier?.review_state || {};

  if (reviewState.guarded === true) {
    return 'guarded_answer';
  }

  if (reviewState.escalation_completed === true && reviewState.escalation_worker) {
    return 'escalated_answer';
  }

  if (reviewState.review_completed === true && reviewState.reviewer) {
    return 'reviewed_answer';
  }

  return 'direct_answer';
}

function finalizeDossier(dossier) {
  if (!dossier) return dossier;
  dossier.answer_mode = resolveAnswerMode(dossier);

  if (!dossier.final_status || dossier.final_status === 'in_progress') {
    dossier.final_status = dossier.answer_mode === 'guarded_answer' ? 'guarded' : 'success';
  }

  dossier.stage_status = dossier.stage_status || {};
  dossier.stage_status.finalize = 'completed';

  dossier.human_dossier_note = renderHumanDossierNote(dossier);
  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function renderHumanDossierNote(dossier) {
  const d = dossier || {};
  const workers = asArray(d.worker_trace).map((entry) => {
    const state = entry.skipped ? 'skipped' : entry.status;
    return `${entry.worker}:${state}`;
  });

  const keyState = [];
  if (d.review_state?.review_completed) {
    keyState.push(`reviewed-by=${d.review_state.reviewer || 'unknown'}`);
  }
  if (d.review_state?.escalation_completed) {
    keyState.push(`escalated-by=${d.review_state.escalation_worker || 'unknown'}`);
  }
  if (d.review_state?.guarded) {
    keyState.push(`guarded=${d.review_state.guarded_reason || 'unknown'}`);
  }

  return [
    `# Request ${d.request_id || 'unknown'}`,
    `- intent: ${d.intent || 'unknown'}`,
    `- parent: ${d.parent_request_id || 'none'}`,
    `- workers: ${workers.join(', ') || 'none'}`,
    `- answer mode: ${d.answer_mode || resolveAnswerMode(d)}`,
    `- state: ${keyState.join('; ') || 'none'}`
  ].join('\n');
}

function findRequestMarkdownPath(requestId, runtimeRoot) {
  const root = runtimeRoot || DEFAULT_RUNTIME_ROOT;
  if (!requestId || !fs.existsSync(root)) return null;

  const sessions = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const sessionName of sessions) {
    const mdPath = path.join(root, sessionName, 'requests', `${requestId}.md`);
    if (fs.existsSync(mdPath)) {
      return mdPath;
    }
  }

  return null;
}

function writeHumanDossierNote(requestId, note, options) {
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const sessionId = options?.sessionId || null;

  let requestNotePath = null;
  if (sessionId) {
    requestNotePath = path.join(runtimeRoot, sessionId, 'requests', `${requestId}.md`);
  } else {
    requestNotePath = findRequestMarkdownPath(requestId, runtimeRoot);
  }

  if (!requestNotePath) return false;

  fs.writeFileSync(requestNotePath, String(note || ''), 'utf8');
  return true;
}

function saveDossier(dossier, options) {
  if (!dossier || typeof dossier !== 'object') {
    throw new Error('saveDossier requires a dossier object');
  }

  if (!dossier.session_id || !dossier.request_id) {
    throw new Error('dossier.session_id and dossier.request_id are required');
  }

  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const { sessionDir, requestsDir } = ensureSessionDirs(dossier.session_id, { runtimeRoot });

  dossier.answer_mode = resolveAnswerMode(dossier);
  dossier.timestamps = dossier.timestamps || {};
  if (!dossier.timestamps.created_at) dossier.timestamps.created_at = nowIso();
  dossier.timestamps.updated_at = nowIso();

  if (!dossier.human_dossier_note) {
    dossier.human_dossier_note = renderHumanDossierNote(dossier);
  }

  const json = JSON.stringify(dossier, null, 2);
  const note = String(dossier.human_dossier_note || renderHumanDossierNote(dossier));

  fs.writeFileSync(path.join(requestsDir, `${dossier.request_id}.json`), json, 'utf8');
  fs.writeFileSync(path.join(requestsDir, `${dossier.request_id}.md`), note, 'utf8');
  fs.writeFileSync(path.join(sessionDir, 'latest.json'), json, 'utf8');
  fs.writeFileSync(path.join(sessionDir, 'latest.md'), note, 'utf8');

  return dossier;
}

module.exports = {
  DEFAULT_RUNTIME_ROOT,
  asArray,
  asText,
  makeRequestId,
  makeSessionId,
  makeThreadKey,
  createInitialDossier,
  noteStageStatus,
  noteHumanEvent,
  mergeTelemetry,
  recordWorkerOutput,
  attachParentDossier,
  markGuarded,
  markReviewCompleted,
  markEscalated,
  resolveAnswerMode,
  finalizeDossier,
  renderHumanDossierNote,
  saveDossier,
  loadLatestDossier,
  loadRequestDossier,
  writeHumanDossierNote,
  looksLikeFollowUp
};
