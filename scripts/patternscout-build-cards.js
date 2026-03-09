#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeQuery } = require('../agents/clawdia/runtime/patternscout_worker');

const DEFAULT_RUNTIME_ROOT = path.resolve(__dirname, '..', 'runtime_state', 'dossiers', 'sessions');
const DEFAULT_CARDS_PATH = path.resolve(__dirname, '..', 'runtime_state', 'patternscout', 'pattern_cards.json');

function parseArgs(argv) {
  const args = {
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    outputPath: DEFAULT_CARDS_PATH,
    lookbackHours: 24 * 14,
    minQualityScore: 60,
    maxCards: 500
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--runtime-root') args.runtimeRoot = path.resolve(argv[++i]);
    if (token === '--output-path') args.outputPath = path.resolve(argv[++i]);
    if (token === '--lookback-hours') args.lookbackHours = Number(argv[++i]);
    if (token === '--min-quality') args.minQualityScore = Number(argv[++i]);
    if (token === '--max-cards') args.maxCards = Number(argv[++i]);
  }

  if (!Number.isFinite(args.lookbackHours) || args.lookbackHours < 0) args.lookbackHours = 24 * 14;
  if (!Number.isFinite(args.minQualityScore)) args.minQualityScore = 60;
  if (!Number.isFinite(args.maxCards) || args.maxCards < 1) args.maxCards = 500;
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

function qualityScore(dossier) {
  const fromSelf = Number(dossier?.self_improvement?.quality_evaluation?.scores?.overall);
  if (Number.isFinite(fromSelf)) return fromSelf;
  const fromWorker = Number(dossier?.worker_outputs?.coach_evaluator?.overall_score);
  if (Number.isFinite(fromWorker)) return fromWorker;
  return null;
}

function outcomeLabel(dossier) {
  return String(dossier?.self_improvement?.outcome?.label || 'unknown').toLowerCase();
}

function cardId(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function buildPatternCards(options) {
  const opts = options || {};
  const runtimeRoot = opts.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const outputPath = opts.outputPath || DEFAULT_CARDS_PATH;
  const lookbackHours = Number.isFinite(Number(opts.lookbackHours)) ? Number(opts.lookbackHours) : 24 * 14;
  const minQuality = Number.isFinite(Number(opts.minQualityScore)) ? Number(opts.minQualityScore) : 60;
  const maxCards = Number.isFinite(Number(opts.maxCards)) ? Number(opts.maxCards) : 500;
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

  const files = listRequestJsonFiles(runtimeRoot);
  const cards = new Map();
  let dossiersAnalyzed = 0;
  let dossiersUsed = 0;

  for (const requestFile of files) {
    const dossier = readJson(requestFile, null);
    if (!dossier) continue;
    dossiersAnalyzed += 1;

    const ts = dossierTimestampMs(dossier);
    if (lookbackHours > 0 && ts > 0 && ts < cutoff) continue;

    const outcome = outcomeLabel(dossier);
    if (!(outcome === 'worked' || outcome === 'partially_worked')) continue;

    const q = qualityScore(dossier);
    if (Number.isFinite(q) && q < minQuality) continue;

    const matches = Array.isArray(dossier?.worker_outputs?.patternscout?.matches)
      ? dossier.worker_outputs.patternscout.matches
      : [];
    if (matches.length === 0) continue;

    dossiersUsed += 1;

    const query = normalizeQuery(dossier.user_message || '');
    const intent = String(dossier.intent || 'unknown');

    for (const match of matches.slice(0, 4)) {
      const repo = String(match.repo || match.source_id || '').trim();
      if (!repo || repo === 'workspace' || repo === 'docs_memory') continue;
      const pathHint = String(match.path || '').trim();
      if (!pathHint) continue;

      const id = cardId([intent, repo, pathHint, String(match.symbol || '')].join('|'));
      if (!cards.has(id)) {
        cards.set(id, {
          id,
          intent,
          query_tokens: query.tokens.slice(0, 16),
          source_repo: repo,
          source_path: pathHint,
          symbol: match.symbol || null,
          snippet: String(match.snippet || '').slice(0, 400),
          url: match.url || null,
          style_family: match.style_family || null,
          quality_score: Number.isFinite(Number(match.quality_score)) ? Number(match.quality_score) : (Number.isFinite(q) ? Number(q) : null),
          score_hint: Number.isFinite(Number(match.score)) ? Number(match.score) : null,
          weight_hint: Number.isFinite(Number(match.source_weight)) ? Number(match.source_weight) : 1,
          uses: 0,
          worked: 0,
          partially_worked: 0
        });
      }

      const row = cards.get(id);
      row.uses += 1;
      if (outcome === 'worked') row.worked += 1;
      if (outcome === 'partially_worked') row.partially_worked += 1;
      if (!row.snippet && match.snippet) row.snippet = String(match.snippet).slice(0, 400);
      if (!row.style_family && match.style_family) row.style_family = match.style_family;
    }
  }

  const finalCards = Array.from(cards.values())
    .map((card) => {
      const successRate = (card.worked + card.partially_worked * 0.6) / Math.max(1, card.uses);
      return {
        ...card,
        success_rate: Math.round(successRate * 1000) / 1000
      };
    })
    .sort((a, b) => {
      if (b.success_rate !== a.success_rate) return b.success_rate - a.success_rate;
      if (b.uses !== a.uses) return b.uses - a.uses;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, maxCards);

  const output = {
    version: 1,
    updated_at: new Date().toISOString(),
    lookback_hours: lookbackHours,
    min_quality_score: minQuality,
    dossiers_analyzed: dossiersAnalyzed,
    dossiers_used: dossiersUsed,
    cards: finalCards
  };

  writeJson(outputPath, output);

  return {
    outputPath,
    output,
    cardCount: finalCards.length
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const out = buildPatternCards(args);
  process.stdout.write(JSON.stringify({
    outputPath: out.outputPath,
    cardCount: out.cardCount,
    dossiersAnalyzed: out.output.dossiers_analyzed,
    dossiersUsed: out.output.dossiers_used
  }, null, 2) + '\n');
}

module.exports = {
  DEFAULT_RUNTIME_ROOT,
  DEFAULT_CARDS_PATH,
  buildPatternCards
};
