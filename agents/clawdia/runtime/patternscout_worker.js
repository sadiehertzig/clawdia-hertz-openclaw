'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const CONTRACT_VERSION = '1.0';

const DEFAULT_CONFIG = {
  enabled: true,
  cacheDir: path.resolve(__dirname, '..', '..', '..', 'tmp', 'patternscout-cache'),
  cacheTtlMs: 10 * 60 * 1000,
  maxMatches: 8,
  repoMirrors: [],
  docsRoots: [
    path.resolve(process.cwd(), 'agents', 'clawdia', 'memory', 'docs'),
    path.resolve(process.cwd(), 'agents', 'arbiter', 'memory', 'docs'),
    path.resolve(process.cwd(), 'memory')
  ],
  officialRoots: [
    path.resolve(process.cwd(), 'docs')
  ],
  githubFallback: {
    enabled: true,
    repos: [],
    maxResults: 6
  }
};

const TIER_WEIGHTS = {
  gatorbots: 40,
  official_examples: 28,
  approved_internal: 24,
  docs_memory: 18,
  public_frc: 10
};

function nowMs() {
  return Date.now();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
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

function tokenize(raw) {
  return String(raw || '')
    .split(/[^a-zA-Z0-9_]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeQuery(rawQuery) {
  const raw = String(rawQuery || '').trim();
  const tokens = tokenize(raw);
  const expandedTokens = [];

  for (const token of tokens) {
    expandedTokens.push(token);
    const alphaNumSplit = token.match(/[A-Za-z]+|\d+/g) || [];
    for (const part of alphaNumSplit) {
      if (part && part !== token) expandedTokens.push(part);
    }
  }

  const lowerTokens = Array.from(new Set(expandedTokens.map((t) => t.toLowerCase())));
  const phrases = [];

  const quoteRegex = /"([^"]+)"/g;
  let m;
  while ((m = quoteRegex.exec(raw)) !== null) {
    const phrase = m[1].trim();
    if (phrase) phrases.push(phrase.toLowerCase());
  }

  const symbols = tokens.filter((t) => /[A-Z][a-z0-9]+/.test(t));
  const vendorMarkers = ['phoenix', 'ctre', 'rev', 'limelight', 'navx', 'pigeon', 'photonvision'];
  const vendorHints = lowerTokens.filter((t) => vendorMarkers.some((marker) => t === marker || t.includes(marker)));
  const subsystemHints = lowerTokens.filter((t) => ['intake', 'swerve', 'shooter', 'drivetrain', 'elevator', 'arm', 'climber', 'beam', 'break'].includes(t));

  return {
    raw,
    tokens: lowerTokens,
    phrases,
    symbols,
    vendorHints,
    subsystemHints,
    docsHints: lowerTokens.filter((t) => ['wpilib', 'api', 'constructor', 'signature', 'docs', 'documentation'].includes(t))
  };
}

function cacheKey(normalized, sourceSet) {
  const keyPayload = {
    normalized,
    sourceSet
  };
  return crypto.createHash('sha1').update(JSON.stringify(keyPayload)).digest('hex');
}

function getCacheFile(config) {
  return path.join(config.cacheDir, 'cache.json');
}

function readCache(config) {
  const file = getCacheFile(config);
  ensureDir(config.cacheDir);
  return readJson(file, {});
}

function writeCache(config, cache) {
  writeJson(getCacheFile(config), cache);
}

function hasCommand(name) {
  const out = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return out.status === 0;
}

function buildPattern(normalized) {
  const pieces = [];
  for (const token of normalized.tokens.slice(0, 10)) {
    if (token.length >= 3) pieces.push(token);
  }
  for (const symbol of normalized.symbols.slice(0, 5)) {
    pieces.push(symbol);
  }
  for (const phrase of normalized.phrases.slice(0, 4)) {
    pieces.push(phrase);
  }

  const dedup = Array.from(new Set(pieces.filter(Boolean)));
  return dedup.length ? dedup.join('|') : null;
}

function makeMatch({ tier, sourceId, repo, filePath, lineStart, lineEnd, symbol, snippet, score, whyMatched, url }) {
  return {
    tier,
    source_id: sourceId || repo || 'unknown',
    repo: repo || sourceId || null,
    path: filePath || null,
    line_start: lineStart || null,
    line_end: lineEnd || null,
    symbol: symbol || null,
    snippet: snippet || '',
    score: score || 0,
    why_matched: whyMatched || '',
    url: url || null
  };
}

function runRgSearch(baseDir, normalized, laneTier, laneRepo, limit) {
  if (!fs.existsSync(baseDir)) return [];
  const pattern = buildPattern(normalized);
  if (!pattern) return [];

  const args = ['-n', '--max-count', String(limit), '--glob', '!.git/**', '--glob', '!node_modules/**', pattern, baseDir];
  const out = spawnSync('rg', args, { encoding: 'utf8' });
  const stdout = String(out.stdout || '');
  const hasOutput = stdout.trim().length > 0;
  // In sandboxed environments, spawnSync may include EPERM in `error` while still returning valid output.
  if ((out.status > 1 && !hasOutput) || (out.error && !hasOutput)) return [];

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const parts = line.split(':');
      const filePath = parts[0] || '';
      const lineStart = Number(parts[1] || 0) || null;
      const snippet = parts.slice(2).join(':').trim();
      const lowerSnippet = snippet.toLowerCase();
      const hitToken = normalized.tokens.find((t) => lowerSnippet.includes(t)) || normalized.symbols.find((s) => snippet.includes(s)) || null;

      return makeMatch({
        tier: laneTier,
        sourceId: path.basename(baseDir),
        repo: laneRepo,
        filePath: path.relative(process.cwd(), filePath),
        lineStart,
        lineEnd: lineStart,
        symbol: hitToken,
        snippet: snippet.slice(0, 400),
        score: 0,
        whyMatched: hitToken ? `matched token/symbol: ${hitToken}` : 'matched pattern'
      });
    });
}

