#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRepoId } = require('../agents/clawdia/runtime/patternscout_worker');

const DEFAULT_RUNTIME_ROOT = path.resolve(__dirname, '..', 'runtime_state', 'dossiers', 'sessions');
const DEFAULT_WEIGHTS_PATH = path.resolve(__dirname, '..', 'runtime_state', 'patternscout', 'source_weights.json');

const REWARD_BY_OUTCOME = {
  worked: 2,
  partially_worked: 1,
  failed: -1.5,
  unsafe: -2.5,
  unknown: 0
};

function parseArgs(argv) {
  const args = {
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    outputPath: DEFAULT_WEIGHTS_PATH,
    lookbackHours: 24 * 14,
    minUses: 1,
    minReliableUses: 3,
    minWeight: 0.45,
    maxWeight: 2.2,
    maxDeltaPerRun: 0.35
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--runtime-root') args.runtimeRoot = path.resolve(argv[++i]);
    if (token === '--output-path') args.outputPath = path.resolve(argv[++i]);
    if (token === '--lookback-hours') args.lookbackHours = Number(argv[++i]);
    if (token === '--min-uses') args.minUses = Number(argv[++i]);
    if (token === '--min-reliable-uses') args.minReliableUses = Number(argv[++i]);
    if (token === '--min-weight') args.minWeight = Number(argv[++i]);
    if (token === '--max-weight') args.maxWeight = Number(argv[++i]);
    if (token === '--max-delta') args.maxDeltaPerRun = Number(argv[++i]);
  }

  if (!Number.isFinite(args.lookbackHours) || args.lookbackHours < 0) args.lookbackHours = 24 * 14;
  if (!Number.isFinite(args.minUses) || args.minUses < 1) args.minUses = 1;
  if (!Number.isFinite(args.minReliableUses) || args.minReliableUses < 1) args.minReliableUses = 3;
  if (!Number.isFinite(args.minWeight) || args.minWeight <= 0) args.minWeight = 0.45;
  if (!Number.isFinite(args.maxWeight) || args.maxWeight <= args.minWeight) args.maxWeight = 2.2;
  if (!Number.isFinite(args.maxDeltaPerRun) || args.maxDeltaPerRun <= 0) args.maxDeltaPerRun = 0.35;
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
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
  const updated = Date.parse(String(dossier?.timestamps?.updated_at || ''));
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(String(dossier?.timestamps?.created_at || ''));
  if (Number.isFinite(created)) return created;
  return 0;
}

function getOutcomeLabel(dossier) {
  const label = String(dossier?.self_improvement?.outcome?.label || 'unknown').toLowerCase();
  return Object.prototype.hasOwnProperty.call(REWARD_BY_OUTCOME, label) ? label : 'unknown';
}

