#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const orchestrator = require('../agents/clawdia/runtime/helpdesk_orchestrator');
const invocationBackend = require('../agents/clawdia/runtime/worker_invocation_backend');

const DEFAULT_RUNTIME_ROOT = path.resolve(__dirname, '..', 'runtime_state', 'dossiers', 'sessions');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'ops', 'baselines');

function parseArgs(argv) {
  const args = {
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    outputDir: DEFAULT_OUTPUT_DIR,
    lookbackHours: 72
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--runtime-root') args.runtimeRoot = path.resolve(argv[++i]);
    if (token === '--output-dir') args.outputDir = path.resolve(argv[++i]);
    if (token === '--lookback-hours') args.lookbackHours = Number(argv[++i]);
  }

  if (!Number.isFinite(args.lookbackHours) || args.lookbackHours < 0) args.lookbackHours = 72;
  return args;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listRequestJsonFiles(runtimeRoot) {
  if (!fs.existsSync(runtimeRoot)) return [];
  const out = [];
  const sessions = fs.readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const session of sessions) {
    const requestDir = path.join(runtimeRoot, session, 'requests');
    if (!fs.existsSync(requestDir)) continue;
    const requestFiles = fs.readdirSync(requestDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(requestDir, entry.name));
    out.push(...requestFiles);
  }

  return out;
}

function dossierTimestampMs(dossier) {
  const updated = Date.parse(String(dossier?.timestamps?.updated_at || ''));
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(String(dossier?.timestamps?.created_at || ''));
  if (Number.isFinite(created)) return created;
  return 0;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function reviewTruthViolation(dossier) {
  const reviewedMode = String(dossier?.answer_mode || '').toLowerCase() === 'reviewed_answer';
  const reviewCompleted = dossier?.review_state?.review_completed === true;
  return reviewedMode && !reviewCompleted;
}

function captureBaseline(options) {
  const opts = options || {};
  const runtimeRoot = opts.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const lookbackHours = Number.isFinite(Number(opts.lookbackHours)) ? Number(opts.lookbackHours) : 72;
  const cutoff = Date.now() - (lookbackHours * 60 * 60 * 1000);
  const files = listRequestJsonFiles(runtimeRoot);
  const dossiers = [];

  for (const filePath of files) {
    const dossier = readJson(filePath);
    if (!dossier) continue;
    const ts = dossierTimestampMs(dossier);
    if (lookbackHours > 0 && ts > 0 && ts < cutoff) continue;
    dossiers.push(dossier);
  }

  let guardedCount = 0;
  let fallbackOrErrorCount = 0;
  let reviewTruthViolations = 0;
  let delegationTotal = 0;
  let delegationSpawned = 0;
  const elapsedTotals = [];

  for (const dossier of dossiers) {
    if (dossier?.review_state?.guarded === true || String(dossier?.answer_mode || '').toLowerCase() === 'guarded_answer') {
      guardedCount += 1;
    }
    if ((Array.isArray(dossier?.fallback_events) && dossier.fallback_events.length > 0) ||
        (Array.isArray(dossier?.worker_trace) && dossier.worker_trace.some((x) => x && x.status === 'error' && !x.skipped))) {
      fallbackOrErrorCount += 1;
    }
    if (reviewTruthViolation(dossier)) {
      reviewTruthViolations += 1;
    }

    const backends = dossier?.worker_backend_by_stage && typeof dossier.worker_backend_by_stage === 'object'
      ? dossier.worker_backend_by_stage
      : {};
    for (const [stage, backend] of Object.entries(backends)) {
      if (stage === 'coach_evaluator') continue;
      const normalized = String(backend || '').toLowerCase();
      if (normalized === 'none' || !normalized) continue;
      delegationTotal += 1;
      if (normalized === 'spawned') delegationSpawned += 1;
    }

    const totalElapsed = Number(dossier?.self_improvement?.telemetry?.total_elapsed_ms);
    if (Number.isFinite(totalElapsed) && totalElapsed >= 0) {
      elapsedTotals.push(totalElapsed);
    }
  }

  const workers = ['patternscout', 'librarian', 'builder', 'checker', 'arbiter', 'deepdebug', 'coach_evaluator'];
  const workerAvailability = {};
  for (const worker of workers) {
    workerAvailability[worker] = orchestrator.isWorkerAvailable(worker, {});
  }

  return {
    generated_at: new Date().toISOString(),
    lookback_hours: lookbackHours,
    baseline_window_request_count: dossiers.length,
    runtime_snapshot: {
      worker_invocation_mode_default: invocationBackend.resolveWorkerInvocationMode(null, {}),
      worker_availability: workerAvailability,
      model_strategy_by_worker: invocationBackend.DEFAULT_MODEL_STRATEGY,
      rollout_rollback_toggle: 'worker_invocation_mode=local_only + guarded enforcement'
    },
    baseline_metrics: {
      delegation_usage_percent: delegationTotal > 0 ? Math.round((delegationSpawned / delegationTotal) * 1000) / 10 : 0,
      guarded_rate_percent: dossiers.length > 0 ? Math.round((guardedCount / dossiers.length) * 1000) / 10 : 0,
      fallback_or_error_rate_percent: dossiers.length > 0 ? Math.round((fallbackOrErrorCount / dossiers.length) * 1000) / 10 : 0,
      review_truth_violations: reviewTruthViolations,
      latency_ms: {
        p50: percentile(elapsedTotals, 50),
        p95: percentile(elapsedTotals, 95)
      },
      cost_per_request_usd: null
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outputDir, { recursive: true });
  const snapshot = captureBaseline(args);
  const timestamp = new Date().toISOString().replace(/[:]/g, '-');
  const outPath = path.join(args.outputDir, `helpdesk-baseline-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  process.stdout.write(JSON.stringify({ output: outPath, requests: snapshot.baseline_window_request_count }, null, 2) + '\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  captureBaseline
};
