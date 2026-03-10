'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const CONTRACT_VERSION = '2.0';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PARALLEL_LANE_RUNNER_PATH = path.resolve(REPO_ROOT, 'scripts', 'patternscout-parallel-lanes.js');
const PARALLEL_LANE_MAX_CONCURRENCY = 6;

const DEFAULT_CONFIG = {
  enabled: true,
  cacheDir: path.resolve(REPO_ROOT, 'tmp', 'patternscout-cache'),
  cacheTtlMs: 10 * 60 * 1000,
  cacheMaxEntries: 500,
  maxMatches: 8,
  diversityPerRepoCap: 2,
  searchCommandTimeoutMs: 1800,
  indexDir: path.resolve(REPO_ROOT, 'runtime_state', 'patternscout', 'index'),
  indexMaxEntriesPerToken: 120,
  curatedRegistryPath: path.resolve(REPO_ROOT, 'docs', 'runtime', 'patternscout-curated-repos.json'),
  dynamicWeightsPath: path.resolve(REPO_ROOT, 'runtime_state', 'patternscout', 'source_weights.json'),
  patternCardsPath: path.resolve(REPO_ROOT, 'runtime_state', 'patternscout', 'pattern_cards.json'),
  laneBudgetsMs: {
    gatorbots: 900,
    learned_pattern: 250,
    docs_memory: 450,
    official_examples: 500,
    public_frc: 2200
  },
  qualityGate: {
    enabled: true,
    minTopScore: 40,
    minDistinctRepos: 1,
    minEvidenceReceipts: 1,
    requireStrongLaneForHigh: true
  },
  observability: {
    metricsPath: path.resolve(REPO_ROOT, 'runtime_state', 'patternscout', 'metrics.json'),
    keepLastSamples: 200
  },
  repoMirrors: [
    {
      id: 'gatorbots-2026',
      localPath: path.resolve(REPO_ROOT, 'mirrors', 'gatorbots-2026'),
      tier: 'gatorbots'
    }
  ],
  docsRoots: [
    path.resolve(REPO_ROOT, 'agents', 'clawdia', 'memory', 'docs'),
    path.resolve(REPO_ROOT, 'agents', 'arbiter', 'memory', 'docs'),
    path.resolve(REPO_ROOT, 'memory')
  ],
  officialRoots: [
    path.resolve(REPO_ROOT, 'docs')
  ],
  githubFallback: {
    enabled: true,
    repos: [],
    maxResults: 6,
    maxReposPerQuery: 4,
    commandTimeoutMs: 5000,
    circuitBreaker: {
      maxFailures: 3,
      cooldownMs: 10 * 60 * 1000,
      statePath: path.resolve(REPO_ROOT, 'runtime_state', 'patternscout', 'github_fallback_state.json')
    }
  }
};

const TIER_WEIGHTS = {
  gatorbots: 40,
  learned_pattern: 34,
  official_examples: 28,
  approved_internal: 24,
  docs_memory: 18,
  public_frc: 10
};

const SUBSTANTIVE_INTENTS = new Set([
  'build_deploy_error',
  'subsystem_or_command_draft',
  'autonomous_or_pathing',
  'vision_problem',
  'sensor_or_can_fault',
  'deep_debug',
  'follow_up'
]);
const SEARCHABLE_EXTENSIONS = new Set(['.java', '.kt', '.json', '.md', '.txt']);

function nowMs() {
  return Date.now();
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

function tailLines(text, maxLines) {
  const lines = String(text || '').split('\n').filter(Boolean);
  return lines.slice(-Math.max(1, maxLines || 20));
}

function tokenize(raw) {
  return String(raw || '')
    .split(/[^a-zA-Z0-9_]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeRepoId(repoId) {
  return String(repoId || '').trim().toLowerCase();
}

function fileVersion(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    return Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : null;
  } catch {
    return null;
  }
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

  const STOP_TOKENS = new Set([
    'a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'this', 'that', 'these',
    'those', 'i', 'you', 'we', 'they', 'he', 'she', 'them', 'my', 'your', 'our',
    // common contraction fragments/noise
    's', 't', 're', 've', 'll', 'd', 'm'
  ]);

  const lowerTokens = Array.from(new Set(
    expandedTokens
      .map((t) => t.toLowerCase())
      .filter((t) => t && !STOP_TOKENS.has(t) && (t.length >= 2 || /\d/.test(t)))
  ));
  const phrases = [];

  const quoteRegex = /"([^"]+)"/g;
  let m;
  while ((m = quoteRegex.exec(raw)) !== null) {
    const phrase = m[1].trim();
    if (phrase) phrases.push(phrase.toLowerCase());
  }

  const symbols = tokens.filter((t) => /[A-Z][a-z0-9]+/.test(t));
  const vendorMarkers = ['phoenix', 'ctre', 'rev', 'limelight', 'navx', 'pigeon', 'photonvision', 'advantagekit'];
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

const COMMAND_AVAILABLE_CACHE = new Map();

function hasCommand(name) {
  const key = String(name || '').trim();
  if (!key) return false;
  if (COMMAND_AVAILABLE_CACHE.has(key)) {
    return Boolean(COMMAND_AVAILABLE_CACHE.get(key));
  }
  const out = spawnSync('bash', ['-lc', `command -v ${key}`], { encoding: 'utf8' });
  const ok = out.status === 0;
  COMMAND_AVAILABLE_CACHE.set(key, ok);
  return ok;
}

function hashValue(raw) {
  return crypto.createHash('sha1').update(String(raw || '')).digest('hex');
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSnippet(snippet) {
  return String(snippet || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\/\/.*$/gm, '')
    .trim()
    .slice(0, 220);
}

function snippetHash(snippet) {
  return hashValue(normalizeSnippet(snippet)).slice(0, 12);
}

function listSearchableFiles(baseDir, options) {
  const opts = options || {};
  const maxBytes = Number.isFinite(Number(opts.maxFileBytes)) ? Number(opts.maxFileBytes) : 1024 * 1024;
  const files = [];
  if (!baseDir || !fs.existsSync(baseDir)) return files;

  function walk(dirPath) {
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'runtime_state') continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SEARCHABLE_EXTENSIONS.has(ext)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (!Number.isFinite(stat.size) || stat.size > maxBytes) continue;
        files.push({
          fullPath,
          relPath: safeRelative(fullPath),
          size: Number(stat.size || 0),
          mtimeMs: Number(stat.mtimeMs || 0)
        });
      } catch {
        continue;
      }
    }
  }

  walk(baseDir);
  return files;
}

function makeIndexFilePath(baseDir, config) {
  const root = path.resolve(String(baseDir || ''));
  const id = hashValue(root).slice(0, 16);
  return path.join(config.indexDir, `${id}.json`);
}

function makeSnapshotCacheKey(baseDir) {
  return path.resolve(String(baseDir || ''));
}

function resolveRootSnapshot(baseDir, options) {
  const opts = options || {};
  const key = makeSnapshotCacheKey(baseDir);
  const memo = opts.snapshotMemo instanceof Map ? opts.snapshotMemo : null;
  if (memo && memo.has(key)) return memo.get(key);

  let snapshot = null;
  if (hasCommand('git')) {
    const head = spawnSync('git', ['-C', key, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: Number(opts.timeoutMs || 1200)
    });
    if (head.status === 0) {
      const status = spawnSync('git', ['-C', key, 'status', '--porcelain', '-uno'], {
        encoding: 'utf8',
        timeout: Number(opts.timeoutMs || 1200)
      });
      const dirtyHash = hashValue(String(status.stdout || '').trim()).slice(0, 10);
      snapshot = `git:${String(head.stdout || '').trim()}:${dirtyHash}`;
    }
  }

  if (!snapshot) {
    try {
      const stat = fs.statSync(key);
      snapshot = `mtime:${Math.floor(Number(stat.mtimeMs || 0))}`;
    } catch {
      snapshot = 'missing';
    }
  }

  if (memo) memo.set(key, snapshot);
  return snapshot;
}

