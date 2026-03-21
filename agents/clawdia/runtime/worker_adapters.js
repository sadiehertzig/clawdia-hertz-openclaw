'use strict';

const CONTRACT_VERSION = '1.0.0';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function contractFlags(overrides) {
  const base = {
    reviewed: false,
    escalated: false,
    implementation_safe: false,
    pattern_only: false
  };

  return {
    ...base,
    ...(overrides || {})
  };
}

function normalizeEnvelope(worker, requestId, raw, overrides) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const config = overrides || {};

  return {
    request_id: requestId || source.request_id || null,
    worker,
    contract_version: CONTRACT_VERSION,
    status: source.status === 'error' || source.error ? 'error' : (source.status || config.status || 'success'),
    kind: source.kind || config.kind || 'generic',
    summary: asText(source.summary || source.message || config.summary || 'worker completed'),
    warnings: asArray(source.warnings || config.warnings),
    contract_flags: contractFlags(source.contract_flags || config.contract_flags),
    telemetry_hints: {
      serving_model: source.serving_model || config.serving_model || null,
      elapsed_time_ms: source.elapsed_time_ms || source.retrieval_latency_ms || config.elapsed_time_ms || null,
      fallback_event: source.fallback_event || null
    },
    skipped: Boolean(source.skipped),
    error: source.error
      ? (typeof source.error === 'object' ? source.error : { message: asText(source.error) })
      : null,
    raw: raw == null ? null : raw
  };
}

function adaptPatternScoutOutput(raw, requestId) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const matches = asArray(source.matches);

  if (!matches.length && (source.best_fit_pattern || source.alternative_pattern)) {
    const translated = [];

    if (source.best_fit_pattern) {
      translated.push({
        tier: 'remote_fallback',
        source_id: source.best_fit_pattern.repo || source.best_fit_pattern.repo_link || 'unknown',
        path: source.best_fit_pattern.path || null,
        symbol: source.best_fit_pattern.symbol || null,
        excerpt: source.best_fit_pattern.why || source.best_fit_pattern.description || null,
        url: source.best_fit_pattern.url || source.best_fit_pattern.repo_link || null
      });
    }

    if (source.alternative_pattern) {
      translated.push({
        tier: 'remote_fallback',
        source_id: source.alternative_pattern.repo || source.alternative_pattern.repo_link || 'unknown',
        path: source.alternative_pattern.path || null,
        symbol: source.alternative_pattern.symbol || null,
        excerpt: source.alternative_pattern.tradeoffs || source.alternative_pattern.description || null,
        url: source.alternative_pattern.url || source.alternative_pattern.repo_link || null
      });
    }

    source.matches = translated;
  }

  const envelope = normalizeEnvelope('patternscout', requestId, source, {
    kind: 'retrieval',
    summary: source.retrieval_summary || source.summary || 'patternscout retrieval complete',
    contract_flags: {
      pattern_only: true,
      implementation_safe: false,
      reviewed: false,
      escalated: false
    }
  });

  envelope.matches = asArray(source.matches);
  envelope.retrieval_summary = source.retrieval_summary || envelope.summary;
  envelope.coverage_note = source.coverage_note || (envelope.matches.length ? 'retrieval coverage available' : 'retrieval coverage is thin');
  envelope.retrieval_latency_ms = Number(source.retrieval_latency_ms || envelope.telemetry_hints.elapsed_time_ms || 0);
  envelope.source_tiers_used = asArray(source.source_tiers_used);
  envelope.source_receipts = asArray(source.source_receipts);
  envelope.freshness_badge = source.freshness_badge || null;
  envelope.confidence = source.confidence || (envelope.matches.length >= 3 ? 'high' : envelope.matches.length >= 1 ? 'medium' : 'low');

  return envelope;
}

function adaptLibrarianOutput(raw, requestId) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const envelope = normalizeEnvelope('librarian', requestId, source, {
    kind: 'docs_truth',
    summary: source.summary || 'librarian docs lookup complete',
    contract_flags: {
      pattern_only: true,
      implementation_safe: false
    }
  });

  envelope.key_apis = asArray(source.key_apis);
  envelope.facts = asArray(source.facts);
  envelope.sources = asArray(source.sources);
  return envelope;
}

function adaptBuilderOutput(raw, requestId) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const envelope = normalizeEnvelope('builder', requestId, source, {
    kind: source.kind || 'draft',
    summary: source.summary || 'builder draft complete',
    contract_flags: {
      reviewed: false,
      escalated: false,
      implementation_safe: Boolean(source.contract_flags?.implementation_safe),
      pattern_only: false
    }
  });

  envelope.student_facing_explanation = source.student_facing_explanation || source.explanation || source.text || '';

  const codeBlocks = asArray(source.code_blocks);
  if (!codeBlocks.length && source.draft) {
    envelope.code_blocks = [{ language: 'text', code: String(source.draft), path: null }];
  } else if (!codeBlocks.length && source.code) {
    envelope.code_blocks = [{ language: 'text', code: String(source.code), path: null }];
  } else {
    envelope.code_blocks = codeBlocks;
  }

  envelope.facts = asArray(source.facts);

  // Builder must never claim review completion.
  envelope.contract_flags.reviewed = false;
  return envelope;
}

