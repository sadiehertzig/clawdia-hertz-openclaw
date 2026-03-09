#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');

const worker = require('../../agents/clawdia/runtime/patternscout_worker');

function testQueryNormalizer() {
  const normalized = worker.normalizeQuery('Write an intake subsystem with TalonFX and "beam break" sensor');
  assert.equal(Array.isArray(normalized.tokens), true);
  assert.equal(normalized.tokens.includes('intake'), true);
  assert.equal(normalized.symbols.includes('TalonFX'), true);
  assert.equal(normalized.phrases.includes('beam break'), true);
}

function testLocalDocsHit() {
  const out = worker.patternScoutWorker({
    request_id: 'req_ps_1',
    query: 'phoenix6 current limits',
    max_matches: 8,
    patternscout_config: {
      githubFallback: { enabled: false }
    }
  });

  assert.equal(out.status, 'success');
  assert.equal(Array.isArray(out.matches), true);
  assert.equal(out.matches.length >= 1, true);
  assert.equal(typeof out.coverage_note, 'string');
  assert.equal(Array.isArray(out.source_tiers_used), true);
}

function testCacheHitAvoidsSearch() {
  const config = {
    cacheDir: '/tmp/clawdia-patternscout-test-cache',
    cacheTtlMs: 60 * 1000,
    maxMatches: 8,
    repoMirrors: [],
    docsRoots: [],
    officialRoots: [],
    githubFallback: { enabled: false, repos: [], maxResults: 0 }
  };

  fs.mkdirSync(config.cacheDir, { recursive: true });
  const cache = worker.readCache(config);

  const normalized = worker.normalizeQuery('cache-hit-query-talonsubsystem');
  const key = worker.cacheKey(normalized, {
    repoMirrors: config.repoMirrors,
    docsRoots: config.docsRoots,
    officialRoots: config.officialRoots,
    githubFallback: config.githubFallback
  });

  cache[key] = {
    ts: Date.now(),
    normalized,
    matches: [
      {
        tier: 'public_frc',
        source_id: 'cached-source',
        repo: 'cached/repo',
        path: 'src/main/java/Cached.java',
        line_start: 12,
        line_end: 12,
        symbol: 'Cached',
        snippet: 'cached snippet',
        score: 88,
        why_matched: 'cache seed'
      }
    ],
    summary: 'cached summary',
    retrieval_summary: 'cached retrieval summary',
    coverage_note: 'cached coverage',
    source_tiers_used: ['public_frc'],
    confidence: 'medium',
    warnings: []
  };
  worker.writeCache(config, cache);

  const out = worker.patternScoutWorker({
    request_id: 'req_ps_cache',
    query: 'cache-hit-query-talonsubsystem',
    patternscout_config: config
  });

  assert.equal(out.status, 'success');
  assert.equal(out.telemetry_hints.cache_hit, true);
  assert.equal(out.matches.length, 1);
  assert.equal(out.matches[0].source_id, 'cached-source');
}

function testSparseCoverageConfidence() {
  const out = worker.patternScoutWorker({
    request_id: 'req_ps_2',
    query: 'nonexistenttokenxyzabc',
    max_matches: 4,
    patternscout_config: {
      githubFallback: { enabled: false }
    }
  });

  assert.equal(out.status, 'success');
  assert.equal(['low', 'medium', 'high'].includes(out.confidence), true);
  if (out.matches.length === 0) {
    assert.equal(out.confidence, 'low');
  }
}

function run() {
  testQueryNormalizer();
  console.log('ok - patternscout query normalizer');

  testLocalDocsHit();
  console.log('ok - patternscout local docs hit');

  testCacheHitAvoidsSearch();
  console.log('ok - patternscout cache hit');

  testSparseCoverageConfidence();
  console.log('ok - patternscout sparse coverage confidence');

  console.log('\nRan 4 tests.');
}

run();
