'use strict';

/**
 * DeepDebug worker — escalation-level root cause analysis.
 *
 * Activated when Arbiter escalates or when a follow-up failure occurs
 * after a reviewed answer. Analyzes the full dossier chain to produce
 * a diagnosis, fix, regression checks, and list of unknowns.
 *
 * DeepDebug may run AT MOST ONCE per request (enforced by orchestrator).
 */

const KNOWN_FAILURE_PATTERNS = [
  {
    id: 'can_bus_timeout',
    pattern: /(?:can\s*(?:bus)?\s*(?:timeout|disconnect|error|fault)|device\s+not\s+found)/i,
    diagnosis: 'CAN bus communication failure — device may be disconnected, have wrong ID, or bus is overloaded',
    fix_hints: [
      'Verify CAN ID matches Phoenix Tuner / REV Hardware Client configuration',
      'Check for duplicate CAN IDs on the bus',
      'Inspect wiring: CAN-H (yellow) and CAN-L (green) termination',
      'Reduce CAN bus utilization if running many status frames'
    ],
    regression_checks: [
      'Power cycle robot and verify device appears in Phoenix Tuner',
      'Run CAN health diagnostic and check error counts',
      'Verify no other device shares the same CAN ID'
    ]
  },
  {
    id: 'deploy_vendor_mismatch',
    pattern: /(?:vendor\s*dep|vendordep|vendor\s+library|version\s+mismatch|incompatible)/i,
    diagnosis: 'Vendor dependency version mismatch — libraries may be incompatible with current WPILib or firmware',
    fix_hints: [
      'Run vendor dependency update: check vendordeps/*.json versions against latest releases',
      'Ensure firmware versions match library expectations (Phoenix Tuner / REV Hardware Client)',
      'Clean build: ./gradlew clean build',
      'Verify WPILib year matches vendor library year'
    ],
    regression_checks: [
      './gradlew build succeeds without vendor warnings',
      'Deploy to roboRIO completes without class-not-found errors',
      'Robot code initializes without vendor exceptions in Driver Station log'
    ]
  },
  {
    id: 'pose_drift',
    pattern: /(?:pose\s*(?:drift|estimat)|odometry\s*(?:drift|error|wrong)|gyro\s*(?:drift|offset|calibrat))/i,
    diagnosis: 'Pose estimation drift — likely caused by sensor miscalibration, incorrect wheel measurements, or gyro issues',
    fix_hints: [
      'Recalibrate gyro: ensure robot is stationary during startup calibration',
      'Verify wheel diameter and gear ratio constants match physical robot',
      'Check encoder conversion factors (ticks to meters)',
      'Add vision-based pose correction if available'
    ],
    regression_checks: [
      'Push robot straight 2m and verify odometry reads ~2m',
      'Rotate 360° and verify gyro reads ~360°',
      'Run auto path and check pose error at known waypoints'
    ]
  },
  {
    id: 'pid_oscillation',
    pattern: /(?:oscillat|overshoot|undershoot|unstable|pid\s*(?:tun|gain)|ring|hunt)/i,
    diagnosis: 'PID control loop instability — gains likely too aggressive or system model mismatch',
    fix_hints: [
      'Start with all gains at 0 and increase P until system responds',
      'Add D gain to reduce overshoot, then add I only if steady-state error persists',
      'Check feedforward terms (kS, kV, kA) using SysId or manual characterization',
      'Verify encoder direction matches motor direction (positive input = positive encoder)'
    ],
    regression_checks: [
      'Step response test: command position, measure overshoot < 10%',
      'Verify steady-state error within acceptable tolerance',
      'Check for oscillation at various setpoints (not just one)'
    ]
  },
  {
    id: 'motor_stall',
    pattern: /(?:stall|overcurrent|trip|breaker|brown\s*out|current\s*(?:spike|limit|draw))/i,
    diagnosis: 'Motor stall or overcurrent — mechanism may be jammed, current limits may be misconfigured',
    fix_hints: [
      'Set appropriate current limits: typically 40A supply, 60A stator for Falcon/Kraken',
      'Check for mechanical binding or obstruction in the mechanism',
      'Verify motor is not fighting another motor (inversion mismatch)',
      'Add soft limits or limit switches to prevent end-of-travel stalls'
    ],
    regression_checks: [
      'Monitor current draw during normal operation — should stay well below limit',
      'Test mechanism through full range of motion manually before enabling motor',
      'Verify breaker does not trip during normal match cycle'
    ]
  }
];