function adaptCheckerOutput(raw, requestId) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const envelope = normalizeEnvelope('checker', requestId, source, {
    kind: 'validation',
    summary: source.summary || 'checker validation complete',
    contract_flags: {
      reviewed: false,
      escalated: false,
      implementation_safe: source.overall_status === 'pass' || source.overall_status === 'passed',
      pattern_only: false
    }
  });

  envelope.tests = asArray(source.tests);
  envelope.overall_status = source.overall_status || (envelope.status === 'error' ? 'error' : 'passed');
  envelope.worktree_path = source.worktree_path || null;
  return envelope;
}

function adaptArbiterOutput(raw, requestId) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const verdict = ['approve', 'revise', 'escalate'].includes(source.verdict) ? source.verdict : 'revise';

  const statusIsError = source.status === 'error' || Boolean(source.error);
  const reviewed = !statusIsError && (verdict === 'approve' || verdict === 'revise');
  const escalated = !statusIsError && verdict === 'escalate';

  const envelope = normalizeEnvelope('arbiter', requestId, source, {
    kind: 'review',
    summary: source.summary || `arbiter verdict: ${verdict}`,
    contract_flags: {
      reviewed,
      escalated,
      implementation_safe: reviewed,
      pattern_only: false
    }
  });

  envelope.verdict = verdict;
  envelope.concern_list = asArray(source.concern_list);
  envelope.changed_after_review = asArray(source.changed_after_review || source.revisions || source.changes);
  envelope.revised_output = source.revised_output || source.corrected_code || null;
  return envelope;
}

function adaptDeepDebugOutput(raw, requestId) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const statusIsError = source.status === 'error' || Boolean(source.error);

  const envelope = normalizeEnvelope('deepdebug', requestId, source, {
    kind: 'escalation',
    summary: source.summary || 'deepdebug escalation complete',
    contract_flags: {
      reviewed: false,
      escalated: !statusIsError,
      implementation_safe: !statusIsError && Boolean(source.contract_flags?.implementation_safe),
      pattern_only: false
    }
  });

  envelope.diagnosis = source.diagnosis || source.root_cause || '';
  envelope.fix = source.fix || source.recommended_fix || '';
  envelope.regression_checks = asArray(source.regression_checks || source.tests);
  envelope.unknowns = asArray(source.unknowns);
  return envelope;
}

function adaptCoachEvaluatorOutput(raw, requestId) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const envelope = normalizeEnvelope('coach_evaluator', requestId, source, {
    kind: 'quality_evaluation',
    summary: source.summary || 'quality evaluation complete',
    contract_flags: {
      reviewed: false,
      escalated: false,
      implementation_safe: Boolean(source.contract_flags?.implementation_safe),
      pattern_only: false
    }
  });

  const incomingScores = source.scores && typeof source.scores === 'object' ? source.scores : {};
  envelope.overall_score = Number.isFinite(Number(source.overall_score))
    ? Number(source.overall_score)
    : (Number.isFinite(Number(incomingScores.overall)) ? Number(incomingScores.overall) : null);
  envelope.confidence = source.confidence || null;
  envelope.scores = {
    overall: Number.isFinite(Number(incomingScores.overall)) ? Number(incomingScores.overall) : envelope.overall_score,
    correctness: Number.isFinite(Number(incomingScores.correctness)) ? Number(incomingScores.correctness) : null,
    safety: Number.isFinite(Number(incomingScores.safety)) ? Number(incomingScores.safety) : null,
    teaching: Number.isFinite(Number(incomingScores.teaching)) ? Number(incomingScores.teaching) : null,
    evidence: Number.isFinite(Number(incomingScores.evidence)) ? Number(incomingScores.evidence) : null
  };
  envelope.flags = asArray(source.flags);
  envelope.recommendations = asArray(source.recommendations);
  envelope.metrics = source.metrics && typeof source.metrics === 'object'
    ? source.metrics
    : {};

  return envelope;
}

function adaptGenericOutput(raw, requestId, options) {
  return normalizeEnvelope('generic', requestId, raw, {
    kind: options?.defaultKind || 'generic',
    summary: options?.defaultSummary || 'worker output normalized'
  });
}

function adaptWorkerOutput(worker, raw, requestId, options) {
  switch (worker) {
    case 'patternscout':
      return adaptPatternScoutOutput(raw, requestId);
    case 'librarian':
      return adaptLibrarianOutput(raw, requestId);
    case 'builder':
      return adaptBuilderOutput(raw, requestId);
    case 'checker':
      return adaptCheckerOutput(raw, requestId);
    case 'arbiter':
      return adaptArbiterOutput(raw, requestId);
    case 'deepdebug':
      return adaptDeepDebugOutput(raw, requestId);
    case 'coach_evaluator':
      return adaptCoachEvaluatorOutput(raw, requestId);
    default:
      return adaptGenericOutput(raw, requestId, options);
  }
}

module.exports = {
  CONTRACT_VERSION,
  adaptPatternScoutOutput,
  adaptLibrarianOutput,
  adaptBuilderOutput,
  adaptCheckerOutput,
  adaptArbiterOutput,
  adaptDeepDebugOutput,
  adaptCoachEvaluatorOutput,
  adaptWorkerOutput,
  normalizeEnvelope
};
