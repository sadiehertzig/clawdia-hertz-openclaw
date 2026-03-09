#!/usr/bin/env node
'use strict';

const { fork } = require('child_process');
const os = require('os');
const path = require('path');

const WORKER_PATH = path.resolve(__dirname, 'patternscout-parallel-lane-worker.js');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.resume();
  });
}

function laneTimeoutMs(lane) {
  const budget = Number(lane?.options?.budgetMs || 500);
  const base = Number.isFinite(budget) ? budget : 500;
  return clamp(base + 2500, 1500, 30000);
}

function runLane(lane) {
  return new Promise((resolve) => {
    const child = fork(WORKER_PATH, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });

    let settled = false;
    const started = Date.now();
    const timeoutMs = laneTimeoutMs(lane);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // no-op
      }
      resolve({
        id: lane?.id || null,
        laneName: lane?.laneName || lane?.laneTier || 'unknown',
        matches: [],
        warnings: [`lane timed out after ${timeoutMs}ms`],
        metadata: {
          lane: lane?.laneName || lane?.laneTier || 'unknown',
          elapsed_ms: Date.now() - started,
          timed_out: true
        },
        error: 'lane_timeout'
      });
    }, timeoutMs);

    child.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = msg && typeof msg === 'object' ? msg : {};
      out.metadata = out.metadata && typeof out.metadata === 'object' ? out.metadata : {};
      if (!Number.isFinite(Number(out.metadata.elapsed_ms))) {
        out.metadata.elapsed_ms = Date.now() - started;
      }
      resolve(out);
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        id: lane?.id || null,
        laneName: lane?.laneName || lane?.laneTier || 'unknown',
        matches: [],
        warnings: [`lane worker exited code=${code} signal=${signal}`],
        metadata: {
          lane: lane?.laneName || lane?.laneTier || 'unknown',
          elapsed_ms: Date.now() - started
        },
        error: 'lane_worker_exit'
      });
    });

    child.send({ lane });
  });
}

async function runPool(lanes, maxConcurrent) {
  const queue = Array.isArray(lanes) ? lanes.slice() : [];
  const results = new Array(queue.length);
  let cursor = 0;

  async function workerLoop() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;
      results[index] = await runLane(queue[index]);
    }
  }

  const concurrency = clamp(Number(maxConcurrent || 1), 1, Math.max(1, queue.length));
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(workerLoop());
  }
  await Promise.all(workers);
  return results.filter(Boolean);
}

async function main() {
  const raw = await readStdin();
  let parsed = null;
  try {
    parsed = JSON.parse(String(raw || '{}'));
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== 'object') {
    process.stdout.write(JSON.stringify({
      ok: false,
      warnings: ['invalid JSON payload'],
      results: []
    }) + '\n');
    process.exit(0);
  }

  const lanes = Array.isArray(parsed.lanes) ? parsed.lanes : [];
  const maxConcurrent = clamp(
    Number(parsed.maxConcurrent || Math.min(4, os.cpus()?.length || 2)),
    1,
    8
  );

  const results = await runPool(lanes, maxConcurrent);
  process.stdout.write(JSON.stringify({
    ok: true,
    warnings: [],
    results
  }) + '\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(JSON.stringify({
      ok: false,
      warnings: [err instanceof Error ? err.message : String(err)],
      results: []
    }) + '\n');
  });
}

module.exports = {
  runPool,
  runLane
};
