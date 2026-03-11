'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_RUNTIME_ROOT = path.resolve(__dirname, '..', '..', '..', 'runtime_state', 'dossiers', 'sessions');
const DOSSIER_SCHEMA_VERSION = 2;
const OUTCOME_LABELS = new Set(['unknown', 'worked', 'partially_worked', 'failed', 'unsafe']);
const OUTCOME_SOURCES = new Set(['system', 'manual', 'reaction', 'user_follow_up', 'follow_up_inference']);
const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

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

function normalizeSafeId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!SAFE_ID_RE.test(normalized)) return null;
  if (normalized.includes('..')) return null;
  if (normalized.includes('/') || normalized.includes('\\')) return null;
  return normalized;
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

function normalizeConversationPart(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
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

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function durationMsFromIso(startIso, endIso) {
  const start = Date.parse(String(startIso || ''));
  const end = Date.parse(String(endIso || ''));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const delta = end - start;
  return delta >= 0 ? delta : null;
}

function normalizeOutcomeLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return OUTCOME_LABELS.has(normalized) ? normalized : 'unknown';
}

function normalizeOutcomeSource(source) {
  const normalized = String(source || '').trim().toLowerCase();
  return OUTCOME_SOURCES.has(normalized) ? normalized : 'system';
}

function ensureSelfImprovementState(dossier) {
  if (!dossier || typeof dossier !== 'object') return {};
  dossier.self_improvement = dossier.self_improvement || {};
  const state = dossier.self_improvement;

  state.telemetry = state.telemetry || {};
  state.telemetry.intent = String(state.telemetry.intent || dossier.intent || 'general_or_non_frc');
  state.telemetry.route = String(state.telemetry.route || dossier.route || 'unclassified');
  state.telemetry.execution_plan = asArray(state.telemetry.execution_plan).map((x) => String(x));
  state.telemetry.status_markers = asArray(state.telemetry.status_markers).map((x) => String(x));
  state.telemetry.total_elapsed_ms = toFiniteNumber(state.telemetry.total_elapsed_ms);
  state.telemetry.worker_count = Number.isFinite(Number(state.telemetry.worker_count))
    ? Number(state.telemetry.worker_count)
    : 0;
  state.telemetry.retrieval_source_count = Number.isFinite(Number(state.telemetry.retrieval_source_count))
    ? Number(state.telemetry.retrieval_source_count)
    : 0;
  state.telemetry.answer_mode = String(state.telemetry.answer_mode || dossier.answer_mode || 'direct_answer');
  state.telemetry.checker_status = state.telemetry.checker_status || null;

  state.outcome = state.outcome || {};
  state.outcome.label = normalizeOutcomeLabel(state.outcome.label || 'unknown');
  state.outcome.source = normalizeOutcomeSource(state.outcome.source || 'system');
  state.outcome.note = state.outcome.note == null ? null : String(state.outcome.note).slice(0, 300);
  state.outcome.recorded_at = state.outcome.recorded_at || null;

  if (state.quality_evaluation != null && typeof state.quality_evaluation !== 'object') {
    state.quality_evaluation = null;
  }

  return state;
}

function ensureSessionDirs(sessionId, options) {
  const safeSessionId = normalizeSafeId(sessionId);
  if (!safeSessionId) {
    throw new Error('invalid session_id');
  }
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const sessionDir = path.join(runtimeRoot, safeSessionId);
  const requestsDir = path.join(sessionDir, 'requests');
  fs.mkdirSync(requestsDir, { recursive: true });
  return { sessionDir, requestsDir };
}