function loadOrBuildSearchIndex(baseDir, config, options) {
  const opts = options || {};
  const indexFile = makeIndexFilePath(baseDir, config);
  const rootSnapshot = String(opts.rootSnapshot || resolveRootSnapshot(baseDir, { snapshotMemo: opts.snapshotMemo }));
  const maxEntriesPerToken = Math.max(20, Number(config.indexMaxEntriesPerToken || DEFAULT_CONFIG.indexMaxEntriesPerToken));
  const existing = readJson(indexFile, null);

  if (existing && existing.version === 1 && existing.root_snapshot === rootSnapshot && existing.tokens && typeof existing.tokens === 'object') {
    return existing;
  }

  const files = listSearchableFiles(baseDir, { maxFileBytes: 1024 * 1024 });
  const tokenMap = Object.create(null);
  let indexedLineCount = 0;

  for (const file of files) {
    let content = '';
    try {
      content = fs.readFileSync(file.fullPath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || '');
      const lineTokens = Array.from(new Set(tokenize(line.toLowerCase()).filter((t) => t.length >= 3).slice(0, 24)));
      if (lineTokens.length === 0) continue;
      indexedLineCount += 1;
      for (const token of lineTokens) {
        if (!tokenMap[token]) tokenMap[token] = [];
        if (tokenMap[token].length >= maxEntriesPerToken) continue;
        tokenMap[token].push({
          p: file.relPath,
          l: i + 1,
          s: line.trim().slice(0, 360)
        });
      }
    }
  }

  const built = {
    version: 1,
    built_at: new Date().toISOString(),
    base_dir: path.resolve(String(baseDir || '')),
    root_snapshot: rootSnapshot,
    file_count: files.length,
    indexed_line_count: indexedLineCount,
    tokens: tokenMap
  };
  writeJson(indexFile, built);
  return built;
}

function searchIndex(indexData, normalized, laneTier, laneRepo, limit, extraFields) {
  if (!indexData || !indexData.tokens || typeof indexData.tokens !== 'object') return [];
  const queryTokens = Array.from(new Set([
    ...normalized.tokens.slice(0, 16),
    ...normalized.symbols.map((s) => String(s).toLowerCase()).slice(0, 6)
  ]));
  if (queryTokens.length === 0) return [];

  const scoreMap = new Map();
  for (const token of queryTokens) {
    const hits = Array.isArray(indexData.tokens[token]) ? indexData.tokens[token] : [];
    for (const hit of hits) {
      const key = `${hit.p}|${hit.l}`;
      if (!scoreMap.has(key)) {
        scoreMap.set(key, {
          p: hit.p,
          l: Number(hit.l || 0) || null,
          s: String(hit.s || ''),
          score: 0,
          tokenHits: new Set()
        });
      }
      const row = scoreMap.get(key);
      row.score += 6;
      row.tokenHits.add(token);
      if (queryTokens.includes(String(hit.s || '').toLowerCase())) {
        row.score += 2;
      }
    }
  }

  const rows = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit * 2));

  return rows.slice(0, limit).map((row) => makeMatch({
    tier: laneTier,
    sourceId: laneRepo || 'indexed',
    repo: laneRepo || 'indexed',
    filePath: row.p || null,
    lineStart: row.l,
    lineEnd: row.l,
    symbol: Array.from(row.tokenHits)[0] || null,
    snippet: row.s || '',
    score: 0,
    whyMatched: `indexed token overlap (${row.tokenHits.size})`,
    extras: extraFields
  }));
}

function nowWithBudget(startMs, budgetMs) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return null;
  return startMs + budgetMs;
}

function outOfBudget(deadlineMs) {
  return Number.isFinite(deadlineMs) && nowMs() > deadlineMs;
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

function makeMatch({ tier, sourceId, repo, filePath, lineStart, lineEnd, symbol, snippet, score, whyMatched, url, extras }) {
  return {
    tier,
    source_id: sourceId || repo || 'unknown',
    repo: repo || sourceId || null,
    path: filePath || null,
    line_start: lineStart || null,
    line_end: lineEnd || null,
    symbol: symbol || null,
    snippet: snippet || '',
    score: Number(score || 0),
    why_matched: whyMatched || '',
    url: url || null,
    ...(extras && typeof extras === 'object' ? extras : {})
  };
}

function safeRelative(filePath) {
  const rel = path.relative(REPO_ROOT, filePath);
  if (!rel || rel.startsWith('..')) return filePath;
  return rel;
}

function runRgSearch(baseDir, normalized, laneTier, laneRepo, limit, extraFields, options) {
  const opts = options || {};
  if (outOfBudget(opts.deadlineMs)) return [];
  if (!fs.existsSync(baseDir)) return [];
  const pattern = buildPattern(normalized);
  if (!pattern) return [];

  const args = ['-n', '--max-count', String(limit), '--glob', '!.git/**', '--glob', '!node_modules/**', pattern, baseDir];
  const out = spawnSync('rg', args, {
    encoding: 'utf8',
    timeout: Number(opts.timeoutMs || DEFAULT_CONFIG.searchCommandTimeoutMs)
  });
  const stdout = String(out.stdout || '');
  const hasOutput = stdout.trim().length > 0;
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
        sourceId: laneRepo || path.basename(baseDir),
        repo: laneRepo || path.basename(baseDir),
        filePath: safeRelative(path.resolve(filePath)),
        lineStart,
        lineEnd: lineStart,
        symbol: hitToken,
        snippet: snippet.slice(0, 400),
        score: 0,
        whyMatched: hitToken ? `matched token/symbol: ${hitToken}` : 'matched pattern',
        extras: extraFields
      });
    });
}

function runFsFallbackSearch(baseDir, normalized, laneTier, laneRepo, limit, extraFields, options) {
  const opts = options || {};
  if (outOfBudget(opts.deadlineMs)) return [];
  const matches = [];

  function walk(dirPath) {
    if (matches.length >= limit || outOfBudget(opts.deadlineMs)) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= limit || outOfBudget(opts.deadlineMs)) return;
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

      for (let i = 0; i < lines.length && matches.length < limit; i++) {
        if (outOfBudget(opts.deadlineMs)) return;
        const line = lines[i];
        const lower = line.toLowerCase();
        const hitToken = normalized.tokens.find((t) => lower.includes(t));
        if (!hitToken) continue;

        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length - 1, i + 2);
        const snippet = lines.slice(start, end + 1).join('\n').slice(0, 400);

        matches.push(makeMatch({
          tier: laneTier,
          sourceId: laneRepo || path.basename(baseDir),
          repo: laneRepo || path.basename(baseDir),
          filePath: safeRelative(fullPath),
          lineStart: i + 1,
          lineEnd: i + 1,
          symbol: hitToken,
          snippet,
          score: 0,
          whyMatched: `matched token: ${hitToken}`,
          extras: extraFields
        }));
      }
    }
  }

  if (fs.existsSync(baseDir)) {
    walk(baseDir);
  }

  return matches;
}

function searchLocalLaneDetailed(baseDir, normalized, laneTier, laneRepo, limit, extraFields, options) {
  const opts = options || {};
  const started = nowMs();
  const deadlineMs = nowWithBudget(started, opts.budgetMs);
  const warnings = [];
  const rootSnapshot = String(opts.rootSnapshot || resolveRootSnapshot(baseDir, { snapshotMemo: opts.snapshotMemo }));
  let indexUsed = false;

  const indexData = loadOrBuildSearchIndex(baseDir, opts.config || DEFAULT_CONFIG, {
    rootSnapshot,
    snapshotMemo: opts.snapshotMemo
  });

  let matches = searchIndex(indexData, normalized, laneTier, laneRepo, limit, extraFields);
  if (matches.length > 0) {
    indexUsed = true;
  }

  if (matches.length < Math.max(2, Math.floor(limit / 2)) && !outOfBudget(deadlineMs)) {
    const rgAvailable = hasCommand('rg');
    if (rgAvailable) {
      const rgMatches = runRgSearch(baseDir, normalized, laneTier, laneRepo, limit, extraFields, {
        timeoutMs: opts.searchTimeoutMs,
        deadlineMs
      });
      if (rgMatches.length > 0) {
        matches.push(...rgMatches);
      }
    }
  }

  if (matches.length === 0 && !outOfBudget(deadlineMs)) {
    const fsMatches = runFsFallbackSearch(baseDir, normalized, laneTier, laneRepo, limit, extraFields, { deadlineMs });
    matches.push(...fsMatches);
  }

  const deduped = dedupeMatches(matches, limit, Math.max(1, Number(opts.perRepoCap || 2)));
  return {
    matches: deduped,
    warnings,
    metadata: {
      lane: laneTier,
      root_snapshot: rootSnapshot,
      index_used: indexUsed,
      elapsed_ms: nowMs() - started
    }
  };
}

