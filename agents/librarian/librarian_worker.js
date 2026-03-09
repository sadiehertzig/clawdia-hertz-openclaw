'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Librarian worker — docs-truth evidence provider.
 *
 * Searches local curated docs and memory directories for API references,
 * facts, and sourced evidence. Downstream Builder/Arbiter consume Librarian
 * output as ground truth for FRC answers.
 */

const DOCS_DIRS = [
  path.resolve(__dirname, '..', 'clawdia', 'memory', 'docs'),
  path.resolve(__dirname, '..', 'arbiter', 'memory', 'docs'),
  path.resolve(__dirname, '..', '..', 'memory', 'wpilib'),
  path.resolve(__dirname, '..', '..', 'memory', 'vendors'),
  path.resolve(__dirname, '..', '..', 'docs')
];

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .slice(0, 10);
}

function walkFiles(dirPath, limit) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  function walk(dir) {
    if (results.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (results.length >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }

  walk(dirPath);
  return results;
}

function scoreFile(filePath, tokens) {
  let content;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 512 * 1024) return null;
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lower = content.toLowerCase();
  let hits = 0;
  const matchedTokens = [];

  for (const token of tokens) {
    if (lower.includes(token)) {
      hits++;
      matchedTokens.push(token);
    }
  }

  if (hits === 0) return null;

  return {
    path: filePath,
    content,
    hits,
    matchedTokens,
    score: hits / tokens.length
  };
}

function extractApis(content, tokens) {
  const apis = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const lower = line.toLowerCase();
    // Look for API-like patterns: method signatures, class names, constructors
    if (/(?:class|interface|new|import|public|private|protected|void|static)\s+\w+/i.test(line)) {
      if (tokens.some((t) => lower.includes(t))) {
        apis.push(line.trim().slice(0, 200));
      }
    }
    // Markdown headers that mention tokens
    if (/^#{1,4}\s/.test(line) && tokens.some((t) => lower.includes(t))) {
      apis.push(line.replace(/^#+\s*/, '').trim().slice(0, 200));
    }
  }

  return [...new Set(apis)].slice(0, 12);
}

function extractFacts(content, tokens) {
  const facts = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    if (!tokens.some((t) => lower.includes(t))) continue;

    const trimmed = line.trim();
    // Bullet points, numbered lists, or short declarative lines
    if (/^[-*•]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
      facts.push(trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').slice(0, 300));
    } else if (trimmed.length > 20 && trimmed.length < 300 && !trimmed.startsWith('#')) {
      facts.push(trimmed.slice(0, 300));
    }
  }

  return [...new Set(facts)].slice(0, 16);
}

function librarianWorker(payload) {
  const requestId = payload?.request_id || null;
  const query = String(payload?.user_message || payload?.query || '').trim();
  const tokens = tokenize(query);
  const started = Date.now();

  if (!tokens.length) {
    return {
      request_id: requestId,
      status: 'success',
      kind: 'docs_truth',
      summary: 'No searchable terms found in query',
      key_apis: [],
      facts: [],
      sources: [],
      warnings: ['query contained no searchable tokens'],
      contract_flags: { reviewed: false, escalated: false, implementation_safe: true, pattern_only: true }
    };
  }

  const allFiles = [];
  for (const dir of DOCS_DIRS) {
    allFiles.push(...walkFiles(dir, 200));
  }

  const scored = [];
  for (const filePath of allFiles) {
    const result = scoreFile(filePath, tokens);
    if (result) scored.push(result);
  }

  scored.sort((a, b) => b.score - a.score || b.hits - a.hits);
  const topFiles = scored.slice(0, 8);

  const key_apis = [];
  const facts = [];
  const sources = [];

  for (const file of topFiles) {
    key_apis.push(...extractApis(file.content, tokens));
    facts.push(...extractFacts(file.content, tokens));
    sources.push({
      path: path.relative(process.cwd(), file.path),
      score: file.score,
      matched_tokens: file.matchedTokens
    });
  }

  const elapsed = Date.now() - started;

  return {
    request_id: requestId,
    status: 'success',
    kind: 'docs_truth',
    summary: topFiles.length
      ? `Found ${topFiles.length} relevant doc sources with ${[...new Set(key_apis)].length} API references`
      : 'No relevant documentation found for query',
    key_apis: [...new Set(key_apis)].slice(0, 12),
    facts: [...new Set(facts)].slice(0, 16),
    sources,
    warnings: topFiles.length === 0 ? ['no local docs matched the query'] : [],
    contract_flags: { reviewed: false, escalated: false, implementation_safe: true, pattern_only: true },
    telemetry_hints: { elapsed_time_ms: elapsed }
  };
}

module.exports = { librarianWorker, DOCS_DIRS, tokenize };
