#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  patternScoutWorker,
  normalizeRepoId,
  loadDynamicWeights,
  loadPatternCards
} = require('../agents/clawdia/runtime/patternscout_worker');
const { learnPatternScoutWeights } = require('./patternscout-learn');
const { buildPatternCards } = require('./patternscout-build-cards');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function seedRepo(dirPath, name, lines) {
  writeFile(path.join(dirPath, 'src', name), lines.join('\n'));
}

function seedRuntimeDossier(runtimeRoot, sessionId, requestId, dossier) {
  const reqDir = path.join(runtimeRoot, sessionId, 'requests');
  ensureDir(reqDir);
  writeJson(path.join(reqDir, `${requestId}.json`), dossier);
}

function runCommand(args, cwd) {
  const out = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8'
  });
  if (out.status !== 0) {
    throw new Error(`command failed: ${args.join(' ')} :: ${String(out.stderr || out.stdout || '').trim()}`);
  }
}

function testWeightedScoringAndReceipts() {
  const root = makeTempDir('patternscout-weights-');
  const repoA = path.join(root, 'repoA');
  const repoB = path.join(root, 'repoB');
  const curatedPath = path.join(root, 'curated.json');
  const weightsPath = path.join(root, 'source_weights.json');
  const cardsPath = path.join(root, 'pattern_cards.json');

  seedRepo(repoA, 'A.java', [
    'public class IntakeSubsystem {',
    '  TalonFX motor = new TalonFX(1);',
    '  void runIntake() {}',
    '}'
  ]);
  seedRepo(repoA, 'A2.java', [
    'public class IntakeCommand {',
    '  void execute() { runIntake(); }',
    '}'
  ]);
  seedRepo(repoB, 'B.java', [
    'public class IntakeSubsystem {',
    '  TalonFX motor = new TalonFX(2);',
    '  void runIntake() {}',
    '}'
  ]);
  seedRepo(repoB, 'B2.java', [
    'public class IntakeCommand {',
    '  void execute() { runIntake(); }',
    '}'
  ]);

  writeJson(curatedPath, {
    version: 1,
    repos: [
      {
        id: 'HighQuality/Robot',
        quality_score: 95,
        official: false,
        archived: false,
        last_updated: '2026-03-01',
        tags: ['competition-code', 'java', 'intake'],
        base_weight: 1.2,
        style_family: 'high-quality'
      },
      {
        id: 'LowQuality/Robot',
        quality_score: 45,
        official: false,
        archived: true,
        last_updated: '2024-01-01',
        tags: ['java'],
        base_weight: 0.8,
        style_family: 'low-quality'
      }
    ]
  });

  writeJson(weightsPath, {
    version: 1,
    repo_weights: {
      'highquality/robot': { weight: 1.8, uses: 10, worked: 8, failed: 1 },
      'lowquality/robot': { weight: 0.5, uses: 10, worked: 1, failed: 7 }
    }
  });

  writeJson(cardsPath, { version: 1, cards: [] });

  const out = patternScoutWorker({
    request_id: 'req_test_weighted',
    user_message: 'build intake subsystem with TalonFX',
    intent: 'subsystem_or_command_draft',
    patternscout_config: {
      cacheDir: path.join(root, 'cache'),
      cacheTtlMs: 0,
      maxMatches: 6,
      diversityPerRepoCap: 2,
      repoMirrors: [
        { id: 'HighQuality/Robot', localPath: repoA, tier: 'gatorbots' },
        { id: 'LowQuality/Robot', localPath: repoB, tier: 'gatorbots' }
      ],
      docsRoots: [],
      officialRoots: [],
      curatedRegistryPath: curatedPath,
      dynamicWeightsPath: weightsPath,
      patternCardsPath: cardsPath,
      githubFallback: { enabled: false }
    }
  });

  assert.equal(out.status, 'success');
  assert.equal(Array.isArray(out.matches), true);
  assert.equal(out.matches.length > 0, true);
  assert.equal(Array.isArray(out.source_receipts), true);
  assert.equal(typeof out.freshness_badge, 'string');
  const parallelUsed = Boolean(out.telemetry_hints?.lane_parallel_used);
  const parallelBlocked = Array.isArray(out.warnings)
    && out.warnings.some((w) => String(w).includes('parallel lane execution failed'));
  assert.equal(parallelUsed || parallelBlocked, true);

  const topRepo = normalizeRepoId(out.matches[0].repo || out.matches[0].source_id || '');
  assert.equal(topRepo, 'highquality/robot');

  const countsByRepo = {};
  for (const match of out.matches) {
    const repo = normalizeRepoId(match.repo || match.source_id || 'unknown');
    countsByRepo[repo] = (countsByRepo[repo] || 0) + 1;
    assert.equal(typeof match.evidence_receipt, 'string');
  }

  for (const count of Object.values(countsByRepo)) {
    assert.equal(count <= 2, true);
  }

  console.log('ok - weighted scoring + receipts + diversity cap');
}