function writeFileAtomic(filePath, content, encoding) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content, encoding || 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function normalizeDossierShape(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dossier = raw;
  const schemaVersion = Number(dossier.schema_version);
  dossier.schema_version = Number.isFinite(schemaVersion) && schemaVersion > 0
    ? Math.floor(schemaVersion)
    : 1;

  if (!dossier.root_request_id) {
    if (dossier.parent_request_id) dossier.root_request_id = dossier.parent_request_id;
    else dossier.root_request_id = dossier.request_id || null;
  }

  if (!dossier.thread_key && dossier.session_id && dossier.root_request_id) {
    dossier.thread_key = makeThreadKey(dossier.session_id, dossier.root_request_id);
  }

  if (!dossier.timestamps || typeof dossier.timestamps !== 'object') {
    dossier.timestamps = {
      created_at: nowIso(),
      updated_at: nowIso()
    };
  }

  ensureSelfImprovementState(dossier);
  return dossier;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeDossierShape(parsed);
  } catch {
    return null;
  }
}

function loadLatestDossier(sessionId, options) {
  const safeSessionId = normalizeSafeId(sessionId);
  if (!safeSessionId) return null;
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  return readJsonIfExists(path.join(runtimeRoot, safeSessionId, 'latest.json'));
}

function loadRequestDossier(sessionId, requestId, options) {
  const safeSessionId = normalizeSafeId(sessionId);
  const safeRequestId = normalizeSafeId(requestId);
  if (!safeSessionId || !safeRequestId) return null;
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  return readJsonIfExists(path.join(runtimeRoot, safeSessionId, 'requests', `${safeRequestId}.json`));
}

function isSameConversation(dossier, chatId, threadOrTopicId) {
  if (!dossier || chatId == null) return false;

  const dossierChat = normalizeConversationPart(dossier.chat_id);
  const dossierThread = normalizeConversationPart(dossier.thread_or_topic_id);
  const targetChat = normalizeConversationPart(chatId);
  const targetThread = normalizeConversationPart(threadOrTopicId);

  if (!targetChat || dossierChat !== targetChat) {
    return false;
  }

  if (targetThread == null) {
    return dossierThread == null;
  }

  return dossierThread === targetThread;
}

