#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../agents/clawdia/runtime/gatorbots_helpdesk_runtime');

function parseArgs(argv) {
  const args = {
    requestId: null,
    label: null,
    source: 'manual',
    note: null,
    runtimeRoot: path.resolve(__dirname, '..', 'runtime_state', 'dossiers', 'sessions'),
    sessionId: null
  };

  if (argv.length >= 2) {
    args.requestId = argv[0];
    args.label = argv[1];
  }

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--source') args.source = argv[++i];
    if (token === '--note') args.note = argv[++i];
    if (token === '--runtime-root') args.runtimeRoot = path.resolve(argv[++i]);
    if (token === '--session-id') args.sessionId = argv[++i];
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/label-dossier-outcome.js <request_id> <label> [--source manual] [--note "..."] [--runtime-root <path>] [--session-id <id>]',
    '',
    'Labels:',
    '  unknown | worked | partially_worked | failed | unsafe'
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.requestId || !args.label) {
    process.stderr.write(usage() + '\n');
    process.exit(1);
  }

  const updated = runtime.updateOutcomeLabel(args.requestId, args.label, {
    source: args.source,
    note: args.note,
    runtimeRoot: args.runtimeRoot,
    sessionId: args.sessionId
  });

  if (!updated) {
    process.stderr.write(`Unable to find request dossier: ${args.requestId}\n`);
    process.exit(2);
  }

  const outcome = updated?.self_improvement?.outcome || {};
  process.stdout.write(JSON.stringify({
    request_id: updated.request_id || args.requestId,
    session_id: updated.session_id || args.sessionId || null,
    outcome
  }, null, 2) + '\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  usage
};