function testPatternCardsLane() {
  const root = makeTempDir('patternscout-cards-');
  const emptyMirror = path.join(root, 'empty-mirror');
  const curatedPath = path.join(root, 'curated.json');
  const weightsPath = path.join(root, 'weights.json');
  const cardsPath = path.join(root, 'cards.json');

  ensureDir(emptyMirror);
  writeJson(curatedPath, { version: 1, repos: [] });
  writeJson(weightsPath, { version: 1, repo_weights: {} });
  writeJson(cardsPath, {
    version: 1,
    cards: [
      {
        id: 'card_abc123',
        intent: 'subsystem_or_command_draft',
        query_tokens: ['intake', 'subsystem', 'talonfx'],
        source_repo: 'Mechanical-Advantage/RobotCode2026Public',
        source_path: 'src/main/java/frc/robot/subsystems/Intake.java',
        symbol: 'Intake',
        snippet: 'public class Intake extends SubsystemBase {}',
        score_hint: 82,
        success_rate: 0.91,
        style_family: 'advantagekit-architecture'
      }
    ]
  });

  const out = patternScoutWorker({
    request_id: 'req_test_cards',
    user_message: 'intake subsystem talonfx control',
    intent: 'subsystem_or_command_draft',
    patternscout_config: {
      cacheDir: path.join(root, 'cache'),
      cacheTtlMs: 0,
      maxMatches: 4,
      repoMirrors: [{ id: 'empty/mirror', localPath: emptyMirror, tier: 'gatorbots' }],
      docsRoots: [],
      officialRoots: [],
      curatedRegistryPath: curatedPath,
      dynamicWeightsPath: weightsPath,
      patternCardsPath: cardsPath,
      githubFallback: { enabled: false }
    }
  });

  assert.equal(out.matches.length > 0, true);
  assert.equal(out.source_tiers_used.includes('learned_pattern'), true);
  assert.equal(Boolean(out.matches.find((m) => m.pattern_card_id === 'card_abc123')), true);
  console.log('ok - learned pattern card lane');
}

function testLearningArtifactsGeneration() {
  const runtimeRoot = makeTempDir('patternscout-learn-runtime-');
  const outputRoot = makeTempDir('patternscout-learn-output-');
  const weightsPath = path.join(outputRoot, 'source_weights.json');
  const cardsPath = path.join(outputRoot, 'pattern_cards.json');

  const now = new Date().toISOString();

  const dossierWorked = {
    request_id: 'req_worked',
    intent: 'subsystem_or_command_draft',
    user_message: 'intake subsystem with beam break',
    timestamps: { created_at: now, updated_at: now },
    self_improvement: {
      outcome: { label: 'worked', source: 'manual', recorded_at: now },
      quality_evaluation: { scores: { overall: 85 } }
    },
    worker_outputs: {
      patternscout: {
        matches: [
          { repo: 'Mechanical-Advantage/RobotCode2026Public', path: 'src/main/java/frc/robot/subsystems/Intake.java', score: 88, snippet: 'class Intake {}' },
          { repo: 'wpilibsuite/allwpilib', path: 'wpilibj/src/main/java/...', score: 70, snippet: 'SubsystemBase' }
        ]
      }
    }
  };

  const dossierFailed = {
    request_id: 'req_failed',
    intent: 'subsystem_or_command_draft',
    user_message: 'intake command still failing',
    timestamps: { created_at: now, updated_at: now },
    self_improvement: {
      outcome: { label: 'failed', source: 'manual', recorded_at: now },
      quality_evaluation: { scores: { overall: 40 } }
    },
    worker_outputs: {
      patternscout: {
        matches: [
          { repo: 'random/unknown-repo', path: 'src/Random.java', score: 45, snippet: 'class Random {}' }
        ]
      }
    }
  };

  const dossierNoisyFollowUp = {
    request_id: 'req_noisy_followup',
    intent: 'follow_up',
    user_message: "that didn't work, still failing",
    timestamps: { created_at: now, updated_at: now },
    self_improvement: {
      outcome: { label: 'worked', source: 'manual', recorded_at: now },
      quality_evaluation: { scores: { overall: 95 } }
    },
    worker_outputs: {
      patternscout: {
        matches: [
          { repo: 'noisy/followup-repo', path: 'src/Noisy.java', score: 92, snippet: 'still failing after trying that fix' }
        ]
      }
    }
  };

  seedRuntimeDossier(runtimeRoot, 'sess_one', 'req_worked', dossierWorked);
  seedRuntimeDossier(runtimeRoot, 'sess_two', 'req_failed', dossierFailed);
  seedRuntimeDossier(runtimeRoot, 'sess_three', 'req_noisy_followup', dossierNoisyFollowUp);

  const learned = learnPatternScoutWeights({
    runtimeRoot,
    outputPath: weightsPath,
    lookbackHours: 72,
    minUses: 1
  });

  assert.equal(learned.repoCount >= 2, true);
  const weights = loadDynamicWeights({ dynamicWeightsPath: weightsPath });
  const strong = weights.map.get('mechanical-advantage/robotcode2026public');
  const weak = weights.map.get('random/unknown-repo');
  const noisy = weights.map.get('noisy/followup-repo');
  assert.equal(Boolean(strong), true);
  assert.equal(Boolean(weak), true);
  assert.equal(Boolean(noisy), false);
  assert.equal(strong.weight > weak.weight, true);

  const cards = buildPatternCards({
    runtimeRoot,
    outputPath: cardsPath,
    lookbackHours: 72,
    minQualityScore: 60,
    maxCards: 100
  });

  assert.equal(cards.cardCount >= 1, true);
  const loadedCards = loadPatternCards({ patternCardsPath: cardsPath });
  assert.equal(Array.isArray(loadedCards.cards), true);
  assert.equal(loadedCards.cards.length >= 1, true);
  assert.equal(loadedCards.cards.some((c) => String(c.source_repo || '').toLowerCase() === 'noisy/followup-repo'), false);

  console.log('ok - learning artifacts from outcomes (weights + cards)');
}

