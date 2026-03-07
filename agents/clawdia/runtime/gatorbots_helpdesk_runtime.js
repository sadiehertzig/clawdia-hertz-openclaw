const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RUNTIME_ROOT = path.resolve(__dirname, '..', '..', '..', 'runtime_state', 'dossiers', 'sessions');

function nowIso() {
  return new Date().toISOString();
}

function sanitizeIdPart(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  const safe = normalized
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return safe || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ensureSessionDirs(sessionId) {
  const sessionDir = path.join(RUNTIME_ROOT, sessionId);
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

function createRequestId() {
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(4).toString('hex');
  return `req_${ts}_${rnd}`;
}

function createSessionId(peerId) {
  const base = sanitizeIdPart(peerId, 'anonymous');
  const hash = crypto.createHash('sha1').update(String(peerId || 'anonymous')).digest('hex').slice(0, 10);
  return `sess_${base}_${hash}`;
}

function createThreadKey(sessionId, rootRequestId) {
  const sid = sanitizeIdPart(sessionId, 'session');
  const rid = sanitizeIdPart(rootRequestId, 'root');
  return `thread_${sid}_${rid}`;
}

function loadLatestDossier(sessionId) {
  if (!sessionId) return null;
  const latestPath = path.join(RUNTIME_ROOT, sessionId, 'latest.json');
  return readJsonIfExists(latestPath);
}

function loadRequestDossier(sessionId, requestId) {
  if (!sessionId || !requestId) return null;
  const requestPath = path.join(RUNTIME_ROOT, sessionId, 'requests', `${requestId}.json`);
  return readJsonIfExists(requestPath);
}

function detectFollowUp(message, latestDossier) {
  if (!latestDossier || !latestDossier.request_id) {
    return {
      is_follow_up: false,
      parent_request_id: null,
      thread_key: null,
      reason: 'no_prior_dossier'
    };
  }

  const text = String(message || '').trim().toLowerCase();
  const patterns = [
    'ok',
    'okay',
    'now',
    'also',
    'add',
    'fix',
    'update',
    'change',
    'use the same',
    'make it'
  ];

  const isFollowUp = patterns.some((p) => {
    return text === p || text.startsWith(`${p} `) || text.includes(` ${p} `) || text.endsWith(` ${p}`);
  });

  if (!isFollowUp) {
    return {
      is_follow_up: false,
      parent_request_id: null,
      thread_key: null,
      reason: 'no_follow_up_pattern'
    };
  }

  return {
    is_follow_up: true,
    parent_request_id: latestDossier.request_id,
    thread_key: latestDossier.thread_key || createThreadKey(latestDossier.session_id, latestDossier.request_id),
    reason: 'pattern_match'
  };
}

function createInitialDossier({ peerId, userMessage, route }) {
  const sessionId = createSessionId(peerId);
  const latest = loadLatestDossier(sessionId);
  const followUp = detectFollowUp(userMessage, latest);
  const requestId = createRequestId();
  const createdAt = nowIso();
  const threadKey = followUp.is_follow_up
    ? followUp.thread_key
    : createThreadKey(sessionId, requestId);

  return {
    request_id: requestId,
    session_id: sessionId,
    parent_request_id: followUp.parent_request_id,
    is_follow_up: followUp.is_follow_up,
    thread_key: threadKey,
    route: route || 'unclassified',
    answer_mode: 'direct_answer',
    user_message: String(userMessage || ''),
    user_goal: String(userMessage || '').trim(),
    context: {
      constraints: [],
      assumptions: [],
      notes: []
    },
    worker_trace: [],
    artifacts: {
      facts: [],
      warnings: [],
      code_blocks: [],
      tests: [],
      changed_after_review: []
    },
    review_state: {
      review_completed: false,
      reviewer: null,
      escalation_completed: false,
      escalation_worker: null
    },
    carry_forward: {
      from_request_id: followUp.parent_request_id,
      summary: followUp.is_follow_up ? 'Continues prior request context.' : 'New request.'
    },
    timestamps: {
      created_at: createdAt,
      updated_at: createdAt
    }
  };
}

function normalizeWorkerResult({ worker, request_id, raw, defaultKind }) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const summary =
    toText(source.summary) ||
    toText(source.message) ||
    toText(source.text) ||
    toText(raw);

  const text = toText(source.text || source.output || source.student_facing_explanation || source.message);

  const reviewed = Boolean(
    source.reviewed ||
      source.review_completed ||
      source.contract_flags?.reviewed ||
      source.verdict
  );

  const escalated = Boolean(
    source.escalated ||
      source.escalation_completed ||
      source.contract_flags?.escalated ||
      source.escalation_reason
  );

  const implementationSafe = source.contract_flags?.implementation_safe;
  const patternOnly = source.contract_flags?.pattern_only;

  return {
    worker: worker || 'unknown_worker',
    status: source.status || (source.error ? 'error' : 'ok'),
    kind: source.kind || defaultKind || 'generic',
    request_id: request_id || source.request_id || null,
    summary,
    content: {
      text,
      code_blocks: asArray(source.code_blocks),
      facts: asArray(source.facts || source.key_apis),
      warnings: asArray(source.warnings || source.concern_list),
      changed_after_review: asArray(source.changed_after_review),
      tests: asArray(source.tests || source.regression_checks)
    },
    contract_flags: {
      reviewed,
      escalated,
      implementation_safe: implementationSafe == null ? true : Boolean(implementationSafe),
      pattern_only: Boolean(patternOnly)
    },
    error: source.error ? toText(source.error) : null,
    raw: raw == null ? null : raw
  };
}

function recordWorkerResult(dossier, result) {
  if (!dossier || typeof dossier !== 'object') return dossier;
  if (!result || typeof result !== 'object') return dossier;

  if (!Array.isArray(dossier.worker_trace)) dossier.worker_trace = [];
  if (!dossier.review_state || typeof dossier.review_state !== 'object') {
    dossier.review_state = {
      review_completed: false,
      reviewer: null,
      escalation_completed: false,
      escalation_worker: null
    };
  }

  const at = nowIso();
  dossier.worker_trace.push({
    at,
    worker: result.worker || 'unknown_worker',
    status: result.status || 'ok',
    kind: result.kind || 'generic',
    summary: toText(result.summary).slice(0, 300),
    reviewed: Boolean(result.contract_flags?.reviewed),
    escalated: Boolean(result.contract_flags?.escalated),
    error: result.error || null
  });

  if (result.contract_flags?.reviewed) {
    dossier.review_state.review_completed = true;
    dossier.review_state.reviewer = result.worker || dossier.review_state.reviewer;
  }

  if (result.contract_flags?.escalated) {
    dossier.review_state.escalation_completed = true;
    dossier.review_state.escalation_worker = result.worker || dossier.review_state.escalation_worker;
  }

  if (!dossier.timestamps || typeof dossier.timestamps !== 'object') dossier.timestamps = {};
  dossier.timestamps.updated_at = at;

  return dossier;
}

function resolveAnswerMode(dossier) {
  const reviewState = dossier?.review_state || {};

  if (reviewState.escalation_completed === true && reviewState.escalation_worker) {
    return 'escalated_answer';
  }

  if (reviewState.review_completed === true && reviewState.reviewer) {
    return 'reviewed_answer';
  }

  return 'direct_answer';
}

function renderHumanDossier(dossier) {
  const d = dossier || {};
  const constraints = asArray(d.context?.constraints);
  const whatHappened = asArray(d.worker_trace)
    .slice(-4)
    .map((entry) => `${entry.worker}: ${entry.summary || entry.status}`)
    .join('; ');

  const carrySummary = toText(d.carry_forward?.summary) || 'None.';

  const lines = [
    `# Request ${d.request_id || 'unknown'}`,
    '',
    `- request: ${toText(d.user_message) || '(empty)'}`,
    `- route: ${d.route || 'unclassified'}`,
    `- answer mode: ${d.answer_mode || resolveAnswerMode(d)}`,
    `- what happened: ${whatHappened || 'No worker activity recorded yet.'}`,
    `- important constraints: ${constraints.length ? constraints.join('; ') : 'None recorded.'}`,
    `- carry-forward summary: ${carrySummary}`
  ];

  return lines.join('\n');
}

function saveDossier(dossier) {
  if (!dossier || typeof dossier !== 'object') {
    throw new Error('saveDossier requires a dossier object');
  }

  if (!dossier.session_id || !dossier.request_id) {
    throw new Error('dossier.session_id and dossier.request_id are required');
  }

  const now = nowIso();
  if (!dossier.timestamps || typeof dossier.timestamps !== 'object') {
    dossier.timestamps = { created_at: now, updated_at: now };
  }
  if (!dossier.timestamps.created_at) dossier.timestamps.created_at = now;
  dossier.timestamps.updated_at = now;

  dossier.answer_mode = resolveAnswerMode(dossier);

  const { sessionDir, requestsDir } = ensureSessionDirs(dossier.session_id);

  const requestJsonPath = path.join(requestsDir, `${dossier.request_id}.json`);
  const requestMdPath = path.join(requestsDir, `${dossier.request_id}.md`);
  const latestJsonPath = path.join(sessionDir, 'latest.json');
  const latestMdPath = path.join(sessionDir, 'latest.md');

  const json = JSON.stringify(dossier, null, 2);
  const md = renderHumanDossier(dossier);

  fs.writeFileSync(requestJsonPath, json, 'utf8');
  fs.writeFileSync(requestMdPath, md, 'utf8');
  fs.writeFileSync(latestJsonPath, json, 'utf8');
  fs.writeFileSync(latestMdPath, md, 'utf8');

  return dossier;
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
  renderHumanDossier
};