function searchLocalLane(baseDir, normalized, laneTier, laneRepo, limit, extraFields, options) {
  return searchLocalLaneDetailed(baseDir, normalized, laneTier, laneRepo, limit, extraFields, options).matches;
}

function parseIsoDays(dateText) {
  const ts = Date.parse(String(dateText || ''));
  if (!Number.isFinite(ts)) return null;
  const delta = nowMs() - ts;
  if (!Number.isFinite(delta) || delta < 0) return 0;
  return Math.floor(delta / (24 * 60 * 60 * 1000));
}

function recencyBoost(days) {
  if (!Number.isFinite(days)) return 0;
  if (days <= 14) return 10;
  if (days <= 45) return 8;
  if (days <= 90) return 6;
  if (days <= 180) return 3;
  if (days <= 365) return 0;
  return -3;
}

function resolveConfig(payload) {
  const cfg = payload?.patternscout_config || payload?.config?.patternScout || {};
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    laneBudgetsMs: {
      ...DEFAULT_CONFIG.laneBudgetsMs,
      ...(cfg.laneBudgetsMs || {})
    },
    qualityGate: {
      ...DEFAULT_CONFIG.qualityGate,
      ...(cfg.qualityGate || {})
    },
    observability: {
      ...DEFAULT_CONFIG.observability,
      ...(cfg.observability || {})
    },
    githubFallback: {
      ...DEFAULT_CONFIG.githubFallback,
      ...(cfg.githubFallback || {}),
      circuitBreaker: {
        ...DEFAULT_CONFIG.githubFallback.circuitBreaker,
        ...((cfg.githubFallback && cfg.githubFallback.circuitBreaker) || {})
      }
    }
  };
}

function loadCuratedRegistry(config) {
  const raw = readJson(config.curatedRegistryPath, { repos: [] });
  const repos = Array.isArray(raw?.repos) ? raw.repos : [];
  const map = new Map();

  for (const repo of repos) {
    if (!repo || typeof repo !== 'object') continue;
    const id = String(repo.id || '').trim();
    if (!id) continue;
    map.set(normalizeRepoId(id), {
      id,
      quality_score: Number(repo.quality_score || repo.qualityScore || 60),
      official: Boolean(repo.official),
      archived: Boolean(repo.archived),
      tags: Array.isArray(repo.tags) ? repo.tags.map((x) => String(x).toLowerCase()) : [],
      style_family: repo.style_family ? String(repo.style_family) : null,
      last_updated: repo.last_updated || repo.lastUpdated || null,
      base_weight: Number(repo.base_weight || repo.baseWeight || 1),
      evidence_note: repo.evidence_note ? String(repo.evidence_note) : null
    });
  }

  return {
    version: raw?.version || 1,
    map,
    repos
  };
}

function loadDynamicWeights(config) {
  const raw = readJson(config.dynamicWeightsPath, { repo_weights: {} });
  const repoWeights = raw?.repo_weights && typeof raw.repo_weights === 'object'
    ? raw.repo_weights
    : {};
  const map = new Map();

  for (const [repoId, value] of Object.entries(repoWeights)) {
    const normalizedRepo = normalizeRepoId(repoId);
    if (!normalizedRepo) continue;
    const obj = value && typeof value === 'object' ? value : { weight: Number(value) };
    const weightNum = Number(obj.weight);
    const uses = Number(obj.uses || 0);
    const reliability = clampNumber(uses / 6, 0, 1);
    const baseWeight = Number.isFinite(weightNum) ? clampNumber(weightNum, 0.45, 2.2) : 1;
    const smoothedWeight = Math.round((1 + (baseWeight - 1) * reliability) * 1000) / 1000;
    map.set(normalizedRepo, {
      weight: smoothedWeight,
      uses,
      worked: Number(obj.worked || 0),
      partially_worked: Number(obj.partially_worked || 0),
      failed: Number(obj.failed || 0),
      unsafe: Number(obj.unsafe || 0),
      avg_reward: Number(obj.avg_reward || 0),
      reliability
    });
  }

  return {
    updated_at: raw?.updated_at || null,
    map
  };
}

function loadPatternCards(config) {
  const raw = readJson(config.patternCardsPath, { cards: [] });
  const cards = Array.isArray(raw?.cards) ? raw.cards : [];
  return {
    updated_at: raw?.updated_at || null,
    cards
  };
}

function getRepoProfile(repoId, curatedRegistry, dynamicWeights, intent, normalized) {
  const defaultProfile = {
    id: repoId || null,
    quality_score: 55,
    official: false,
    archived: false,
    tags: [],
    style_family: null,
    freshness_days: null,
    recency_boost: 0,
    base_weight: 1,
    dynamic_weight: 1,
    quality_bonus: 5,
    official_bonus: 0,
    archived_penalty: 0,
    intent_boost: 0,
    reasons: ['unregistered_repo']
  };

  const normalizedRepo = normalizeRepoId(repoId);
  if (!normalizedRepo) {
    return defaultProfile;
  }

  const curated = curatedRegistry.map.get(normalizedRepo);
  if (!curated) {
    const dynamic = dynamicWeights.map.get(normalizedRepo);
    if (dynamic && Number.isFinite(dynamic.weight)) {
      defaultProfile.dynamic_weight = clampNumber(dynamic.weight, 0.45, 2.2);
      defaultProfile.reasons.push(`dynamic_weight_only reliability=${Number(dynamic.reliability || 0).toFixed(2)}`);
    }
    return defaultProfile;
  }

  const dynamic = dynamicWeights.map.get(normalizedRepo);
  const qualityScore = Math.max(1, Math.min(Number(curated.quality_score || 60), 100));
  const official = Boolean(curated.official);
  const archived = Boolean(curated.archived);
  const tags = Array.isArray(curated.tags) ? curated.tags : [];
  const freshnessDays = parseIsoDays(curated.last_updated);
  const intentText = String(intent || '').toLowerCase();

  let intentBoost = 0;
  const overlapTags = tags.filter((tag) => {
    return normalized.tokens.includes(tag) || normalized.vendorHints.includes(tag) || normalized.subsystemHints.includes(tag);
  });

  if (overlapTags.length > 0) {
    intentBoost += Math.min(10, overlapTags.length * 3);
  }

  if (intentText === 'api_docs_lookup' && official) {
    intentBoost += 10;
  }

  if (SUBSTANTIVE_INTENTS.has(intentText) && tags.includes('competition-code')) {
    intentBoost += 5;
  }

  if (intentText === 'follow_up' && (tags.includes('reliable') || tags.includes('tested'))) {
    intentBoost += 3;
  }

  const dynamicWeight = dynamic && Number.isFinite(dynamic.weight)
    ? clampNumber(dynamic.weight, 0.45, 2.2)
    : 1;

  const profile = {
    id: curated.id,
    quality_score: qualityScore,
    official,
    archived,
    tags,
    style_family: curated.style_family || null,
    freshness_days: freshnessDays,
    recency_boost: recencyBoost(freshnessDays),
    base_weight: Number.isFinite(curated.base_weight) ? curated.base_weight : 1,
    dynamic_weight: dynamicWeight,
    quality_bonus: Math.round(qualityScore / 10),
    official_bonus: official ? 8 : 0,
    archived_penalty: archived ? -14 : 0,
    intent_boost: intentBoost,
    reasons: [
      `quality=${qualityScore}`,
      official ? 'official' : 'community',
      archived ? 'archived' : 'active',
      Number.isFinite(freshnessDays) ? `freshness_days=${freshnessDays}` : 'freshness_unknown',
      `dynamic_weight=${dynamicWeight.toFixed(2)}`,
      dynamic ? `dynamic_reliability=${Number(dynamic.reliability || 0).toFixed(2)}` : 'dynamic_reliability=0.00'
    ]
  };

  if (overlapTags.length > 0) {
    profile.reasons.push(`intent_tags=${overlapTags.join(',')}`);
  }
  if (curated.evidence_note) {
    profile.reasons.push(curated.evidence_note);
  }

  return profile;
}

