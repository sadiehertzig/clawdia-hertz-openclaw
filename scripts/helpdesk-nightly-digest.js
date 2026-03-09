#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { learnPatternScoutWeights } = require('./patternscout-learn');
const { buildPatternCards } = require('./patternscout-build-cards');

const DEFAULT_RUNTIME_ROOT = path.resolve(__dirname, '..', 'runtime_state', 'dossiers', 'sessions');
const DEFAULT_REPORT_PATH = path.resolve(__dirname, '..', 'docs', 'audits', 'helpdesk-nightly-digest.md');
const DEFAULT_BACKLOG_PATH = path.resolve(__dirname, '..', 'docs', 'audits', 'helpdesk-regression-backlog.md');
const DEFAULT_FAILURE_DIR = path.resolve(__dirname, '..', 'docs', 'audits', 'failures');
const DEFAULT_PATTERNSCOUT_WEIGHTS_PATH = path.resolve(__dirname, '..', 'runtime_state', 'patternscout', 'source_weights.json');
const DEFAULT_PATTERNSCOUT_CARDS_PATH = path.resolve(__dirname, '..', 'runtime_state', 'patternscout', 'pattern_cards.json');

function parseArgs(argv) {
  const args = {
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    reportPath: DEFAULT_REPORT_PATH,
    backlogPath: DEFAULT_BACKLOG_PATH,
    failureDir: DEFAULT_FAILURE_DIR,
    lookbackHours: 24,
    maxFailures: 20,
    patternscoutLearning: true,
    patternscoutWeightsPath: DEFAULT_PATTERNSCOUT_WEIGHTS_PATH,
    patternscoutCardsPath: DEFAULT_PATTERNSCOUT_CARDS_PATH
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--runtime-root') args.runtimeRoot = path.resolve(argv[++i]);
    if (token === '--report-path') args.reportPath = path.resolve(argv[++i]);
    if (token === '--backlog-path') args.backlogPath = path.resolve(argv[++i]);
    if (token === '--failure-dir') args.failureDir = path.resolve(argv[++i]);
    if (token === '--lookback-hours') args.lookbackHours = Number(argv[++i]);
    if (token === '--max-failures') args.maxFailures = Number(argv[++i]);
    if (token === '--patternscout-weights-path') args.patternscoutWeightsPath = path.resolve(argv[++i]);
    if (token === '--patternscout-cards-path') args.patternscoutCardsPath = path.resolve(argv[++i]);
    if (token === '--skip-patternscout-learning') args.patternscoutLearning = false;
  }

  if (!Number.isFinite(args.lookbackHours) || args.lookbackHours < 0) args.lookbackHours = 24;
  if (!Number.isFinite(args.maxFailures) || args.maxFailures < 1) args.maxFailures = 20;
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function inc(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function listRequestJsonFiles(runtimeRoot) {
  if (!fs.existsSync(runtimeRoot)) return [];
  const out = [];

  const sessions = fs.readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const sessionId of sessions) {
    const requestDir = path.join(runtimeRoot, sessionId, 'requests');
    if (!fs.existsSync(requestDir)) continue;
    const files = fs.readdirSync(requestDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(requestDir, entry.name));
    out.push(...files);
  }

  return out;
}

function dossierTimestampMs(dossier) {
  const t = dossier?.timestamps || {};
  const updated = Date.parse(String(t.updated_at || ''));
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(String(t.created_at || ''));
  if (Number.isFinite(created)) return created;
  return 0;
}

function normalizedOutcomeLabel(dossier) {
  return String(dossier?.self_improvement?.outcome?.label || 'unknown').toLowerCase();
}

function qualityScore(dossier) {
  const fromSelf = Number(dossier?.self_improvement?.quality_evaluation?.scores?.overall);
  if (Number.isFinite(fromSelf)) return fromSelf;
  const fromWorker = Number(dossier?.worker_outputs?.coach_evaluator?.overall_score);
  if (Number.isFinite(fromWorker)) return fromWorker;
  return null;
}

function collectFailureReasons(dossier) {
  const reasons = [];
  const outcome = normalizedOutcomeLabel(dossier);
  const checker = String(dossier?.worker_outputs?.checker?.overall_status || '').toLowerCase();
  const guarded = dossier?.review_state?.guarded === true;
  const answerMode = String(dossier?.answer_mode || '').toLowerCase();
  const workerErrors = (Array.isArray(dossier?.worker_trace) ? dossier.worker_trace : [])
    .filter((entry) => entry && entry.status === 'error' && !entry.skipped);

  if (outcome === 'failed' || outcome === 'unsafe') reasons.push(`outcome_${outcome}`);
  if (guarded || answerMode === 'guarded_answer') reasons.push('guarded_answer');
  if (checker === 'failed' || checker === 'fail') reasons.push('checker_failed');
  if (workerErrors.length > 0) reasons.push('worker_error');

  const q = qualityScore(dossier);
  if (Number.isFinite(q) && q < 55) reasons.push('low_quality_score');

  return reasons;
}

function isFailureDossier(dossier) {
  return collectFailureReasons(dossier).length > 0;
}

function buildRegressionTasks(failures) {
  return failures.slice(0, 24).map((item, idx) => {
    const d = item.dossier;
    const reasons = item.reasons.join(', ');
    const prompt = String(d.user_message || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return {
      id: `REG-${String(idx + 1).padStart(3, '0')}`,
      request_id: d.request_id || 'unknown',
      intent: d.intent || 'unknown',
      reasons,
      task: `Reproduce request "${prompt}" and verify the pipeline addresses: ${reasons}.`
    };
  });
}

function writeFailureDossiers(failures, failureDir) {
  const day = new Date().toISOString().slice(0, 10);
  const outDir = path.join(failureDir, day);
  ensureDir(outDir);
  const files = [];

  for (const item of failures) {
    const d = item.dossier;
    const req = d.request_id || `unknown_${Date.now()}`;
    const filePath = path.join(outDir, `${req}.md`);
    const quality = qualityScore(d);
    const content = [
      `# Failure Dossier ${req}`,
      '',
      `- intent: ${d.intent || 'unknown'}`,
      `- answer_mode: ${d.answer_mode || 'unknown'}`,
      `- final_status: ${d.final_status || 'unknown'}`,
      `- outcome: ${normalizedOutcomeLabel(d)} (${d?.self_improvement?.outcome?.source || 'system'})`,
      `- quality_score: ${quality == null ? 'n/a' : quality}`,
      `- reasons: ${item.reasons.join(', ') || 'none'}`,
      '',
      '## User Message',
      '',
      String(d.user_message || '').trim() || '(empty)',
      '',
      '## Evaluator Recommendations',
      '',
      ...(Array.isArray(d?.self_improvement?.quality_evaluation?.recommendations) &&
      d.self_improvement.quality_evaluation.recommendations.length
        ? d.self_improvement.quality_evaluation.recommendations.map((x) => `- ${x}`)
        : ['- none']),
      '',
      '## Worker Trace',
      '',
      ...(Array.isArray(d.worker_trace) && d.worker_trace.length
        ? d.worker_trace.map((entry) => {
            const status = entry.skipped ? 'skipped' : entry.status;
            return `- ${entry.worker}: ${status} - ${String(entry.summary || '').slice(0, 120)}`;
          })
        : ['- none'])
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf8');
    files.push(filePath);
  }

  return files;
}

function renderDigestMarkdown(summary) {
  const lines = [];
  lines.push('# Helpdesk Nightly Digest');
  lines.push('');
  lines.push(`- generated_at: ${summary.generatedAt}`);
  lines.push(`- lookback_hours: ${summary.lookbackHours}`);
  lines.push(`- total_requests: ${summary.totalRequests}`);
  lines.push(`- failure_requests: ${summary.failureCount}`);
  lines.push(`- average_quality_score: ${summary.averageQualityScore == null ? 'n/a' : summary.averageQualityScore}`);
  lines.push('');

  lines.push('## Intent Counts');
  lines.push('');
  if (Object.keys(summary.intentCounts).length === 0) {
    lines.push('- none');
  } else {
    Object.entries(summary.intentCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([intent, count]) => lines.push(`- ${intent}: ${count}`));
  }
  lines.push('');

  lines.push('## Answer Mode Counts');
  lines.push('');
  if (Object.keys(summary.answerModeCounts).length === 0) {
    lines.push('- none');
  } else {
    Object.entries(summary.answerModeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([mode, count]) => lines.push(`- ${mode}: ${count}`));
  }
  lines.push('');

  lines.push('## Outcome Counts');
  lines.push('');
  if (Object.keys(summary.outcomeCounts).length === 0) {
    lines.push('- none');
  } else {
    Object.entries(summary.outcomeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, count]) => lines.push(`- ${label}: ${count}`));
  }
  lines.push('');

  lines.push('## Top Failure Reasons');
  lines.push('');
  if (Object.keys(summary.failureReasonCounts).length === 0) {
    lines.push('- none');
  } else {
    Object.entries(summary.failureReasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .forEach(([reason, count]) => lines.push(`- ${reason}: ${count}`));
  }
  lines.push('');

  lines.push('## Lowest Quality Requests');
  lines.push('');
  if (summary.lowQuality.length === 0) {
    lines.push('- none');
  } else {
    summary.lowQuality.forEach((entry) => {
      lines.push(`- ${entry.request_id}: score ${entry.score}, intent ${entry.intent}, outcome ${entry.outcome}`);
    });
  }
  lines.push('');

  lines.push('## Generated Artifacts');
  lines.push('');
  lines.push(`- failure_dossiers_written: ${summary.failureDossiersWritten}`);
  lines.push(`- regression_tasks_written: ${summary.regressionTasksWritten}`);
  if (summary.patternscoutLearning) {
    lines.push(`- patternscout_weighted_repos: ${summary.patternscoutLearning.repoCount}`);
    lines.push(`- patternscout_pattern_cards: ${summary.patternscoutLearning.cardCount}`);
  }

  return lines.join('\n');
}

function renderRegressionBacklog(tasks, generatedAt, lookbackHours) {
  const lines = [];
  lines.push('# Helpdesk Regression Backlog');
  lines.push('');
  lines.push(`- generated_at: ${generatedAt}`);
  lines.push(`- lookback_hours: ${lookbackHours}`);
  lines.push('');

  if (tasks.length === 0) {
    lines.push('- No failure-derived regression tasks for this window.');
    return lines.join('\n');
  }

  for (const task of tasks) {
    lines.push(`## ${task.id}`);
    lines.push(`- request_id: ${task.request_id}`);
    lines.push(`- intent: ${task.intent}`);
    lines.push(`- reasons: ${task.reasons}`);
    lines.push(`- task: ${task.task}`);
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

function generateNightlyDigest(options) {
  const opts = options || {};
  const runtimeRoot = opts.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const reportPath = opts.reportPath || DEFAULT_REPORT_PATH;
  const backlogPath = opts.backlogPath || DEFAULT_BACKLOG_PATH;
  const failureDir = opts.failureDir || DEFAULT_FAILURE_DIR;
  const lookbackHours = Number.isFinite(Number(opts.lookbackHours)) ? Number(opts.lookbackHours) : 24;
  const maxFailures = Number.isFinite(Number(opts.maxFailures)) ? Number(opts.maxFailures) : 20;
  const patternscoutLearning = opts.patternscoutLearning !== false;
  const patternscoutWeightsPath = opts.patternscoutWeightsPath || DEFAULT_PATTERNSCOUT_WEIGHTS_PATH;
  const patternscoutCardsPath = opts.patternscoutCardsPath || DEFAULT_PATTERNSCOUT_CARDS_PATH;
  const generatedAt = new Date().toISOString();
  const cutoff = Date.now() - (lookbackHours * 60 * 60 * 1000);

  const intentCounts = {};
  const answerModeCounts = {};
  const outcomeCounts = {};
  const failureReasonCounts = {};
  const dossiers = [];

  for (const requestPath of listRequestJsonFiles(runtimeRoot)) {
    const dossier = readJson(requestPath);
    if (!dossier) continue;
    const ts = dossierTimestampMs(dossier);
    if (lookbackHours > 0 && ts > 0 && ts < cutoff) continue;
    dossiers.push(dossier);

    inc(intentCounts, String(dossier.intent || 'unknown'));
    inc(answerModeCounts, String(dossier.answer_mode || 'unknown'));
    inc(outcomeCounts, normalizedOutcomeLabel(dossier));
  }

  const failures = dossiers
    .map((d) => ({ dossier: d, reasons: collectFailureReasons(d) }))
    .filter((entry) => entry.reasons.length > 0)
    .sort((a, b) => dossierTimestampMs(b.dossier) - dossierTimestampMs(a.dossier))
    .slice(0, maxFailures);

  for (const failure of failures) {
    for (const reason of failure.reasons) {
      inc(failureReasonCounts, reason);
    }
  }

  const qualityScores = dossiers
    .map((d) => qualityScore(d))
    .filter((n) => Number.isFinite(n));

  const averageQualityScore = qualityScores.length
    ? Math.round((qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length) * 10) / 10
    : null;

  const lowQuality = dossiers
    .map((d) => ({
      request_id: d.request_id || 'unknown',
      intent: d.intent || 'unknown',
      outcome: normalizedOutcomeLabel(d),
      score: qualityScore(d)
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  ensureDir(path.dirname(reportPath));
  ensureDir(path.dirname(backlogPath));
  ensureDir(failureDir);

  const failureFiles = writeFailureDossiers(failures, failureDir);
  const regressionTasks = buildRegressionTasks(failures);
  let patternscoutLearningSummary = null;

  if (patternscoutLearning) {
    try {
      const learned = learnPatternScoutWeights({
        runtimeRoot,
        outputPath: patternscoutWeightsPath,
        lookbackHours: Math.max(lookbackHours, 24 * 7)
      });
      const cards = buildPatternCards({
        runtimeRoot,
        outputPath: patternscoutCardsPath,
        lookbackHours: Math.max(lookbackHours, 24 * 7),
        minQualityScore: 60
      });
      patternscoutLearningSummary = {
        weightsPath: learned.outputPath,
        cardsPath: cards.outputPath,
        repoCount: learned.repoCount,
        cardCount: cards.cardCount
      };
    } catch (err) {
      patternscoutLearningSummary = {
        error: err instanceof Error ? err.message : String(err),
        repoCount: 0,
        cardCount: 0
      };
    }
  }

  const summary = {
    generatedAt,
    lookbackHours,
    totalRequests: dossiers.length,
    failureCount: failures.length,
    averageQualityScore,
    intentCounts,
    answerModeCounts,
    outcomeCounts,
    failureReasonCounts,
    lowQuality,
    failureDossiersWritten: failureFiles.length,
    regressionTasksWritten: regressionTasks.length,
    patternscoutLearning: patternscoutLearningSummary
  };

  fs.writeFileSync(reportPath, renderDigestMarkdown(summary), 'utf8');
  fs.writeFileSync(backlogPath, renderRegressionBacklog(regressionTasks, generatedAt, lookbackHours), 'utf8');

  return {
    summary,
    reportPath,
    backlogPath,
    failureFiles
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const out = generateNightlyDigest(args);
  process.stdout.write(JSON.stringify({
    reportPath: out.reportPath,
    backlogPath: out.backlogPath,
    failureDossiersWritten: out.summary.failureDossiersWritten,
    regressionTasksWritten: out.summary.regressionTasksWritten,
    patternscoutLearning: out.summary.patternscoutLearning,
    totalRequests: out.summary.totalRequests,
    failureCount: out.summary.failureCount
  }, null, 2) + '\n');
}

module.exports = {
  DEFAULT_RUNTIME_ROOT,
  DEFAULT_REPORT_PATH,
  DEFAULT_BACKLOG_PATH,
  DEFAULT_FAILURE_DIR,
  DEFAULT_PATTERNSCOUT_WEIGHTS_PATH,
  DEFAULT_PATTERNSCOUT_CARDS_PATH,
  generateNightlyDigest,
  isFailureDossier,
  collectFailureReasons,
  qualityScore
};
