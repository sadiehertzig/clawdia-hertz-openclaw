'use strict';

/**
 * Arbiter worker — the review authority for substantive code answers.
 *
 * Arbiter inspects Builder output (and optionally Checker results) to decide
 * whether code is safe to present as reviewed. Only Arbiter may set
 * reviewed/implementation_safe flags on code outputs.
 *
 * Verdicts:
 *   approve  — code looks correct and safe
 *   revise   — code has issues; Arbiter provides corrected output
 *   escalate — problem is too complex; route to DeepDebug
 */

const SAFETY_KEYWORDS = [
  'brownout', 'overheat', 'overcurrent', 'stall', 'short circuit',
  'can bus', 'power distribution', 'breaker', 'battery', 'voltage',
  'pid', 'feedforward', 'setpoint', 'limit switch', 'encoder',
  'invert', 'phase', 'neutral mode', 'brake mode', 'coast mode'
];

const ESCALATION_SIGNALS = [
  'multiple subsystems', 'race condition', 'deadlock', 'threading',
  'intermittent', 'random', 'sometimes works', 'oscillat',
  'drift', 'diverge', 'instab', 'pose estimat'
];

const COMMON_CONCERNS = {
  no_current_limit: {
    pattern: /(?:TalonFX|CANSparkMax|SparkMax|TalonSRX)\s*\(/i,
    absent: /(?:currentLimit|CurrentLimit|setSmartCurrentLimit|statorCurrentLimit|supplyCurrentLimit)/i,
    message: 'Motor controller instantiated without visible current limit configuration'
  },
  no_neutral_mode: {
    pattern: /(?:TalonFX|CANSparkMax|SparkMax)\s*\(/i,
    absent: /(?:setNeutralMode|setIdleMode|NeutralModeValue|IdleMode)/i,
    message: 'Motor controller missing explicit neutral/idle mode setting'
  },
  raw_set_without_guard: {
    pattern: /\.set\(\s*(?:speed|power|output)/i,
    absent: /(?:MathUtil\.clamp|Math\.max|Math\.min|limit|constrain)/i,
    message: 'Motor .set() called with variable input but no visible clamping/limiting'
  }
};

function analyzeCode(codeBlocks) {
  const concerns = [];
  const allCode = codeBlocks.map((b) => b.code || '').join('\n');

  for (const [key, rule] of Object.entries(COMMON_CONCERNS)) {
    if (rule.pattern.test(allCode) && !rule.absent.test(allCode)) {
      concerns.push({ id: key, message: rule.message, severity: 'warning' });
    }
  }

  // Check for hardcoded CAN IDs without constants
  const canIdMatches = allCode.match(/new\s+(?:TalonFX|CANSparkMax|SparkMax)\s*\(\s*\d+/g);
  if (canIdMatches && canIdMatches.length > 1) {
    concerns.push({
      id: 'hardcoded_can_ids',
      message: 'Multiple motor controllers with hardcoded CAN IDs — consider using constants',
      severity: 'suggestion'
    });
  }

  // Check for missing @Override on common methods
  if (/public\s+void\s+(?:periodic|execute|end|initialize)\s*\(/.test(allCode)) {
    if (!/\@Override\s*\n\s*public\s+void\s+(?:periodic|execute|end|initialize)/.test(allCode)) {
      concerns.push({
        id: 'missing_override',
        message: 'Command/Subsystem lifecycle methods should have @Override annotation',
        severity: 'suggestion'
      });
    }
  }

  return concerns;
}

function detectSafetyRelevance(userMessage, intent) {
  const msg = String(userMessage || '').toLowerCase();
  const isSafetyIntent = intent === 'sensor_or_can_fault';
  const hasSafetyKeyword = SAFETY_KEYWORDS.some((kw) => msg.includes(kw));
  return isSafetyIntent || hasSafetyKeyword;
}

function detectEscalationSignals(userMessage, concerns) {
  const msg = String(userMessage || '').toLowerCase();
  const hasEscalationSignal = ESCALATION_SIGNALS.some((sig) => msg.includes(sig));
  const hasSevereConcerns = concerns.filter((c) => c.severity === 'error').length > 0;
  const manyWarnings = concerns.filter((c) => c.severity === 'warning').length >= 4;
  return hasEscalationSignal || hasSevereConcerns || manyWarnings;
}

function produceRevision(codeBlocks, concerns) {
  // Apply automated fixes where possible
  const revised = codeBlocks.map((block) => {
    let code = block.code || '';

    // Add current limit comment if missing
    for (const concern of concerns) {
      if (concern.id === 'no_current_limit') {
        code = code.replace(
          /((?:TalonFX|CANSparkMax|SparkMax)\s*\([^)]*\)\s*;)/,
          '$1\n    // TODO: Add current limit configuration here'
        );
      }
      if (concern.id === 'no_neutral_mode') {
        code = code.replace(
          /((?:TalonFX|CANSparkMax|SparkMax)\s*\([^)]*\)\s*;)/,
          '$1\n    // TODO: Set neutral/idle mode explicitly'
        );
      }
    }

    return { ...block, code };
  });

  return revised;
}

function arbiterWorker(payload) {
  const requestId = payload?.request_id || null;
  const intent = String(payload?.intent || '');
  const userMessage = String(payload?.user_message || '');
  const started = Date.now();

  // Get Builder output from dossier
  const dossierOutputs = payload?.dossier?.worker_outputs || {};
  const builderOut = dossierOutputs.builder || {};
  const checkerOut = dossierOutputs.checker || {};

  const codeBlocks = Array.isArray(builderOut.code_blocks) ? builderOut.code_blocks : [];
  const checkerStatus = checkerOut.overall_status || null;

  // If no code to review, approve as docs-only
  if (codeBlocks.length === 0 && !builderOut.student_facing_explanation) {
    const elapsed = Date.now() - started;
    return {
      request_id: requestId,
      status: 'success',
      kind: 'review',
      summary: 'No code to review — approving docs-only response',
      verdict: 'approve',
      concern_list: [],
      warnings: [],
      contract_flags: {
        reviewed: true,
        escalated: false,
        implementation_safe: true,
        pattern_only: false
      },
      telemetry_hints: { elapsed_time_ms: elapsed }
    };
  }

  const concerns = analyzeCode(codeBlocks);
  const isSafety = detectSafetyRelevance(userMessage, intent);
  const shouldEscalate = detectEscalationSignals(userMessage, concerns);

  // Checker failed -> add concern
  if (checkerStatus === 'fail' || checkerStatus === 'failed') {
    concerns.push({
      id: 'checker_failed',
      message: 'Checker validation reported failures — code may not compile or pass tests',
      severity: 'warning'
    });
  }

  // Safety-critical with concerns -> escalate
  if (isSafety && concerns.length > 0) {
    const elapsed = Date.now() - started;
    return {
      request_id: requestId,
      status: 'success',
      kind: 'review',
      summary: `Safety-relevant code with ${concerns.length} concern(s) — escalating`,
      verdict: 'escalate',
      concern_list: concerns,
      warnings: ['safety-critical code flagged for escalation'],
      contract_flags: {
        reviewed: false,
        escalated: true,
        implementation_safe: false,
        pattern_only: false
      },
      telemetry_hints: { elapsed_time_ms: elapsed }
    };
  }

  // Too complex -> escalate
  if (shouldEscalate) {
    const elapsed = Date.now() - started;
    return {
      request_id: requestId,
      status: 'success',
      kind: 'review',
      summary: `Escalation signals detected with ${concerns.length} concern(s)`,
      verdict: 'escalate',
      concern_list: concerns,
      warnings: ['complexity signals warrant escalation to DeepDebug'],
      contract_flags: {
        reviewed: false,
        escalated: true,
        implementation_safe: false,
        pattern_only: false
      },
      telemetry_hints: { elapsed_time_ms: elapsed }
    };
  }

  // Has fixable concerns -> revise
  if (concerns.length > 0) {
    const revisedBlocks = produceRevision(codeBlocks, concerns);
    const elapsed = Date.now() - started;
    return {
      request_id: requestId,
      status: 'success',
      kind: 'review',
      summary: `Reviewed with ${concerns.length} concern(s) — revised`,
      verdict: 'revise',
      concern_list: concerns,
      revised_output: revisedBlocks,
      changed_after_review: concerns.map((c) => c.id),
      warnings: [],
      contract_flags: {
        reviewed: true,
        escalated: false,
        implementation_safe: true,
        pattern_only: false
      },
      telemetry_hints: { elapsed_time_ms: elapsed }
    };
  }

  // Clean code -> approve
  const elapsed = Date.now() - started;
  return {
    request_id: requestId,
    status: 'success',
    kind: 'review',
    summary: 'Code reviewed with no concerns — approved',
    verdict: 'approve',
    concern_list: [],
    warnings: [],
    contract_flags: {
      reviewed: true,
      escalated: false,
      implementation_safe: true,
      pattern_only: false
    },
    telemetry_hints: { elapsed_time_ms: elapsed }
  };
}

module.exports = { arbiterWorker, analyzeCode, detectSafetyRelevance, detectEscalationSignals };