function rankCuratedRepo(repo, dynamicWeights, intent, normalized) {
  const profile = getRepoProfile(repo.id, { map: new Map([[normalizeRepoId(repo.id), repo]]) }, dynamicWeights, intent, normalized);
  const score = profile.quality_bonus + profile.official_bonus + profile.recency_boost + profile.intent_boost + (profile.archived_penalty) + Math.round(profile.dynamic_weight * 6);
  return {
    repoId: repo.id,
    score,
    profile
  };
}

function buildGithubQuery(normalized) {
  const queryParts = [];
  if (normalized.symbols.length) {
    queryParts.push(normalized.symbols[0]);
  }
  queryParts.push(...normalized.tokens.slice(0, 6));

  let query = queryParts.join(' ');
  if (!query.trim()) query = normalized.raw;
  return query.trim();
}

function githubFallbackStatePath(config) {
  const statePath = config?.githubFallback?.circuitBreaker?.statePath;
  return path.resolve(String(statePath || DEFAULT_CONFIG.githubFallback.circuitBreaker.statePath));
}

function readGithubFallbackState(config) {
  return readJson(githubFallbackStatePath(config), {
    failures: 0,
    opened_until_ms: 0,
    last_error: null,
    last_failure_at: null,
    last_success_at: null
  });
}

function writeGithubFallbackState(config, state) {
  writeJson(githubFallbackStatePath(config), state);
}

function shouldSkipGithubFallback(config) {
  const state = readGithubFallbackState(config);
  const now = nowMs();
  if (Number(state.opened_until_ms || 0) > now) {
    const retryAfterMs = Number(state.opened_until_ms || 0) - now;
    return {
      skip: true,
      warning: `github fallback circuit open (retry in ${Math.ceil(retryAfterMs / 1000)}s)`,
      state
    };
  }
  return { skip: false, warning: null, state };
}

function recordGithubFallbackOutcome(config, success, errorMessage) {
  const cb = config?.githubFallback?.circuitBreaker || {};
  const maxFailures = Math.max(1, Number(cb.maxFailures || DEFAULT_CONFIG.githubFallback.circuitBreaker.maxFailures));
  const cooldownMs = Math.max(10_000, Number(cb.cooldownMs || DEFAULT_CONFIG.githubFallback.circuitBreaker.cooldownMs));
  const now = nowMs();
  const state = readGithubFallbackState(config);

  if (success) {
    state.failures = 0;
    state.opened_until_ms = 0;
    state.last_error = null;
    state.last_success_at = new Date(now).toISOString();
    writeGithubFallbackState(config, state);
    return;
  }

  state.failures = Number(state.failures || 0) + 1;
  state.last_error = errorMessage ? String(errorMessage).slice(0, 400) : 'unknown';
  state.last_failure_at = new Date(now).toISOString();
  if (state.failures >= maxFailures) {
    state.opened_until_ms = now + cooldownMs;
  }
  writeGithubFallbackState(config, state);
}

function runGitHubFallback(normalized, config, curatedRegistry, dynamicWeights, intent, maxMatches) {
  const ghCfg = config.githubFallback || {};
  if (!ghCfg.enabled) {
    return { ok: false, warning: 'github fallback disabled', matches: [], used: false };
  }

  const circuit = shouldSkipGithubFallback(config);
  if (circuit.skip) {
    return { ok: false, warning: circuit.warning, matches: [], used: false };
  }

  if (!hasCommand('gh')) {
    recordGithubFallbackOutcome(config, false, 'github CLI unavailable');
    return { ok: false, warning: 'github CLI unavailable', matches: [], used: false };
  }

  const query = buildGithubQuery(normalized);
  const selectedRepos = [];

  if (Array.isArray(ghCfg.repos) && ghCfg.repos.length > 0) {
    for (const repoId of ghCfg.repos) {
      const text = String(repoId || '').trim();
      if (text) selectedRepos.push(text);
    }
  } else {
    const ranked = Array.from(curatedRegistry.map.values())
      .map((repo) => rankCuratedRepo(repo, dynamicWeights, intent, normalized))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Number(ghCfg.maxReposPerQuery || DEFAULT_CONFIG.githubFallback.maxReposPerQuery)));

    for (const row of ranked) {
      selectedRepos.push(row.repoId);
    }
  }

  const perRepoLimit = Math.max(1, Math.ceil(maxMatches / Math.max(1, selectedRepos.length)));
  const matches = [];
  const warnings = [];
  let anyAttempted = false;

  for (const repoId of selectedRepos.slice(0, Math.max(1, Number(ghCfg.maxReposPerQuery || 4)))) {
    anyAttempted = true;
    const scopedQuery = `${query} repo:${repoId}`.trim();
    const out = spawnSync('gh', ['search', 'code', scopedQuery, '--language', 'Java', '--limit', String(perRepoLimit), '--json', 'path,repository,url'], {
      encoding: 'utf8',
      timeout: Number(ghCfg.commandTimeoutMs || DEFAULT_CONFIG.githubFallback.commandTimeoutMs)
    });

    if (out.error || out.status !== 0) {
      warnings.push(`github fallback repo ${repoId} failed: ${tailLines(out.stderr || (out.error ? out.error.message : ''), 4).join(' | ') || 'unknown'}`);
      continue;
    }

    let parsed = [];
    try {
      parsed = JSON.parse(out.stdout || '[]');
    } catch {
      parsed = [];
    }

    const profile = getRepoProfile(repoId, curatedRegistry, dynamicWeights, intent, normalized);

    for (const item of Array.isArray(parsed) ? parsed : []) {
      const itemRepo = item?.repository?.fullName || item?.repository?.nameWithOwner || repoId;
      matches.push(makeMatch({
        tier: 'public_frc',
        sourceId: itemRepo,
        repo: itemRepo,
        filePath: item.path || null,
        lineStart: null,
        lineEnd: null,
        symbol: normalized.symbols[0] || null,
        snippet: item.path || '',
        score: 0,
        whyMatched: 'github fallback hit from curated repo',
        url: item.url || null,
        extras: {
          style_family: profile.style_family,
          freshness_days: profile.freshness_days,
          source_weight: profile.dynamic_weight,
          quality_score: profile.quality_score,
          official_source: profile.official,
          archived_source: profile.archived,
          evidence_receipt: profile.reasons.join('; ')
        }
      }));
    }
  }

  if (matches.length === 0 && warnings.length > 0) {
    recordGithubFallbackOutcome(config, false, warnings.join(' || '));
    return {
      ok: false,
      warning: warnings.join(' || '),
      matches: [],
      used: anyAttempted
    };
  }

  if (matches.length > 0) {
    recordGithubFallbackOutcome(config, true, null);
  } else if (anyAttempted) {
    recordGithubFallbackOutcome(config, false, 'github fallback returned no matches');
  }

  return {
    ok: true,
    warning: warnings.length > 0 ? warnings.join(' || ') : null,
    matches,
    used: anyAttempted
  };
}

