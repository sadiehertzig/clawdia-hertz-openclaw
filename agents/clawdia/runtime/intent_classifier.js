'use strict';

const INTENTS = [
  'build_deploy_error',
  'api_docs_lookup',
  'subsystem_or_command_draft',
  'autonomous_or_pathing',
  'sensor_or_can_fault',
  'vision_problem',
  'simulation_or_halsim',
  'explain_or_review',
  'deep_debug',
  'follow_up',
  'general_or_non_frc'
];

const FOLLOW_UP_PATTERNS = [
  "that didn't work",
  'same error',
  'same issue',
  'same problem',
  'still failing',
  'still broken',
  'what about the other motor',
  'instead',
  'ok now',
  'try this instead',
  'same stack trace',
  'same can id',
  'again'
];

const SAFETY_OR_HARDWARE_PATTERNS = [
  'motor',
  'can bus',
  'canivore',
  'sensor',
  'breaker',
  'spark max',
  'talonfx',
  'brownout',
  'overheat',
  'short',
  'wiring',
  'limit switch',
  'encoder',
  'voltage',
  'current'
];

const EXPLICIT_REVIEW_PATTERNS = [
  'review this',
  'is this safe',
  'is this correct',
  'please review',
  'audit this',
  'check my code',
  'can you verify',
  'validate this'
];

const FRC_SIGNAL_PATTERNS = [
  'wpilib',
  'frc',
  'robot',
  'command',
  'subsystem',
  'talon',
  'spark',
  'pathplanner',
  'roborio',
  'deploy',
  'can bus',
  'can id',
  'canivore',
  'vision',
  'simulate',
  'simulation',
  'halsim',
  'simdevice',
  'physics sim',
  'flywheel'
];

function safeJsonParse(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function hasOwnKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function readOptionalBoolean(source, key) {
  if (!hasOwnKey(source, key)) {
    return undefined;
  }
  const value = source[key];

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return undefined;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return undefined;
}

function detectRoutingHints(prompt) {
  const text = String(prompt || '').toLowerCase();
  const isFollowUp = includesAny(text, FOLLOW_UP_PATTERNS);
  const followUpFailure = includesAny(text, [
    "that didn't work",
    'still failing',
    'still broken',
    'same error',
    'same issue',
    'same problem'
  ]);

  return {
    is_follow_up: isFollowUp,
    follow_up_failure: followUpFailure,
    safety_or_hardware: includesAny(text, SAFETY_OR_HARDWARE_PATTERNS),
    explicit_review: includesAny(text, EXPLICIT_REVIEW_PATTERNS)
  };
}

function heuristicIntent(prompt, hints) {
  const text = String(prompt || '').toLowerCase();

  if (hints.is_follow_up) {
    return 'follow_up';
  }

  const socialChatter = /\b(joke|meme|how are you|hello|thanks|thank you)\b/.test(text);
  const technicalIntent = includesAny(text, [
    'build',
    'deploy',
    'gradle',
    'vendordep',
    'api',
    'signature',
    'constructor',
    'subsystem',
    'command',
    'pathplanner',
    'swerve',
    'can',
    'sensor',
    'review',
    'debug',
    'simulate'
  ]);

  if (socialChatter && !technicalIntent) {
    return 'general_or_non_frc';
  }

  if (!includesAny(text, FRC_SIGNAL_PATTERNS)) {
    return 'general_or_non_frc';
  }

  if (includesAny(text, ['deploy', 'gradle', 'vendordep', 'build failed', 'cannot deploy'])) {
    return 'build_deploy_error';
  }

  if (includesAny(text, ['api', 'signature', 'constructor', 'which class', 'docs', 'documentation'])) {
    return 'api_docs_lookup';
  }

  if (includesAny(text, ['swerve', 'autonomous', 'pathplanner', 'trajectory', 'pose estimator', 'odometry'])) {
    return 'autonomous_or_pathing';
  }

  if (includesAny(text, ['camera', 'limelight', 'photonvision', 'vision'])) {
    return 'vision_problem';
  }

  if (includesAny(text, ['simulate', 'simulation', 'simulatejava', 'simdevice',
      'simdouble', 'halsim', 'glass sim', 'physics sim', 'mechanism2d',
      'works in sim', 'sim but not'])) {
    return 'simulation_or_halsim';
  }

  if (hints.safety_or_hardware && includesAny(text, ['fault', 'can', 'sensor', 'brownout', 'overheat', 'wiring'])) {
    return 'sensor_or_can_fault';
  }

  if (includesAny(text, ['root cause', 'deep debug', 'multi file', 'hard bug'])) {
    return 'deep_debug';
  }

  if (includesAny(text, ['review', 'explain', 'why', 'debug', 'what is wrong'])) {
    return 'explain_or_review';
  }

  if (includesAny(text, ['write', 'generate', 'create', 'scaffold', 'subsystem', 'command'])) {
    return 'subsystem_or_command_draft';
  }

  return 'explain_or_review';
}

function parseModelClassifierOutput(modelOutput) {
  const parsed = typeof modelOutput === 'object' && modelOutput !== null
    ? modelOutput
    : safeJsonParse(modelOutput);

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const intent = typeof parsed.intent === 'string' ? parsed.intent.trim() : '';
  if (!INTENTS.includes(intent)) {
    return null;
  }

  const hintSource = parsed.hints && typeof parsed.hints === 'object'
    ? parsed.hints
    : parsed;
  const hints = {
    is_follow_up: readOptionalBoolean(hintSource, 'is_follow_up'),
    follow_up_failure: readOptionalBoolean(hintSource, 'follow_up_failure'),
    safety_or_hardware: readOptionalBoolean(hintSource, 'safety_or_hardware'),
    explicit_review: readOptionalBoolean(hintSource, 'explicit_review')
  };

  return {
    intent,
    confidence: parsed.confidence || 'model',
    hints
  };
}

function quickClassify(prompt, options) {
  const opts = options || {};
  const baseHints = detectRoutingHints(prompt);
  const fromModel = parseModelClassifierOutput(opts.modelOutput);

  if (fromModel) {
    return {
      intent: fromModel.intent,
      confidence: fromModel.confidence,
      hints: {
        is_follow_up: fromModel.hints.is_follow_up ?? baseHints.is_follow_up,
        follow_up_failure: fromModel.hints.follow_up_failure ?? baseHints.follow_up_failure,
        safety_or_hardware: fromModel.hints.safety_or_hardware ?? baseHints.safety_or_hardware,
        explicit_review: fromModel.hints.explicit_review ?? baseHints.explicit_review
      }
    };
  }

  return {
    intent: heuristicIntent(prompt, baseHints),
    confidence: 'heuristic',
    hints: baseHints
  };
}

module.exports = {
  INTENTS,
  detectRoutingHints,
  parseModelClassifierOutput,
  quickClassify,
  heuristicIntent
};
