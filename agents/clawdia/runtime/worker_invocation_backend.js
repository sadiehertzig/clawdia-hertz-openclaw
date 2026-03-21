'use strict';

const SPAWN_ELIGIBLE_WORKERS = new Set(['builder', 'arbiter', 'deepdebug']);
const VALID_MODES = new Set(['hybrid', 'spawn_only', 'local_only']);

const DEFAULT_MODEL_STRATEGY = {
  clawdia: 'anthropic/claude-sonnet-4-6',
  patternscout: 'in_process',
  librarian: 'openai/gpt-5.4',
  builder: 'openai/gpt-5.3-codex',
  checker: 'openai/gpt-5.4',
  arbiter: 'openai/gpt-5.4-pro',
  deepdebug: 'anthropic/claude-opus-4-6'
};

function normalizeWorkerInvocationMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (VALID_MODES.has(normalized)) return normalized;
  return 'local_only';
}

function resolveWorkerInvocationMode(inputMode, runtimeCtx) {
  const ctx = runtimeCtx || {};
  const envMode = process.env.HELPDESK_WORKER_INVOCATION_MODE;
  return normalizeWorkerInvocationMode(
    inputMode ||
    ctx.workerInvocationMode ||
    ctx.worker_invocation_mode ||
    envMode
  );
}

function shouldAttemptSpawn(worker, options) {
  const opts = options || {};
  if (!SPAWN_ELIGIBLE_WORKERS.has(worker)) return false;
  return Boolean(opts.substantiveFlow);
}

function spawnHandler(worker, runtimeCtx) {
  const ctx = runtimeCtx || {};

  if (typeof ctx.invokeSpawnedWorker === 'function') {
    return (payload) => ctx.invokeSpawnedWorker(worker, payload);
  }

  if (ctx.spawnWorkerHandlers && typeof ctx.spawnWorkerHandlers[worker] === 'function') {
    return ctx.spawnWorkerHandlers[worker];
  }

  if (ctx.spawnedWorkerHandlers && typeof ctx.spawnedWorkerHandlers[worker] === 'function') {
    return ctx.spawnedWorkerHandlers[worker];
  }

  return null;
}

function isSpawnWorkerAvailable(worker, runtimeCtx) {
  const ctx = runtimeCtx || {};
  if (typeof ctx.isSpawnWorkerAvailable === 'function') {
    return Boolean(ctx.isSpawnWorkerAvailable(worker));
  }

  if (ctx.spawnWorkers && typeof ctx.spawnWorkers === 'object' && worker in ctx.spawnWorkers) {
    return Boolean(ctx.spawnWorkers[worker]);
  }

  return typeof spawnHandler(worker, ctx) === 'function';
}

function extractSpawnSessionId(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw.spawn_session_id || raw.worker_session_id || raw.session_id || raw?.telemetry_hints?.session_id;
  if (!candidate) return null;
  return String(candidate);
}

function rawIsError(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return raw.status === 'error' || Boolean(raw.error);
}

function stringifyReason(reason, fallback) {
  const text = String(reason || '').trim();
  return text || fallback;
}

function spawnFailureReason(raw, err) {
  if (err) {
    return stringifyReason(err.message, 'spawn_exception');
  }
  if (raw && typeof raw === 'object') {
    const fromFallback = raw.fallback_reason || raw.reason;
    if (fromFallback) return stringifyReason(fromFallback, 'spawn_failed');
    if (raw.error && typeof raw.error === 'object') {
      return stringifyReason(raw.error.message, 'spawn_failed');
    }
    return stringifyReason(raw.summary, 'spawn_failed');
  }
  return 'spawn_failed';
}

function buildSpawnFailure(worker, payload, reason) {
  return {
    request_id: payload?.request_id || null,
    status: 'error',
    kind: 'spawn_failure',
    summary: `${worker} spawn failed`,
    warnings: [String(reason || 'spawn_failed')],
    error: { message: String(reason || 'spawn_failed') },
    fallback_reason: String(reason || 'spawn_failed')
  };
}

function resolveServingModel(worker, runtimeCtx) {
  const ctx = runtimeCtx || {};
  const map = ctx.modelStrategyByWorker || ctx.modelStrategy || ctx.model_map || {};
  const explicit = map && typeof map === 'object' ? map[worker] : null;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  if (explicit && typeof explicit === 'object' && typeof explicit.primary === 'string' && explicit.primary.trim()) {
    return explicit.primary.trim();
  }
  return DEFAULT_MODEL_STRATEGY[worker] || null;
}

function invokeWorker(options) {
  const opts = options || {};
  const mode = resolveWorkerInvocationMode(opts.mode, opts.runtimeCtx);
  const worker = String(opts.worker || '');
  const payload = opts.payload || {};
  const ctx = opts.runtimeCtx || {};
  const callLocalWorker = opts.callLocalWorker;

  if (typeof callLocalWorker !== 'function') {
    throw new Error('invokeWorker requires callLocalWorker(worker, payload, runtimeCtx)');
  }

  const spawnRequested = mode !== 'local_only' && shouldAttemptSpawn(worker, {
    substantiveFlow: opts.substantiveFlow
  });

  if (!spawnRequested) {
    return {
      mode,
      backend: 'local',
      sessionId: null,
      fallbackReason: null,
      raw: callLocalWorker(worker, payload, ctx)
    };
  }

  const available = isSpawnWorkerAvailable(worker, ctx);
  const handler = spawnHandler(worker, ctx);

  if (!available || typeof handler !== 'function') {
    const reason = 'spawn_unavailable';
    if (mode === 'spawn_only') {
      return {
        mode,
        backend: 'spawned',
        sessionId: null,
        fallbackReason: reason,
        raw: buildSpawnFailure(worker, payload, reason)
      };
    }
    return {
      mode,
      backend: 'local',
      sessionId: null,
      fallbackReason: reason,
      raw: callLocalWorker(worker, payload, ctx)
    };
  }

  let spawnedRaw = null;
  let spawnedErr = null;
  try {
    spawnedRaw = handler(payload);
  } catch (err) {
    spawnedErr = err;
  }

  if (!spawnedErr && !rawIsError(spawnedRaw)) {
    return {
      mode,
      backend: 'spawned',
      sessionId: extractSpawnSessionId(spawnedRaw),
      fallbackReason: null,
      raw: spawnedRaw
    };
  }

  const reason = spawnFailureReason(spawnedRaw, spawnedErr);
  if (mode === 'spawn_only') {
    return {
      mode,
      backend: 'spawned',
      sessionId: extractSpawnSessionId(spawnedRaw),
      fallbackReason: reason,
      raw: buildSpawnFailure(worker, payload, reason)
    };
  }

  return {
    mode,
    backend: 'local',
    sessionId: null,
    fallbackReason: reason,
    raw: callLocalWorker(worker, payload, ctx)
  };
}

module.exports = {
  SPAWN_ELIGIBLE_WORKERS,
  VALID_MODES,
  DEFAULT_MODEL_STRATEGY,
  normalizeWorkerInvocationMode,
  resolveWorkerInvocationMode,
  shouldAttemptSpawn,
  isSpawnWorkerAvailable,
  resolveServingModel,
  invokeWorker
};