function matchKnownPatterns(userMessage, priorEvidence) {
  const text = [
    String(userMessage || ''),
    ...(Array.isArray(priorEvidence) ? priorEvidence.map((e) => JSON.stringify(e)) : [])
  ].join(' ');

  const matches = [];
  for (const pattern of KNOWN_FAILURE_PATTERNS) {
    if (pattern.pattern.test(text)) {
      matches.push(pattern);
    }
  }
  return matches;
}

function synthesizeDiagnosis(matches, userMessage, dossierContext) {
  if (matches.length === 0) {
    return {
      diagnosis: `Unable to match a known failure pattern for: "${String(userMessage || '').slice(0, 200)}". This may require hands-on debugging with the physical robot and Driver Station logs.`,
      fix: 'Collect Driver Station logs, check for exceptions in the console, and verify all hardware connections. Share specific error messages for more targeted help.',
      regression_checks: [
        'Reproduce the issue consistently before attempting fixes',
        'Check Driver Station for error messages or warnings',
        'Verify the issue persists after power cycling the robot'
      ],
      unknowns: [
        'No known failure pattern matched — root cause unclear',
        'Physical hardware state cannot be verified remotely'
      ]
    };
  }

  const primary = matches[0];
  const additionalDiagnoses = matches.slice(1);
  const retryCount = dossierContext?.retry_count || 0;

  let diagnosis = primary.diagnosis;
  if (retryCount > 0) {
    diagnosis += ` (This is attempt ${retryCount + 1} — previous fix may not have addressed the root cause.)`;
  }
  if (additionalDiagnoses.length > 0) {
    diagnosis += `\n\nAdditional possible factors: ${additionalDiagnoses.map((m) => m.diagnosis).join('; ')}`;
  }

  const fix = primary.fix_hints.join('\n');
  const regression_checks = [
    ...primary.regression_checks,
    ...additionalDiagnoses.flatMap((m) => m.regression_checks.slice(0, 1))
  ];

  const unknowns = [];
  if (matches.length > 1) {
    unknowns.push('Multiple failure patterns detected — root cause may be a combination');
  }
  if (retryCount > 1) {
    unknowns.push('Multiple retries suggest the issue may have deeper causes than the matched pattern');
  }
  unknowns.push('Physical hardware state cannot be verified remotely');

  return { diagnosis, fix, regression_checks, unknowns };
}

function deepdebugWorker(payload) {
  const requestId = payload?.request_id || null;
  const userMessage = String(payload?.user_message || '');
  const intent = String(payload?.intent || '');
  const started = Date.now();

  const dossierContext = payload?.dossier?.context || {};
  const priorEvidence = dossierContext.prior_evidence || [];
  const parentDossier = payload?.parent_dossier || null;

  // Gather all available context
  const parentMessage = parentDossier?.user_message || '';
  const combinedMessage = [userMessage, parentMessage].filter(Boolean).join(' ');

  const matches = matchKnownPatterns(combinedMessage, priorEvidence);
  const result = synthesizeDiagnosis(matches, userMessage, dossierContext);

  const elapsed = Date.now() - started;

  return {
    request_id: requestId,
    status: 'success',
    kind: 'escalation',
    summary: matches.length > 0
      ? `Matched ${matches.length} known failure pattern(s): ${matches.map((m) => m.id).join(', ')}`
      : 'No known pattern matched — generic debugging guidance provided',
    diagnosis: result.diagnosis,
    fix: result.fix,
    regression_checks: result.regression_checks,
    unknowns: result.unknowns,
    matched_patterns: matches.map((m) => m.id),
    warnings: matches.length === 0 ? ['no known failure pattern matched'] : [],
    contract_flags: {
      reviewed: false,
      escalated: true,
      implementation_safe: false,
      pattern_only: false
    },
    telemetry_hints: { elapsed_time_ms: elapsed }
  };
}

module.exports = { deepdebugWorker, matchKnownPatterns, KNOWN_FAILURE_PATTERNS };