function runFsFallbackSearch(baseDir, normalized, laneTier, laneRepo, limit) {
  const matches = [];

  function walk(dirPath) {
    if (matches.length >= limit) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= limit) return;
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'runtime_state') continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.java', '.kt', '.json', '.md', '.txt'].includes(ext)) continue;

      let content = '';
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 1024 * 1024) continue;
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      const lowerTokens = normalized.tokens;

      for (let i = 0; i < lines.length && matches.length < limit; i++) {
        const line = lines[i];
        const lower = line.toLowerCase();
        const hitToken = lowerTokens.find((t) => lower.includes(t));
        if (!hitToken) continue;

        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length - 1, i + 2);
        const snippet = lines.slice(start, end + 1).join('\n').slice(0, 400);

        matches.push(makeMatch({
          tier: laneTier,
          sourceId: path.basename(baseDir),
          repo: laneRepo,
          filePath: path.relative(process.cwd(), fullPath),
          lineStart: i + 1,
          lineEnd: i + 1,
          symbol: hitToken,
          snippet,
          score: 0,
          whyMatched: `matched token: ${hitToken}`
        }));
      }
    }
  }

  if (fs.existsSync(baseDir)) {
    walk(baseDir);
  }

  return matches;
}

function searchLocalLane(baseDir, normalized, laneTier, laneRepo, limit) {
  const rgAvailable = hasCommand('rg');
  return rgAvailable
    ? runRgSearch(baseDir, normalized, laneTier, laneRepo, limit)
    : runFsFallbackSearch(baseDir, normalized, laneTier, laneRepo, limit);
}

function runGitHubFallback(normalized, config, limit) {
  const ghCfg = config.githubFallback || {};
  if (!ghCfg.enabled) {
    return { ok: false, warning: 'github fallback disabled', matches: [] };
  }

  if (!hasCommand('gh')) {
    return { ok: false, warning: 'github CLI unavailable', matches: [] };
  }

  const queryParts = [];
  if (normalized.symbols.length) {
    queryParts.push(normalized.symbols[0]);
  }
  queryParts.push(...normalized.tokens.slice(0, 6));

  let query = queryParts.join(' ');
  if (!query.trim()) query = normalized.raw;

  if (Array.isArray(ghCfg.repos) && ghCfg.repos.length > 0) {
    query += ` repo:${ghCfg.repos[0]}`;
  }

  const out = spawnSync('gh', ['search', 'code', query, '--language', 'Java', '--limit', String(limit), '--json', 'path,repository,url'], {
    encoding: 'utf8'
  });

  if (out.error || out.status !== 0) {
    return {
      ok: false,
      warning: tailLines(out.stderr || (out.error ? out.error.message : ''), 8).join(' | ') || 'github fallback failed',
      matches: []
    };
  }

  let parsed = [];
  try {
    parsed = JSON.parse(out.stdout || '[]');
  } catch {
    parsed = [];
  }

  const matches = Array.isArray(parsed) ? parsed.map((item) => makeMatch({
    tier: 'public_frc',
    sourceId: item.repository?.fullName || 'github',
    repo: item.repository?.fullName || null,
    filePath: item.path || null,
    lineStart: null,
    lineEnd: null,
    symbol: normalized.symbols[0] || null,
    snippet: item.path || '',
    score: 0,
    whyMatched: 'github fallback hit',
    url: item.url || null
  })) : [];

  return { ok: true, warning: null, matches };
}