function testSnapshotAwareCacheInvalidation() {
  const root = makeTempDir('patternscout-snapshot-');
  const repo = path.join(root, 'repo');
  const cacheDir = path.join(root, 'cache');
  const curatedPath = path.join(root, 'curated.json');
  const weightsPath = path.join(root, 'weights.json');
  const cardsPath = path.join(root, 'cards.json');

  ensureDir(path.join(repo, 'src'));
  writeFile(path.join(repo, 'src', 'Robot.java'), [
    'public class Robot {',
    '  void intakeAlpha() {}',
    '}'
  ].join('\n'));
  writeJson(curatedPath, {
    version: 1,
    repos: [{ id: 'Snapshot/Repo', quality_score: 90, official: false, archived: false, tags: ['java'] }]
  });
  writeJson(weightsPath, { version: 1, repo_weights: {} });
  writeJson(cardsPath, { version: 1, cards: [] });

  runCommand(['git', 'init'], repo);
  runCommand(['git', 'config', 'user.email', 'patternscout@example.com'], repo);
  runCommand(['git', 'config', 'user.name', 'PatternScout Test'], repo);
  runCommand(['git', 'add', '.'], repo);
  runCommand(['git', 'commit', '-m', 'seed'], repo);

  const baseConfig = {
    cacheDir,
    cacheTtlMs: 60 * 60 * 1000,
    maxMatches: 4,
    repoMirrors: [{ id: 'Snapshot/Repo', localPath: repo, tier: 'gatorbots' }],
    docsRoots: [],
    officialRoots: [],
    curatedRegistryPath: curatedPath,
    dynamicWeightsPath: weightsPath,
    patternCardsPath: cardsPath,
    githubFallback: { enabled: false }
  };

  const first = patternScoutWorker({
    request_id: 'req_snapshot_first',
    user_message: 'intakeAlpha implementation',
    intent: 'subsystem_or_command_draft',
    patternscout_config: baseConfig
  });
  assert.equal(first.matches.length > 0, true);
  assert.equal(first.telemetry_hints.cache_hit, false);

  writeFile(path.join(repo, 'src', 'Robot.java'), [
    'public class Robot {',
    '  void intakeBeta() {}',
    '}'
  ].join('\n'));

  const second = patternScoutWorker({
    request_id: 'req_snapshot_second',
    user_message: 'intakeAlpha implementation',
    intent: 'subsystem_or_command_draft',
    patternscout_config: baseConfig
  });

  assert.equal(second.telemetry_hints.cache_hit, false);
  assert.equal(second.matches.some((m) => String(m.snippet || '').includes('intakeAlpha')), false);
  console.log('ok - snapshot-aware cache invalidation');
}