function loadLatestDossierForConversation(chatId, threadOrTopicId, options) {
  const targetChat = normalizeConversationPart(chatId);
  if (!targetChat) return null;

  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  if (!fs.existsSync(runtimeRoot)) return null;

  const maxAgeMs = Number(options?.maxAgeMs);
  const hasAgeLimit = Number.isFinite(maxAgeMs) && maxAgeMs > 0;

  let latest = null;
  let latestTs = Number.NEGATIVE_INFINITY;

  const sessions = fs.readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const sessionName of sessions) {
    const candidate = readJsonIfExists(path.join(runtimeRoot, sessionName, 'latest.json'));
    if (!candidate || !isSameConversation(candidate, targetChat, threadOrTopicId)) {
      continue;
    }

    const ts = Date.parse(String(
      candidate?.timestamps?.updated_at ||
      candidate?.timestamps?.created_at ||
      ''
    ));
    const sortableTs = Number.isFinite(ts) ? ts : 0;
    if (sortableTs > latestTs) {
      latest = candidate;
      latestTs = sortableTs;
    }
  }

  if (!latest) return null;

  if (hasAgeLimit && Number.isFinite(latestTs)) {
    const age = Date.now() - latestTs;
    if (age > maxAgeMs) {
      return null;
    }
  }

  return latest;
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
  const rootRequestId = parent
    ? (parent.root_request_id || parent.request_id || requestId)
    : requestId;

  const retryBase = Number(parent?.context?.retry_count || 0);
  const retryCount = inferredFollowUp ? retryBase + 1 : 0;

  const dossier = {
    schema_version: DOSSIER_SCHEMA_VERSION,
    request_id: requestId,
    parent_request_id: parentRequestId,
    root_request_id: rootRequestId,
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
    self_improvement: {
      telemetry: {
        intent: opts.intent || 'general_or_non_frc',
        route: opts.route || 'unclassified',
        execution_plan: [],
        status_markers: [],
        total_elapsed_ms: null,
        worker_count: 0,
        retrieval_source_count: 0,
        answer_mode: 'direct_answer',
        checker_status: null
      },
      quality_evaluation: null,
      outcome: {
        label: 'unknown',
        source: 'system',
        note: null,
        recorded_at: null
      }
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

function setExecutionPlanTelemetry(dossier, executionPlan) {
  if (!dossier) return dossier;
  const state = ensureSelfImprovementState(dossier);
  state.telemetry.execution_plan = asArray(executionPlan).map((x) => String(x)).slice(0, 32);
  state.telemetry.intent = String(dossier.intent || state.telemetry.intent || 'general_or_non_frc');
  state.telemetry.route = String(dossier.route || state.telemetry.route || 'unclassified');
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

  if (worker === 'coach_evaluator') {
    applyQualityEvaluation(dossier, normalizedResult);
  }

  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function attachParentDossier(dossier, parentDossier, options) {
  if (!dossier || !parentDossier) return dossier;

  const opts = options || {};
  dossier.parent_request_id = parentDossier.request_id || dossier.parent_request_id;
  dossier.root_request_id = parentDossier.root_request_id || parentDossier.request_id || dossier.root_request_id;
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

function finalizeSelfImprovementTelemetry(dossier, options) {
  if (!dossier) return dossier;
  const opts = options || {};
  const state = ensureSelfImprovementState(dossier);
  const stageTimes = dossier.elapsed_time_ms_by_stage || {};
  const totalStageMs = Object.values(stageTimes).reduce((sum, value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? sum + n : sum;
  }, 0);

  const fromTimestamps = durationMsFromIso(dossier?.timestamps?.created_at, dossier?.timestamps?.updated_at);
  state.telemetry.total_elapsed_ms = totalStageMs > 0 ? totalStageMs : fromTimestamps;
  state.telemetry.worker_count = asArray(dossier.worker_trace).length;
  state.telemetry.retrieval_source_count = asArray(dossier.retrieval_sources).length;
  state.telemetry.answer_mode = String(dossier.answer_mode || resolveAnswerMode(dossier));
  state.telemetry.intent = String(dossier.intent || state.telemetry.intent || 'general_or_non_frc');
  state.telemetry.route = String(dossier.route || state.telemetry.route || 'unclassified');
  state.telemetry.status_markers = asArray(opts.statusMarkers || state.telemetry.status_markers).map((x) => String(x));

  const checkerOverall = dossier?.worker_outputs?.checker?.overall_status;
  state.telemetry.checker_status = checkerOverall ? String(checkerOverall) : state.telemetry.checker_status || null;

  return dossier;
}

function applyQualityEvaluation(dossier, evaluation) {
  if (!dossier || !evaluation || typeof evaluation !== 'object') return dossier;
  const state = ensureSelfImprovementState(dossier);

  const incomingScores = evaluation.scores && typeof evaluation.scores === 'object'
    ? evaluation.scores
    : {};

  const safeScore = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return Math.round(n);
  };

  const overall = safeScore(evaluation.overall_score ?? incomingScores.overall);
  state.quality_evaluation = {
    worker: 'coach_evaluator',
    at: nowIso(),
    summary: asText(evaluation.summary || '').slice(0, 400),
    confidence: evaluation.confidence ? String(evaluation.confidence) : null,
    scores: {
      overall,
      correctness: safeScore(incomingScores.correctness),
      safety: safeScore(incomingScores.safety),
      teaching: safeScore(incomingScores.teaching),
      evidence: safeScore(incomingScores.evidence)
    },
    flags: asArray(evaluation.flags).map((x) => String(x)).slice(0, 24),
    recommendations: asArray(evaluation.recommendations).map((x) => String(x)).slice(0, 24),
    metrics: evaluation.metrics && typeof evaluation.metrics === 'object'
      ? evaluation.metrics
      : {}
  };

  dossier.timestamps = dossier.timestamps || {};
  dossier.timestamps.updated_at = nowIso();
  return dossier;
}

function setOutcomeLabel(dossier, label, options) {
  if (!dossier) return dossier;
  const opts = options || {};
  const state = ensureSelfImprovementState(dossier);
  const normalizedLabel = normalizeOutcomeLabel(label);
  const normalizedSource = normalizeOutcomeSource(opts.source);

  state.outcome = {
    label: normalizedLabel,
    source: normalizedSource,
    note: opts.note == null ? null : String(opts.note).slice(0, 300),
    recorded_at: nowIso()
  };

  noteHumanEvent(dossier, 'outcome', `${normalizedLabel} via ${normalizedSource}`);
  return dossier;
}

function finalizeDossier(dossier) {
  if (!dossier) return dossier;
  dossier.answer_mode = resolveAnswerMode(dossier);

  if (!dossier.final_status || dossier.final_status === 'in_progress') {
    dossier.final_status = dossier.answer_mode === 'guarded_answer' ? 'guarded' : 'success';
  }

  dossier.stage_status = dossier.stage_status || {};
  dossier.stage_status.finalize = 'completed';

  finalizeSelfImprovementTelemetry(dossier);
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

  const qualityOverall = d.self_improvement?.quality_evaluation?.scores?.overall;
  const qualityText = qualityOverall == null ? 'n/a' : String(qualityOverall);
  const outcomeLabel = d.self_improvement?.outcome?.label || 'unknown';
  const outcomeSource = d.self_improvement?.outcome?.source || 'system';

  return [
    `# Request ${d.request_id || 'unknown'}`,
    `- intent: ${d.intent || 'unknown'}`,
    `- parent: ${d.parent_request_id || 'none'}`,
    `- workers: ${workers.join(', ') || 'none'}`,
    `- answer mode: ${d.answer_mode || resolveAnswerMode(d)}`,
    `- state: ${keyState.join('; ') || 'none'}`,
    `- quality overall: ${qualityText}`,
    `- outcome: ${outcomeLabel} (${outcomeSource})`
  ].join('\n');
}

function findRequestJsonPath(requestId, runtimeRoot) {
  const root = runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const safeRequestId = normalizeSafeId(requestId);
  if (!safeRequestId || !fs.existsSync(root)) return null;

  const sessions = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const sessionName of sessions) {
    const jsonPath = path.join(root, sessionName, 'requests', `${safeRequestId}.json`);
    if (fs.existsSync(jsonPath)) {
      return {
        sessionId: sessionName,
        path: jsonPath
      };
    }
  }

  return null;
}

function loadRequestDossierById(requestId, options) {
  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const located = findRequestJsonPath(requestId, runtimeRoot);
  if (!located) return null;
  return readJsonIfExists(located.path);
}

function findRequestMarkdownPath(requestId, runtimeRoot) {
  const root = runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const safeRequestId = normalizeSafeId(requestId);
  if (!safeRequestId || !fs.existsSync(root)) return null;

  const sessions = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const sessionName of sessions) {
    const mdPath = path.join(root, sessionName, 'requests', `${safeRequestId}.md`);
    if (fs.existsSync(mdPath)) {
      return mdPath;
    }
  }

  return null;
}

function writeHumanDossierNote(requestId, note, options) {
  const safeRequestId = normalizeSafeId(requestId);
  if (!safeRequestId) return false;

  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const sessionId = options?.sessionId || null;
  const safeSessionId = sessionId ? normalizeSafeId(sessionId) : null;

  let requestNotePath = null;
  if (sessionId) {
    if (!safeSessionId) return false;
    requestNotePath = path.join(runtimeRoot, safeSessionId, 'requests', `${safeRequestId}.md`);
  } else {
    requestNotePath = findRequestMarkdownPath(safeRequestId, runtimeRoot);
  }

  if (!requestNotePath) return false;

  writeFileAtomic(requestNotePath, String(note || ''), 'utf8');
  return true;
}

function saveDossier(dossier, options) {
  if (!dossier || typeof dossier !== 'object') {
    throw new Error('saveDossier requires a dossier object');
  }

  if (!dossier.session_id || !dossier.request_id) {
    throw new Error('dossier.session_id and dossier.request_id are required');
  }
  if (!normalizeSafeId(dossier.session_id) || !normalizeSafeId(dossier.request_id)) {
    throw new Error('invalid dossier id(s)');
  }

  const runtimeRoot = options?.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const { sessionDir, requestsDir } = ensureSessionDirs(dossier.session_id, { runtimeRoot });

  dossier.schema_version = DOSSIER_SCHEMA_VERSION;
  if (!dossier.root_request_id) dossier.root_request_id = dossier.parent_request_id || dossier.request_id;
  dossier.answer_mode = resolveAnswerMode(dossier);
  ensureSelfImprovementState(dossier);
  finalizeSelfImprovementTelemetry(dossier);
  dossier.timestamps = dossier.timestamps || {};
  if (!dossier.timestamps.created_at) dossier.timestamps.created_at = nowIso();
  dossier.timestamps.updated_at = nowIso();

  if (!dossier.human_dossier_note) {
    dossier.human_dossier_note = renderHumanDossierNote(dossier);
  }

  const json = JSON.stringify(dossier, null, 2);
  const note = String(dossier.human_dossier_note || renderHumanDossierNote(dossier));

  writeFileAtomic(path.join(requestsDir, `${dossier.request_id}.json`), json, 'utf8');
  writeFileAtomic(path.join(requestsDir, `${dossier.request_id}.md`), note, 'utf8');
  writeFileAtomic(path.join(sessionDir, 'latest.json'), json, 'utf8');
  writeFileAtomic(path.join(sessionDir, 'latest.md'), note, 'utf8');

  return dossier;
}

function updateOutcomeLabel(requestId, label, options) {
  const opts = options || {};
  const safeRequestId = normalizeSafeId(requestId);
  if (!safeRequestId) return null;
  const runtimeRoot = opts.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  let sessionId = opts.sessionId || null;
  if (sessionId && !normalizeSafeId(sessionId)) return null;
  let dossier = null;

  if (sessionId) {
    dossier = loadRequestDossier(sessionId, safeRequestId, { runtimeRoot });
  }

  if (!dossier) {
    const located = findRequestJsonPath(safeRequestId, runtimeRoot);
    if (!located) return null;
    sessionId = located.sessionId;
    dossier = readJsonIfExists(located.path);
  }

  if (!dossier) return null;

  setOutcomeLabel(dossier, label, {
    source: opts.source,
    note: opts.note
  });

  saveDossier(dossier, { runtimeRoot });
  return dossier;
}

module.exports = {
  DEFAULT_RUNTIME_ROOT,
  DOSSIER_SCHEMA_VERSION,
  OUTCOME_LABELS,
  OUTCOME_SOURCES,
  asArray,
  asText,
  makeRequestId,
  makeSessionId,
  makeThreadKey,
  ensureSelfImprovementState,
  createInitialDossier,
  noteStageStatus,
  noteHumanEvent,
  setExecutionPlanTelemetry,
  mergeTelemetry,
  recordWorkerOutput,
  attachParentDossier,
  markGuarded,
  markReviewCompleted,
  markEscalated,
  applyQualityEvaluation,
  setOutcomeLabel,
  updateOutcomeLabel,
  resolveAnswerMode,
  finalizeSelfImprovementTelemetry,
  finalizeDossier,
  renderHumanDossierNote,
  saveDossier,
  loadLatestDossier,
  loadRequestDossier,
  loadRequestDossierById,
  loadLatestDossierForConversation,
  writeHumanDossierNote,
  looksLikeFollowUp,
  isSameConversation
};