function scoreMatch(match, normalized) {
  const tierBonus = TIER_WEIGHTS[match.tier] || 0;
  const snippet = String(match.snippet || '').toLowerCase();
  const pathScore = String(match.path || '').toLowerCase();

  let tokenCoverage = 0;
  for (const token of normalized.tokens) {
    if (snippet.includes(token) || pathScore.includes(token)) tokenCoverage += 1;
  }

  let symbolBonus = 0;
  for (const symbol of normalized.symbols) {
    if (String(match.snippet || '').includes(symbol) || String(match.path || '').includes(symbol)) {
      symbolBonus += 8;
    }
  }

  let subsystemBonus = 0;
  for (const hint of normalized.subsystemHints) {
    if (pathScore.includes(hint) || snippet.includes(hint)) subsystemBonus += 5;
  }

  let markdownPenalty = 0;
  if (String(match.path || '').endsWith('.md')) markdownPenalty = -3;

  const score = tierBonus + tokenCoverage * 4 + symbolBonus + subsystemBonus + markdownPenalty;
  return {
    ...match,
    score
  };
}

function dedupeMatches(matches, maxMatches) {
  const seen = new Set();
  const out = [];
  const perRepo = new Map();

  for (const match of matches) {
    const key = `${match.repo || match.source_id || 'x'}|${match.path || 'x'}|${match.line_start || 'x'}|${match.line_end || 'x'}`;
    if (seen.has(key)) continue;

    const repo = match.repo || match.source_id || 'unknown';
    const count = perRepo.get(repo) || 0;
    if (count >= 4) continue;

    seen.add(key);
    perRepo.set(repo, count + 1);
    out.push(match);
    if (out.length >= maxMatches) break;
  }

  return out;
}

function resolveConfig(payload) {
  const cfg = payload?.patternscout_config || payload?.config?.patternScout || {};
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    githubFallback: {
      ...DEFAULT_CONFIG.githubFallback,
      ...(cfg.githubFallback || {})
    }
  };
}