function testContractFuzzAndQualityGate() {
  const root = makeTempDir('patternscout-fuzz-');
  const curatedPath = path.join(root, 'curated.json');
  const weightsPath = path.join(root, 'weights.json');
  const cardsPath = path.join(root, 'cards.json');
  writeJson(curatedPath, { version: 1, repos: [] });
  writeJson(weightsPath, { version: 1, repo_weights: {} });
  writeJson(cardsPath, { version: 1, cards: [] });

  const baseConfig = {
    cacheDir: path.join(root, 'cache'),
    cacheTtlMs: 0,
    maxMatches: 4,
    repoMirrors: [],
    docsRoots: [],
    officialRoots: [],
    curatedRegistryPath: curatedPath,
    dynamicWeightsPath: weightsPath,
    patternCardsPath: cardsPath,
    qualityGate: {
      enabled: true,
      minTopScore: 90,
      minDistinctRepos: 2,
      minEvidenceReceipts: 2
    },
    githubFallback: { enabled: false }
  };

  const strict = patternScoutWorker({
    request_id: 'req_quality_gate',
    user_message: 'totally unknown_query_token_zzzz',
    intent: 'subsystem_or_command_draft',
    patternscout_config: baseConfig
  });
  assert.equal(strict.status, 'success');
  assert.equal(Array.isArray(strict.matches), true);
  assert.equal(strict.confidence, 'low');
  assert.equal(strict.matches.length <= 2, true);
  assert.equal(Array.isArray(strict.warnings), true);
  assert.equal(strict.warnings.some((w) => String(w).includes('quality gate rejected retrieval')), true);
  assert.equal(typeof strict.coverage_note, 'string');
  assert.equal(strict.coverage_note.toLowerCase().includes('low-confidence'), true);

  // Soft-fail regression: if gate fails but evidence exists, return low-confidence hints
  const repo = path.join(root, 'softfail-repo');
  ensureDir(path.join(repo, 'src'));
  writeFile(path.join(repo, 'src', 'Hint.java'), [
    'public class Hint {',
    '  void intakeAlpha() {}',
    '}'
  ].join('\n'));

  const softFail = patternScoutWorker({
    request_id: 'req_quality_gate_soft_fail',
    user_message: 'intakeAlpha implementation',
    intent: 'subsystem_or_command_draft',
    patternscout_config: {
      ...baseConfig,
      maxMatches: 6,
      repoMirrors: [{ id: 'soft/fail', localPath: repo, tier: 'gatorbots' }],
      qualityGate: {
        enabled: true,
        minTopScore: 999,
        minDistinctRepos: 5,
        minEvidenceReceipts: 5
      }
    }
  });

  assert.equal(softFail.status, 'success');
  assert.equal(softFail.confidence, 'low');
  assert.equal(Array.isArray(softFail.matches), true);
  assert.equal(softFail.matches.length > 0, true);
  assert.equal(softFail.matches.length <= 2, true);
  assert.equal(Array.isArray(softFail.warnings), true);
  assert.equal(softFail.warnings.some((w) => String(w).includes('quality gate rejected retrieval')), true);
  assert.equal(typeof softFail.coverage_note, 'string');
  assert.equal(softFail.coverage_note.toLowerCase().includes('low-confidence'), true);

  const fuzzPayloads = [
    null,
    {},
    { request_id: 1 },
    { user_message: 12345, intent: ['x'] },
    { query: { nested: true }, patternscout_config: { githubFallback: { enabled: false } } },
    { user_message: 'swerve', patternscout_config: { repoMirrors: 'oops', docsRoots: null, officialRoots: null } }
  ];

  for (const payload of fuzzPayloads) {
    const out = patternScoutWorker({
      ...(payload || {}),
      patternscout_config: {
        ...baseConfig,
        ...((payload && payload.patternscout_config) || {})
      }
    });
    assert.equal(typeof out, 'object');
    assert.equal(typeof out.contract_version, 'string');
    assert.equal(typeof out.status, 'string');
    assert.equal(Array.isArray(out.matches), true);
    assert.equal(typeof out.retrieval_latency_ms, 'number');
    assert.equal(Array.isArray(out.source_tiers_used), true);
  }

  console.log('ok - quality gate + contract fuzz stability');
}

function run() {
  testWeightedScoringAndReceipts();
  testPatternCardsLane();
  testLearningArtifactsGeneration();
  testSnapshotAwareCacheInvalidation();
  testContractFuzzAndQualityGate();
  console.log('\nPatternScout improvement validation passed.');
}

run();