function findPatternCardMatches(cards, normalized, intent, limit) {
  const intentText = String(intent || '').toLowerCase();
  const candidates = [];

  for (const card of cards.slice(0, 400)) {
    if (!card || typeof card !== 'object') continue;

    const cardIntent = String(card.intent || '').toLowerCase();
    if (cardIntent && cardIntent !== intentText && intentText !== 'follow_up') {
      continue;
    }

    const queryTokens = Array.isArray(card.query_tokens)
      ? card.query_tokens.map((x) => String(x).toLowerCase())
      : [];

    let overlap = 0;
    for (const token of normalized.tokens) {
      if (queryTokens.includes(token)) overlap += 1;
    }

    if (overlap < 2 && normalized.symbols.length > 0) {
      const snippet = String(card.snippet || '');
      if (normalized.symbols.some((sym) => snippet.includes(sym))) {
        overlap = 2;
      }
    }

    if (overlap < 2) continue;

    const successRate = Number(card.success_rate || 0.5);
    const scoreHint = Number(card.score_hint || 50);
    const score = Math.round(20 + overlap * 6 + successRate * 16 + scoreHint * 0.1);

    candidates.push(makeMatch({
      tier: 'learned_pattern',
      sourceId: card.source_repo || 'pattern_cards',
      repo: card.source_repo || 'pattern_cards',
      filePath: card.source_path || null,
      lineStart: null,
      lineEnd: null,
      symbol: card.symbol || null,
      snippet: String(card.snippet || '').slice(0, 400),
      score,
      whyMatched: `learned pattern card ${card.id} overlap=${overlap}`,
      url: card.url || null,
      extras: {
        style_family: card.style_family || null,
        pattern_card_id: card.id || null,
        quality_score: Number.isFinite(Number(card.quality_score)) ? Number(card.quality_score) : null,
        source_weight: Number.isFinite(Number(card.weight_hint)) ? Number(card.weight_hint) : 1,
        evidence_receipt: `pattern_card:${card.id}`
      }
    }));
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

function scoreMatch(match, normalized, intent, repoProfile) {
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

  const intentText = String(intent || '').toLowerCase();
  let intentLaneBoost = 0;
  if (intentText === 'api_docs_lookup' && (match.tier === 'official_examples' || repoProfile.official)) {
    intentLaneBoost += 12;
  }
  if (SUBSTANTIVE_INTENTS.has(intentText) && match.tier === 'learned_pattern') {
    intentLaneBoost += 8;
  }

  const baseScore = tierBonus + tokenCoverage * 4 + symbolBonus + subsystemBonus + markdownPenalty + intentLaneBoost;
  const profileAdd = repoProfile.quality_bonus + repoProfile.official_bonus + repoProfile.recency_boost + repoProfile.archived_penalty + repoProfile.intent_boost;
  const weighted = (baseScore + profileAdd) * Math.max(0.3, Math.min(repoProfile.base_weight * repoProfile.dynamic_weight, 2.8));

  return {
    ...match,
    score: Math.round(weighted),
    style_family: match.style_family || repoProfile.style_family || null,
    freshness_days: match.freshness_days == null ? repoProfile.freshness_days : match.freshness_days,
    source_weight: match.source_weight == null ? repoProfile.dynamic_weight : match.source_weight,
    quality_score: match.quality_score == null ? repoProfile.quality_score : match.quality_score,
    official_source: match.official_source == null ? repoProfile.official : match.official_source,
    archived_source: match.archived_source == null ? repoProfile.archived : match.archived_source,
    evidence_receipt: match.evidence_receipt || repoProfile.reasons.join('; ')
  };
}

function dedupeMatches(matches, maxMatches, perRepoCap) {
  const sorted = Array.isArray(matches) ? matches.slice().sort((a, b) => b.score - a.score) : [];
  const globalSeen = new Set();
  const repoSnippetSeen = new Set();
  const out = [];
  const perRepoCount = new Map();

  function repoKey(match) {
    return normalizeRepoId(match.repo || match.source_id || 'unknown') || 'unknown';
  }

  function canonicalKey(match) {
    const repo = repoKey(match);
    const pathKey = String(match.path || '').toLowerCase();
    const lineStart = Number(match.line_start || 0) || 0;
    const card = String(match.pattern_card_id || '');
    return `${repo}|${pathKey}|${lineStart}|${card}|${snippetHash(match.snippet)}`;
  }

  for (const match of sorted) {
    if (out.length >= maxMatches) break;
    const repo = repoKey(match);
    const key = canonicalKey(match);
    if (globalSeen.has(key)) continue;
    globalSeen.add(key);

    const repoSnippetKey = `${repo}|${snippetHash(match.snippet)}`;
    if (repoSnippetSeen.has(repoSnippetKey)) continue;

    const count = perRepoCount.get(repo) || 0;
    if (count >= perRepoCap) continue;

    out.push(match);
    repoSnippetSeen.add(repoSnippetKey);
    perRepoCount.set(repo, count + 1);
  }

  if (out.length >= maxMatches) return out.slice(0, maxMatches);

  for (const match of sorted) {
    if (out.length >= maxMatches) break;
    const repo = repoKey(match);
    const key = canonicalKey(match);
    if (globalSeen.has(`secondary|${key}`)) continue;
    globalSeen.add(`secondary|${key}`);
    const count = perRepoCount.get(repo) || 0;
    if (count >= perRepoCap) continue;
    if (out.some((row) => canonicalKey(row) === key)) continue;
    out.push(match);
    perRepoCount.set(repo, count + 1);
  }

  return out.slice(0, maxMatches);
}

function buildSourceReceipts(matches) {
  const grouped = new Map();

  for (const match of matches) {
    const repo = match.repo || match.source_id || 'unknown';
    if (!grouped.has(repo)) {
      grouped.set(repo, {
        repo,
        style_family: match.style_family || null,
        official_source: Boolean(match.official_source),
        archived_source: Boolean(match.archived_source),
        freshness_days: Number.isFinite(Number(match.freshness_days)) ? Number(match.freshness_days) : null,
        source_weight: Number.isFinite(Number(match.source_weight)) ? Number(match.source_weight) : 1,
        quality_score: Number.isFinite(Number(match.quality_score)) ? Number(match.quality_score) : null,
        match_count: 0,
        top_score: Number(match.score || 0),
        sample_path: match.path || null,
        evidence_receipts: []
      });
    }

    const row = grouped.get(repo);
    row.match_count += 1;
    row.top_score = Math.max(row.top_score, Number(match.score || 0));
    if (!row.sample_path && match.path) row.sample_path = match.path;
    if (match.evidence_receipt) {
      row.evidence_receipts.push(String(match.evidence_receipt));
    }
  }

  const receipts = Array.from(grouped.values()).map((row) => {
    row.evidence_receipts = Array.from(new Set(row.evidence_receipts)).slice(0, 4);
    return row;
  });

  return receipts.sort((a, b) => b.top_score - a.top_score);
}

function computeFreshnessBadge(receipts) {
  if (!Array.isArray(receipts) || receipts.length === 0) return 'unknown';
  const hasFreshOfficial = receipts.some((r) => r.official_source && Number.isFinite(r.freshness_days) && r.freshness_days <= 60);
  if (hasFreshOfficial) return 'fresh_official';

  const hasFresh = receipts.some((r) => Number.isFinite(r.freshness_days) && r.freshness_days <= 90);
  if (hasFresh) return 'fresh_mixed';

  const hasStale = receipts.some((r) => Number.isFinite(r.freshness_days) && r.freshness_days > 365);
  if (hasStale) return 'stale_risk';

  return 'mixed';
}

function computeConfidence(finalMatches, receipts) {
  if (!Array.isArray(finalMatches) || finalMatches.length === 0) return 'low';

  const topScore = Number(finalMatches[0].score || 0);
  const hasStrongLane = finalMatches.some((m) => m.tier === 'gatorbots' || m.tier === 'official_examples' || m.tier === 'learned_pattern');
  const hasOfficial = receipts.some((r) => r.official_source);

  if (finalMatches.length >= 4 && topScore >= 70 && (hasStrongLane || hasOfficial)) return 'high';
  if (finalMatches.length >= 2 && topScore >= 45) return 'medium';
  return 'low';
}

function buildCoverageNote(finalMatches, receipts, confidence) {
  if (finalMatches.length === 0) {
    return 'No strong match; retrieval was sparse across configured lanes.';
  }

  const officialCount = receipts.filter((r) => r.official_source).length;
  const activeCount = receipts.filter((r) => !r.archived_source).length;

  if (confidence === 'high') {
    return `Strong coverage with ${finalMatches.length} matches; ${officialCount} official source group(s), ${activeCount} active source group(s).`;
  }
  if (confidence === 'medium') {
    return `Moderate coverage with ${finalMatches.length} matches; verify implementation details against official APIs.`;
  }
  return 'Low confidence retrieval; use matches as hints and validate against official docs before deployment.';
}

function evaluateQualityGate(matches, receipts, config) {
  const gate = config.qualityGate || DEFAULT_CONFIG.qualityGate;
  if (!gate.enabled) {
    return { passed: true, reasons: [] };
  }

  const rows = Array.isArray(matches) ? matches : [];
  const topScore = Number(rows[0]?.score || 0);
  const distinctRepos = new Set(rows.map((m) => normalizeRepoId(m.repo || m.source_id || 'unknown'))).size;
  const receiptCount = Array.isArray(receipts) ? receipts.length : 0;
  const hasStrongLane = rows.some((m) => m.tier === 'gatorbots' || m.tier === 'official_examples' || m.tier === 'learned_pattern');
  const reasons = [];

  if (rows.length === 0) reasons.push('no_matches');
  if (topScore < Number(gate.minTopScore || 0)) reasons.push(`top_score_below_${Number(gate.minTopScore || 0)}`);
  if (distinctRepos < Number(gate.minDistinctRepos || 0)) reasons.push(`distinct_repos_below_${Number(gate.minDistinctRepos || 0)}`);
  if (receiptCount < Number(gate.minEvidenceReceipts || 0)) reasons.push(`receipts_below_${Number(gate.minEvidenceReceipts || 0)}`);
  if (gate.requireStrongLaneForHigh && !hasStrongLane) reasons.push('no_strong_lane');

  return {
    passed: reasons.length === 0,
    reasons
  };
}

function metricsPath(config) {
  const file = config?.observability?.metricsPath || DEFAULT_CONFIG.observability.metricsPath;
  return path.resolve(String(file));
}

function recordPatternScoutMetrics(config, sample) {
  const pathOut = metricsPath(config);
  const prev = readJson(pathOut, {
    version: 1,
    updated_at: null,
    totals: {
      requests: 0,
      cache_hits: 0,
      empty_results: 0,
      fallback_used: 0,
      fallback_errors: 0,
      lane_parallel_used: 0
    },
    lane_latency_ms: {},
    recent: []
  });

  const totals = prev.totals || {};
  totals.requests = Number(totals.requests || 0) + 1;
  totals.cache_hits = Number(totals.cache_hits || 0) + (sample.cacheHit ? 1 : 0);
  totals.empty_results = Number(totals.empty_results || 0) + (Number(sample.resultCount || 0) === 0 ? 1 : 0);
  totals.fallback_used = Number(totals.fallback_used || 0) + (sample.fallbackUsed ? 1 : 0);
  totals.fallback_errors = Number(totals.fallback_errors || 0) + (sample.fallbackError ? 1 : 0);
  totals.lane_parallel_used = Number(totals.lane_parallel_used || 0) + (sample.laneParallelUsed ? 1 : 0);

  const laneLatency = prev.lane_latency_ms && typeof prev.lane_latency_ms === 'object' ? prev.lane_latency_ms : {};
  const laneTimings = sample.laneTimings && typeof sample.laneTimings === 'object' ? sample.laneTimings : {};
  for (const [lane, elapsed] of Object.entries(laneTimings)) {
    const value = Number(elapsed || 0);
    if (!Number.isFinite(value) || value < 0) continue;
    if (!laneLatency[lane]) {
      laneLatency[lane] = { total_ms: 0, count: 0, avg_ms: 0 };
    }
    laneLatency[lane].total_ms += value;
    laneLatency[lane].count += 1;
    laneLatency[lane].avg_ms = Math.round((laneLatency[lane].total_ms / Math.max(1, laneLatency[lane].count)) * 100) / 100;
  }

  const recent = Array.isArray(prev.recent) ? prev.recent : [];
  recent.push({
    at: new Date().toISOString(),
    cache_hit: Boolean(sample.cacheHit),
    result_count: Number(sample.resultCount || 0),
    confidence: sample.confidence || 'unknown',
    lane_timings: laneTimings,
    lane_parallel_used: Boolean(sample.laneParallelUsed)
  });
  const keepLast = Math.max(20, Number(config?.observability?.keepLastSamples || DEFAULT_CONFIG.observability.keepLastSamples));

  writeJson(pathOut, {
    version: 1,
    updated_at: new Date().toISOString(),
    totals,
    lane_latency_ms: laneLatency,
    recent: recent.slice(-keepLast)
  });
}

function laneBudget(config, lane) {
  const budgets = config?.laneBudgetsMs || DEFAULT_CONFIG.laneBudgetsMs;
  const value = Number(budgets?.[lane]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function trimCache(cache, maxEntries) {
  const keys = Object.keys(cache || {});
  if (keys.length <= maxEntries) return cache;
  const sortable = keys
    .map((key) => ({ key, ts: Number(cache[key]?.ts || 0) }))
    .sort((a, b) => b.ts - a.ts);
  const trimmed = {};
  for (const row of sortable.slice(0, maxEntries)) {
    trimmed[row.key] = cache[row.key];
  }
  return trimmed;
}

function runParallelLaneBatch(lanes, options) {
  const items = Array.isArray(lanes) ? lanes.filter(Boolean) : [];
  if (items.length === 0) {
    return { ok: true, results: [], warnings: [] };
  }

  const opts = options || {};
  if (!fs.existsSync(PARALLEL_LANE_RUNNER_PATH)) {
    return {
      ok: false,
      results: [],
      warnings: ['parallel lane runner missing; falling back to sequential lane execution']
    };
  }

  const maxConcurrent = clampNumber(
    Number(opts.maxConcurrent || Math.min(PARALLEL_LANE_MAX_CONCURRENCY, items.length)),
    1,
    PARALLEL_LANE_MAX_CONCURRENCY
  );
  const estimatedMs = items.reduce((sum, lane) => {
    const budget = Number(lane?.options?.budgetMs || 500);
    return sum + (Number.isFinite(budget) ? Math.max(150, budget) : 500);
  }, 0);
  const timeoutMs = Math.max(3000, Number(opts.timeoutMs || estimatedMs + 8000));

  const out = spawnSync(process.execPath, [PARALLEL_LANE_RUNNER_PATH], {
    input: JSON.stringify({
      lanes: items,
      maxConcurrent
    }),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  });

  if (out.error || out.status !== 0) {
    const errTail = tailLines(out.stderr || (out.error ? out.error.message : ''), 8).join(' | ');
    return {
      ok: false,
      results: [],
      warnings: [`parallel lane execution failed; fallback to sequential (${errTail || 'unknown'})`]
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(String(out.stdout || '{}'));
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      results: [],
      warnings: ['parallel lane runner returned invalid JSON; falling back to sequential']
    };
  }

  const runnerWarnings = Array.isArray(parsed.warnings) ? parsed.warnings.map((w) => String(w)) : [];
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return {
    ok: Boolean(parsed.ok),
    results,
    warnings: runnerWarnings
  };
}

function patternScoutWorker(payload) {
  const requestId = payload?.request_id || null;
  const config = resolveConfig(payload);
  const normalized = normalizeQuery(payload?.query || payload?.user_message || '');
  const intent = String(payload?.intent || 'general_or_non_frc');
  const started = nowMs();
  const warnings = [];
  const laneTimings = {};
  const snapshotMemo = new Map();

  if (!config.enabled) {
    const latencyDisabled = nowMs() - started;
    return {
      request_id: requestId,
      contract_version: CONTRACT_VERSION,
      status: 'success',
      kind: 'retrieval',
      summary: 'PatternScout disabled in config',
      matches: [],
      retrieval_summary: 'PatternScout disabled in config',
      coverage_note: 'PatternScout disabled in config',
      retrieval_latency_ms: latencyDisabled,
      source_tiers_used: [],
      source_receipts: [],
      freshness_badge: 'unknown',
      confidence: 'low',
      warnings: ['patternscout disabled'],
      contract_flags: {
        reviewed: false,
        escalated: false,
        implementation_safe: false,
        pattern_only: true
      },
      telemetry_hints: {
        cache_hit: false,
        elapsed_time_ms: latencyDisabled,
        lane_timings: {}
      },
      error: null
    };
  }

  const curatedRegistry = loadCuratedRegistry(config);
  const dynamicWeights = loadDynamicWeights(config);
  const patternCards = loadPatternCards(config);

  const sourceSnapshots = {};
  if (Array.isArray(config.repoMirrors) && config.repoMirrors.length > 0) {
    for (const mirror of config.repoMirrors) {
      const localPath = path.resolve(String(mirror.localPath || ''));
      const label = `repo:${mirror.id || path.basename(localPath)}`;
      sourceSnapshots[label] = resolveRootSnapshot(localPath, { snapshotMemo, timeoutMs: 1200 });
    }
  } else {
    sourceSnapshots.workspace = resolveRootSnapshot(process.cwd(), { snapshotMemo, timeoutMs: 1200 });
  }
  for (const docsRoot of config.docsRoots || []) {
    const root = path.resolve(String(docsRoot));
    sourceSnapshots[`docs:${root}`] = resolveRootSnapshot(root, { snapshotMemo, timeoutMs: 1200 });
  }
  for (const officialRoot of config.officialRoots || []) {
    const root = path.resolve(String(officialRoot));
    sourceSnapshots[`official:${root}`] = resolveRootSnapshot(root, { snapshotMemo, timeoutMs: 1200 });
  }

  const sourceSet = {
    intent,
    repoMirrors: config.repoMirrors,
    docsRoots: config.docsRoots,
    officialRoots: config.officialRoots,
    githubFallback: config.githubFallback,
    sourceSnapshots,
    curatedRegistryVersion: fileVersion(config.curatedRegistryPath),
    dynamicWeightsVersion: fileVersion(config.dynamicWeightsPath),
    patternCardsVersion: fileVersion(config.patternCardsPath)
  };

  const cache = readCache(config);
  const key = cacheKey(normalized, sourceSet);
  const cached = cache[key];
  const fresh = cached && typeof cached.ts === 'number' && (nowMs() - cached.ts) <= Number(config.cacheTtlMs || DEFAULT_CONFIG.cacheTtlMs);

  if (fresh && Array.isArray(cached.matches)) {
    const latency = nowMs() - started;
    recordPatternScoutMetrics(config, {
      cacheHit: true,
      resultCount: cached.matches.length,
      confidence: cached.confidence || 'unknown',
      laneTimings: cached.lane_timings || {},
      fallbackUsed: Boolean(cached.fallback_used),
      fallbackError: false,
      laneParallelUsed: Boolean(cached.lane_parallel_used)
    });
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
      source_receipts: cached.source_receipts || [],
      freshness_badge: cached.freshness_badge || 'unknown',
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
        elapsed_time_ms: latency,
        lane_timings: cached.lane_timings || {},
        lane_parallel_used: Boolean(cached.lane_parallel_used)
      },
      error: null
    };
  }

  const maxMatches = Math.max(1, Math.min(Number(payload?.max_matches || config.maxMatches || DEFAULT_CONFIG.maxMatches), 20));
  const perRepoCap = Math.max(1, Math.min(Number(config.diversityPerRepoCap || DEFAULT_CONFIG.diversityPerRepoCap), 6));
  const allMatches = [];

  // Local lanes (gatorbots/docs/official) executed in parallel worker processes.
  const localLaneRequests = [];
  let laneRequestIndex = 0;

  if (Array.isArray(config.repoMirrors) && config.repoMirrors.length > 0) {
    for (const mirror of config.repoMirrors) {
      const baseDir = path.resolve(String(mirror.localPath || ''));
      const laneTier = mirror.tier || 'gatorbots';
      const laneRepo = mirror.id || path.basename(baseDir || 'mirror');
      const profile = getRepoProfile(laneRepo, curatedRegistry, dynamicWeights, intent, normalized);
      const snapshotLabel = `repo:${mirror.id || path.basename(baseDir)}`;
      localLaneRequests.push({
        id: `lane_${laneRequestIndex++}`,
        laneName: 'gatorbots',
        laneTier,
        laneRepo,
        baseDir,
        normalized,
        limit: maxMatches,
        extraFields: {
          style_family: profile.style_family,
          freshness_days: profile.freshness_days,
          source_weight: profile.dynamic_weight,
          quality_score: profile.quality_score,
          official_source: profile.official,
          archived_source: profile.archived,
          evidence_receipt: profile.reasons.join('; ')
        },
        options: {
          config: {
            indexDir: config.indexDir,
            indexMaxEntriesPerToken: config.indexMaxEntriesPerToken,
            searchCommandTimeoutMs: config.searchCommandTimeoutMs
          },
          rootSnapshot: sourceSnapshots[snapshotLabel],
          budgetMs: laneBudget(config, 'gatorbots'),
          searchTimeoutMs: Number(config.searchCommandTimeoutMs || DEFAULT_CONFIG.searchCommandTimeoutMs),
          perRepoCap
        }
      });
    }
  } else {
    const profile = getRepoProfile('workspace', curatedRegistry, dynamicWeights, intent, normalized);
    localLaneRequests.push({
      id: `lane_${laneRequestIndex++}`,
      laneName: 'gatorbots',
      laneTier: 'gatorbots',
      laneRepo: 'workspace',
      baseDir: process.cwd(),
      normalized,
      limit: maxMatches,
      extraFields: {
        style_family: profile.style_family,
        freshness_days: profile.freshness_days,
        source_weight: profile.dynamic_weight,
        quality_score: profile.quality_score,
        official_source: profile.official,
        archived_source: profile.archived,
        evidence_receipt: profile.reasons.join('; ')
      },
      options: {
        config: {
          indexDir: config.indexDir,
          indexMaxEntriesPerToken: config.indexMaxEntriesPerToken,
          searchCommandTimeoutMs: config.searchCommandTimeoutMs
        },
        rootSnapshot: sourceSnapshots.workspace,
        budgetMs: laneBudget(config, 'gatorbots'),
        searchTimeoutMs: Number(config.searchCommandTimeoutMs || DEFAULT_CONFIG.searchCommandTimeoutMs),
        perRepoCap
      }
    });
  }

  for (const docsRoot of config.docsRoots || []) {
    const root = path.resolve(String(docsRoot));
    localLaneRequests.push({
      id: `lane_${laneRequestIndex++}`,
      laneName: 'docs_memory',
      laneTier: 'docs_memory',
      laneRepo: 'docs_memory',
      baseDir: root,
      normalized,
      limit: maxMatches,
      extraFields: null,
      options: {
        config: {
          indexDir: config.indexDir,
          indexMaxEntriesPerToken: config.indexMaxEntriesPerToken,
          searchCommandTimeoutMs: config.searchCommandTimeoutMs
        },
        rootSnapshot: sourceSnapshots[`docs:${root}`],
        budgetMs: laneBudget(config, 'docs_memory'),
        searchTimeoutMs: Number(config.searchCommandTimeoutMs || DEFAULT_CONFIG.searchCommandTimeoutMs),
        perRepoCap
      }
    });
  }

  for (const officialRoot of config.officialRoots || []) {
    const root = path.resolve(String(officialRoot));
    localLaneRequests.push({
      id: `lane_${laneRequestIndex++}`,
      laneName: 'official_examples',
      laneTier: 'official_examples',
      laneRepo: 'official_examples',
      baseDir: root,
      normalized,
      limit: maxMatches,
      extraFields: {
        official_source: true,
        evidence_receipt: 'official_examples_lane'
      },
      options: {
        config: {
          indexDir: config.indexDir,
          indexMaxEntriesPerToken: config.indexMaxEntriesPerToken,
          searchCommandTimeoutMs: config.searchCommandTimeoutMs
        },
        rootSnapshot: sourceSnapshots[`official:${root}`],
        budgetMs: laneBudget(config, 'official_examples'),
        searchTimeoutMs: Number(config.searchCommandTimeoutMs || DEFAULT_CONFIG.searchCommandTimeoutMs),
        perRepoCap
      }
    });
  }

  let laneParallelUsed = false;
  const parallelResult = runParallelLaneBatch(localLaneRequests, {
    maxConcurrent: Math.min(PARALLEL_LANE_MAX_CONCURRENCY, localLaneRequests.length || 1),
    timeoutMs: localLaneRequests.reduce((sum, lane) => sum + Math.max(150, Number(lane?.options?.budgetMs || 500)), 0) + 10000
  });
  warnings.push(...(parallelResult.warnings || []));

  if (parallelResult.ok && Array.isArray(parallelResult.results) && parallelResult.results.length > 0) {
    laneParallelUsed = true;
    for (const row of parallelResult.results) {
      const laneName = String(row?.laneName || row?.metadata?.lane || 'unknown');
      const elapsed = Number(row?.metadata?.elapsed_ms || 0);
      if (Number.isFinite(elapsed) && elapsed > 0) {
        laneTimings[laneName] = Number(laneTimings[laneName] || 0) + elapsed;
      }
      if (Array.isArray(row?.matches)) {
        allMatches.push(...row.matches);
      }
      if (Array.isArray(row?.warnings)) {
        warnings.push(...row.warnings.map((w) => String(w)));
      }
      if (row?.error) {
        warnings.push(`lane ${laneName} error: ${String(row.error).slice(0, 240)}`);
      }
    }
  } else {
    for (const lane of localLaneRequests) {
      const detailed = searchLocalLaneDetailed(
        lane.baseDir,
        lane.normalized,
        lane.laneTier,
        lane.laneRepo,
        lane.limit,
        lane.extraFields,
        {
          config,
          snapshotMemo,
          rootSnapshot: lane.options?.rootSnapshot,
          budgetMs: lane.options?.budgetMs,
          searchTimeoutMs: lane.options?.searchTimeoutMs,
          perRepoCap: lane.options?.perRepoCap
        }
      );
      const laneName = lane.laneName || lane.laneTier || 'unknown';
      laneTimings[laneName] = Number(laneTimings[laneName] || 0) + Number(detailed.metadata?.elapsed_ms || 0);
      allMatches.push(...(detailed.matches || []));
      warnings.push(...(detailed.warnings || []));
    }
  }

  // Lane B: learned pattern cards from prior successes
  const laneCardStart = nowMs();
  if (allMatches.length < maxMatches && Array.isArray(patternCards.cards) && patternCards.cards.length > 0) {
    allMatches.push(...findPatternCardMatches(patternCards.cards, normalized, intent, maxMatches - allMatches.length));
  }
  laneTimings.learned_pattern = nowMs() - laneCardStart;

  // Lane E: github fallback scoped to curated high-quality repos
  let fallbackUsed = false;
  let fallbackError = false;
  const laneFallbackStart = nowMs();
  if (allMatches.length < Math.max(2, Math.floor(maxMatches / 2))) {
    const fallback = runGitHubFallback(normalized, config, curatedRegistry, dynamicWeights, intent, maxMatches - allMatches.length);
    fallbackUsed = Boolean(fallback.used);
    if (!fallback.ok) fallbackError = true;
    if (fallback.warning) warnings.push(fallback.warning);
    allMatches.push(...fallback.matches);
  }
  laneTimings.public_frc = nowMs() - laneFallbackStart;

  const scored = allMatches
    .map((match) => {
      const repoId = match.repo || match.source_id || null;
      const profile = getRepoProfile(repoId, curatedRegistry, dynamicWeights, intent, normalized);
      return scoreMatch(match, normalized, intent, profile);
    })
    .sort((a, b) => b.score - a.score);

  let finalMatches = dedupeMatches(scored, maxMatches, perRepoCap);
  let sourceReceipts = buildSourceReceipts(finalMatches);
  let tiersUsed = Array.from(new Set(finalMatches.map((m) => m.tier)));
  let freshnessBadge = computeFreshnessBadge(sourceReceipts);
  let confidence = computeConfidence(finalMatches, sourceReceipts);
  const qualityGate = evaluateQualityGate(finalMatches, sourceReceipts, config);
  if (!qualityGate.passed) {
    warnings.push(`quality gate rejected retrieval (${qualityGate.reasons.join(', ')})`);
    finalMatches = [];
    sourceReceipts = [];
    tiersUsed = [];
    freshnessBadge = 'unknown';
    confidence = 'low';
  }
  if (!qualityGate.passed && scored.length > 0) {
    // Soft-fail behavior: keep a tiny set of best-effort evidence with explicit warnings
    // instead of returning an empty retrieval payload.
    const softLimit = Math.min(2, Math.max(1, maxMatches));
    finalMatches = dedupeMatches(scored, softLimit, 1).map((row) => ({
      ...row,
      why_matched: `${row.why_matched || 'matched pattern'} [quality-gate-soft-fail]`
    }));
    sourceReceipts = buildSourceReceipts(finalMatches);
    tiersUsed = Array.from(new Set(finalMatches.map((m) => m.tier)));
    freshnessBadge = computeFreshnessBadge(sourceReceipts);
    confidence = 'low';
  }

  const coverageNote = qualityGate.passed
    ? buildCoverageNote(finalMatches, sourceReceipts, confidence)
    : 'Insufficient retrieval evidence after quality gate; returning low-confidence hints only. Verify against official docs before implementation.';

  const retrievalSummary = finalMatches.length
    ? `Found ${finalMatches.length} weighted match(es) across ${tiersUsed.join(', ')}`
    : 'Insufficient high-quality retrieval matches found';

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
    source_receipts: sourceReceipts,
    freshness_badge: freshnessBadge,
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
      elapsed_time_ms: latency,
      lane_timings: laneTimings,
      lane_parallel_used: laneParallelUsed,
      quality_gate_passed: qualityGate.passed,
      source_snapshot_count: Object.keys(sourceSnapshots).length
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
    source_receipts: result.source_receipts,
    freshness_badge: result.freshness_badge,
    confidence: result.confidence,
    warnings: result.warnings,
    lane_timings: laneTimings,
    fallback_used: fallbackUsed,
    lane_parallel_used: laneParallelUsed
  };
  writeCache(config, trimCache(cache, Math.max(20, Number(config.cacheMaxEntries || DEFAULT_CONFIG.cacheMaxEntries))));
  recordPatternScoutMetrics(config, {
    cacheHit: false,
    resultCount: result.matches.length,
    confidence: result.confidence,
    laneTimings,
    fallbackUsed,
    fallbackError,
    laneParallelUsed
  });

  return result;
}

module.exports = {
  DEFAULT_CONFIG,
  CACHE_TTL_MS: DEFAULT_CONFIG.cacheTtlMs,
  CACHE_FILE: getCacheFile(DEFAULT_CONFIG),
  normalizeQuery,
  normalizeRepoId,
  patternScoutWorker,
  runGitHubFallback,
  searchLocalLane,
  searchLocalLaneDetailed,
  cacheKey,
  readCache,
  writeCache,
  loadCuratedRegistry,
  loadDynamicWeights,
  loadPatternCards,
  getRepoProfile,
  scoreMatch,
  dedupeMatches,
  buildSourceReceipts
};
