#!/usr/bin/env node
'use strict';

const { searchLocalLaneDetailed } = require('../agents/clawdia/runtime/patternscout_worker');

function runLane(lane) {
  const req = lane && typeof lane === 'object' ? lane : {};
  const result = searchLocalLaneDetailed(
    req.baseDir,
    req.normalized || {},
    req.laneTier || 'docs_memory',
    req.laneRepo || 'unknown',
    Math.max(1, Number(req.limit || 1)),
    req.extraFields || null,
    req.options || {}
  );

  return {
    id: req.id || null,
    laneName: req.laneName || req.laneTier || 'unknown',
    matches: Array.isArray(result.matches) ? result.matches : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    metadata: result.metadata && typeof result.metadata === 'object'
      ? result.metadata
      : {}
  };
}

process.on('message', (msg) => {
  const lane = msg && typeof msg === 'object' ? msg.lane : null;
  try {
    const out = runLane(lane);
    if (typeof process.send === 'function') {
      process.send(out);
    }
    process.exit(0);
  } catch (err) {
    if (typeof process.send === 'function') {
      process.send({
        id: lane?.id || null,
        laneName: lane?.laneName || lane?.laneTier || 'unknown',
        matches: [],
        warnings: [],
        metadata: {},
        error: err instanceof Error ? err.message : String(err)
      });
    }
    process.exit(1);
  }
});