function extractReposFromPatternScout(dossier) {
  const matches = Array.isArray(dossier?.worker_outputs?.patternscout?.matches)
    ? dossier.worker_outputs.patternscout.matches
    : [];

  const repos = new Set();
  for (const match of matches) {
    const candidate = normalizeRepoId(match?.repo || match?.source_id || '');
    if (!candidate) continue;
    if (candidate === 'workspace' || candidate === 'docs_memory' || candidate === 'official_examples') continue;
    repos.add(candidate);
  }

  return Array.from(repos);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateWeight(stats, options) {
  const opts = options || {};
  const uses = Math.max(1, Number(stats.uses || 0));
  const worked = Number(stats.worked || 0);
  const partiallyWorked = Number(stats.partially_worked || 0);
  const failed = Number(stats.failed || 0);
  const unsafe = Number(stats.unsafe || 0);
  const avgReward = Number(stats.reward_sum || 0) / uses;

  const priorUses = 4;
  const priorSuccess = 0.55;
  const successRate = (worked + partiallyWorked * 0.5 + priorSuccess * priorUses) / (uses + priorUses);
  const riskRate = (failed + unsafe + 0.5) / (uses + priorUses);

  const raw = 1 + avgReward * 0.22 + successRate * 0.28 - riskRate * 0.22;
  const bounded = clamp(raw, Number(opts.minWeight || 0.45), Number(opts.maxWeight || 2.2));
  const reliability = clamp(uses / Math.max(1, Number(opts.minReliableUses || 3)), 0, 1);
  const smoothed = 1 + (bounded - 1) * reliability;
  return Math.round(smoothed * 1000) / 1000;
}

function learnPatternScoutWeights(options) {
  const opts = options || {};
  const runtimeRoot = opts.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const outputPath = opts.outputPath || DEFAULT_WEIGHTS_PATH;
  const lookbackHours = Number.isFinite(Number(opts.lookbackHours)) ? Number(opts.lookbackHours) : 24 * 14;
  const minUses = Number.isFinite(Number(opts.minUses)) ? Number(opts.minUses) : 1;
  const minReliableUses = Number.isFinite(Number(opts.minReliableUses)) ? Number(opts.minReliableUses) : 3;
  const minWeight = Number.isFinite(Number(opts.minWeight)) ? Number(opts.minWeight) : 0.45;
  const maxWeight = Number.isFinite(Number(opts.maxWeight)) ? Number(opts.maxWeight) : 2.2;
  const maxDeltaPerRun = Number.isFinite(Number(opts.maxDeltaPerRun)) ? Number(opts.maxDeltaPerRun) : 0.35;
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  const previous = readJson(outputPath, { repo_weights: {} });
  const previousWeights = previous?.repo_weights && typeof previous.repo_weights === 'object'
    ? previous.repo_weights
    : {};

  const files = listRequestJsonFiles(runtimeRoot);
  const stats = new Map();
  let dossiersAnalyzed = 0;
  let dossiersUsed = 0;

  for (const requestFile of files) {
    const dossier = readJson(requestFile, null);
    if (!dossier) continue;
    dossiersAnalyzed += 1;

    const ts = dossierTimestampMs(dossier);
    if (lookbackHours > 0 && ts > 0 && ts < cutoff) continue;

    const repos = extractReposFromPatternScout(dossier);
    if (repos.length === 0) continue;

    const outcome = getOutcomeLabel(dossier);
    const reward = REWARD_BY_OUTCOME[outcome] || 0;
    dossiersUsed += 1;

    for (const repoId of repos) {
      if (!stats.has(repoId)) {
        stats.set(repoId, {
          uses: 0,
          worked: 0,
          partially_worked: 0,
          failed: 0,
          unsafe: 0,
          unknown: 0,
          reward_sum: 0
        });
      }
      const row = stats.get(repoId);
      row.uses += 1;
      row[outcome] = (row[outcome] || 0) + 1;
      row.reward_sum += reward;
    }
  }

  const repoWeights = {};
  for (const [repoId, row] of stats.entries()) {
    if (row.uses < minUses) continue;
    let weight = calculateWeight(row, {
      minReliableUses,
      minWeight,
      maxWeight
    });
    const priorWeight = Number(previousWeights?.[repoId]?.weight);
    if (Number.isFinite(priorWeight)) {
      weight = clamp(weight, priorWeight - maxDeltaPerRun, priorWeight + maxDeltaPerRun);
      weight = Math.round(clamp(weight, minWeight, maxWeight) * 1000) / 1000;
    }
    const reliability = Math.round(clamp(row.uses / Math.max(1, minReliableUses), 0, 1) * 1000) / 1000;
    repoWeights[repoId] = {
      weight,
      uses: row.uses,
      worked: row.worked || 0,
      partially_worked: row.partially_worked || 0,
      failed: row.failed || 0,
      unsafe: row.unsafe || 0,
      unknown: row.unknown || 0,
      avg_reward: Math.round((row.reward_sum / Math.max(1, row.uses)) * 1000) / 1000,
      reliability
    };
  }

  const output = {
    version: 1,
    updated_at: new Date().toISOString(),
    lookback_hours: lookbackHours,
    min_uses: minUses,
    min_reliable_uses: minReliableUses,
    min_weight: minWeight,
    max_weight: maxWeight,
    max_delta_per_run: maxDeltaPerRun,
    dossiers_analyzed: dossiersAnalyzed,
    dossiers_used: dossiersUsed,
    repo_weights: Object.fromEntries(Object.entries(repoWeights).sort((a, b) => b[1].weight - a[1].weight))
  };

  writeJson(outputPath, output);

  return {
    outputPath,
    output,
    repoCount: Object.keys(output.repo_weights).length
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const out = learnPatternScoutWeights(args);
  process.stdout.write(JSON.stringify({
    outputPath: out.outputPath,
    repoCount: out.repoCount,
    dossiersAnalyzed: out.output.dossiers_analyzed,
    dossiersUsed: out.output.dossiers_used
  }, null, 2) + '\n');
}

module.exports = {
  DEFAULT_RUNTIME_ROOT,
  DEFAULT_WEIGHTS_PATH,
  learnPatternScoutWeights,
  extractReposFromPatternScout,
  calculateWeight
};