function patternScoutWorker(payload) {
  const requestId = payload?.request_id || null;
  const config = resolveConfig(payload);
  const normalized = normalizeQuery(payload?.query || payload?.user_message || '');
  const started = nowMs();
  const warnings = [];

  const sourceSet = {
    repoMirrors: config.repoMirrors,
    docsRoots: config.docsRoots,
    officialRoots: config.officialRoots,
    githubFallback: config.githubFallback
  };

  const cache = readCache(config);
  const key = cacheKey(normalized, sourceSet);
  const cached = cache[key];
  const fresh = cached && typeof cached.ts === 'number' && (nowMs() - cached.ts) <= Number(config.cacheTtlMs || DEFAULT_CONFIG.cacheTtlMs);

  if (fresh && Array.isArray(cached.matches)) {
    const latency = nowMs() - started;
    return {
      request_id: requestId,
      contract_version: CONTRACT_VERSION,
      status: 'success',
      kind: 'retrieval',
      summary: cached.summary || `Cache hit with ${cached.matches.length} matches`,
      matches: cached.matches,
      retrieval_summary: cached.retrieval_summary || 'retrieval served from cache',
      coverage_note: cached.coverage_note || 'retrieval served from cache',
      retrieval_latency_ms: latency,
      source_tiers_used: cached.source_tiers_used || Array.from(new Set(cached.matches.map((m) => m.tier))),
      confidence: cached.confidence || 'medium',
      warnings: cached.warnings || [],
      contract_flags: {
        reviewed: false,
        escalated: false,
        implementation_safe: false,
        pattern_only: true
      },
      telemetry_hints: {
        cache_hit: true,
        elapsed_time_ms: latency
      },
      error: null
    };
  }

  const maxMatches = Math.max(1, Math.min(Number(payload?.max_matches || config.maxMatches || DEFAULT_CONFIG.maxMatches), 20));
  const allMatches = [];

  // Lane A: repo mirrors + local workspace
  const laneA = [];
  if (Array.isArray(config.repoMirrors) && config.repoMirrors.length > 0) {
    for (const mirror of config.repoMirrors) {
      const laneTier = mirror.tier || 'gatorbots';
      const laneRepo = mirror.id || path.basename(String(mirror.localPath || 'mirror'));
      const matches = searchLocalLane(path.resolve(String(mirror.localPath)), normalized, laneTier, laneRepo, maxMatches);
      laneA.push(...matches);
    }
  } else {
    laneA.push(...searchLocalLane(process.cwd(), normalized, 'gatorbots', 'workspace', maxMatches));
  }
  allMatches.push(...laneA);

  // Lane B: docs memory
  if (allMatches.length < maxMatches) {
    for (const docsRoot of config.docsRoots || []) {
      allMatches.push(...searchLocalLane(path.resolve(String(docsRoot)), normalized, 'docs_memory', 'docs_memory', maxMatches - allMatches.length));
      if (allMatches.length >= maxMatches) break;
    }
  }

  // Lane C: official examples
  if (allMatches.length < maxMatches) {
    for (const officialRoot of config.officialRoots || []) {
      allMatches.push(...searchLocalLane(path.resolve(String(officialRoot)), normalized, 'official_examples', 'official_examples', maxMatches - allMatches.length));
      if (allMatches.length >= maxMatches) break;
    }
  }

  // Lane D: github fallback
  if (allMatches.length < Math.max(2, Math.floor(maxMatches / 3))) {
    const fallback = runGitHubFallback(normalized, config, Math.min(config.githubFallback.maxResults || 6, maxMatches - allMatches.length));
    if (fallback.warning) warnings.push(fallback.warning);
    allMatches.push(...fallback.matches);
  }

  const scored = allMatches.map((m) => scoreMatch(m, normalized)).sort((a, b) => b.score - a.score);
  const finalMatches = dedupeMatches(scored, maxMatches);

  const tiersUsed = Array.from(new Set(finalMatches.map((m) => m.tier)));
  const hasStrong = finalMatches.some((m) => m.tier === 'gatorbots' || m.tier === 'official_examples');
  const confidence = hasStrong && finalMatches.length >= 2 ? 'high' : finalMatches.length >= 2 ? 'medium' : 'low';

  let coverageNote = 'No strong match found.';
  if (finalMatches.length === 0) {
    coverageNote = 'No strong match; retrieval was sparse across configured lanes.';
  } else if (hasStrong) {
    coverageNote = 'Strong local/official match coverage for this query.';
  } else {
    coverageNote = 'Results found but mostly docs/fallback; coverage is moderate.';
  }

  const retrievalSummary = finalMatches.length
    ? `Found ${finalMatches.length} match(es) across ${tiersUsed.join(', ')}`
    : 'No retrieval matches found';

  const latency = nowMs() - started;

  const result = {
    request_id: requestId,
    contract_version: CONTRACT_VERSION,
    status: 'success',
    kind: 'retrieval',
    summary: retrievalSummary,
    matches: finalMatches,
    retrieval_summary: retrievalSummary,
    coverage_note: coverageNote,
    retrieval_latency_ms: latency,
    source_tiers_used: tiersUsed,
    confidence,
    warnings,
    contract_flags: {
      reviewed: false,
      escalated: false,
      implementation_safe: false,
      pattern_only: true
    },
    telemetry_hints: {
      cache_hit: false,
      elapsed_time_ms: latency
    },
    error: null
  };

  cache[key] = {
    ts: nowMs(),
    normalized,
    matches: result.matches,
    summary: result.summary,
    retrieval_summary: result.retrieval_summary,
    coverage_note: result.coverage_note,
    source_tiers_used: result.source_tiers_used,
    confidence: result.confidence,
    warnings: result.warnings
  };
  writeCache(config, cache);

  return result;
}

module.exports = {
  DEFAULT_CONFIG,
  CACHE_TTL_MS: DEFAULT_CONFIG.cacheTtlMs,
  CACHE_FILE: getCacheFile(DEFAULT_CONFIG),
  normalizeQuery,
  patternScoutWorker,
  runGitHubFallback,
  searchLocalLane,
  cacheKey,
  readCache,
  writeCache
};
