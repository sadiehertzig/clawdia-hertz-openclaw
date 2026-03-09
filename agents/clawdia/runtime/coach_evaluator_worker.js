'use strict';

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > 100) return 100;
  return Math.round(num);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function evaluateCorrectnessScore(dossier) {
  const d = dossier || {};
  const trace = asArray(d.worker_trace);
  const reviewState = d.review_state || {};
  const checker = d.worker_outputs?.checker || null;
  let score = 62;
  const flags = [];

  const hasWorkerError = trace.some((entry) => entry && entry.status === 'error' && !entry.skipped);
  if (hasWorkerError) {
    score -= 20;
    flags.push('worker_error_present');
  }

  if (reviewState.review_completed) {
    score += 18;
  } else if (d.intent && d.intent !== 'general_or_non_frc') {
    score -= 8;
    flags.push('unreviewed_substantive_flow');
  }

  const checkerStatus = String(checker?.overall_status || '').toLowerCase();
  if (checkerStatus === 'passed' || checkerStatus === 'pass') {
    score += 14;
  } else if (checkerStatus === 'failed' || checkerStatus === 'fail') {
    score -= 16;
    flags.push('checker_failed');
  } else if (checkerStatus === 'skipped') {
    score -= 6;
    flags.push('checker_skipped');
  }

  if (reviewState.escalation_completed) {
    score -= 4;
    flags.push('escalated_flow');
  }

  return { score: clampScore(score), flags };
}

function evaluateSafetyScore(dossier) {
  const d = dossier || {};
  const reviewState = d.review_state || {};
  const checker = d.worker_outputs?.checker || null;
  let score = 70;
  const flags = [];

  if (reviewState.guarded) {
    score -= 42;
    flags.push(`guarded:${reviewState.guarded_reason || 'unknown'}`);
  }

  if (reviewState.review_completed) {
    score += 12;
  } else if (d.intent && d.intent !== 'general_or_non_frc') {
    score -= 12;
    flags.push('no_arbiter_review');
  }

  const checkerStatus = String(checker?.overall_status || '').toLowerCase();
  if (checkerStatus === 'failed' || checkerStatus === 'fail') {
    score -= 16;
    flags.push('checker_failed');
  }

  if (reviewState.escalation_completed && !reviewState.guarded) {
    score -= 8;
    flags.push('escalated_for_risk');
  }

  return { score: clampScore(score), flags };
}

function evaluateTeachingScore(dossier) {
  const d = dossier || {};
  const builder = d.worker_outputs?.builder || null;
  const librarian = d.worker_outputs?.librarian || null;
  let score = 54;
  const flags = [];

  const explanation = String(builder?.student_facing_explanation || '');
  const explanationLength = explanation.trim().length;
  if (explanationLength >= 120) {
    score += 20;
  } else if (explanationLength >= 40) {
    score += 10;
  } else if (d.intent && d.intent !== 'general_or_non_frc') {
    score -= 10;
    flags.push('short_or_missing_explanation');
  }

  const codeBlocks = asArray(builder?.code_blocks);
  if (codeBlocks.length > 0) {
    score += 12;
  } else if (d.intent && d.intent !== 'api_docs_lookup' && d.intent !== 'general_or_non_frc') {
    score -= 8;
    flags.push('missing_code_blocks');
  }

  const factCount = asArray(librarian?.facts).length;
  if (factCount >= 3) {
    score += 10;
  } else if (factCount === 0 && d.intent && d.intent !== 'general_or_non_frc') {
    score -= 8;
    flags.push('missing_supporting_facts');
  }

  return { score: clampScore(score), flags };
}

function evaluateEvidenceScore(dossier) {
  const d = dossier || {};
  const patternscout = d.worker_outputs?.patternscout || null;
  const librarian = d.worker_outputs?.librarian || null;
  let score = 48;
  const flags = [];

  const retrievalCount = asArray(d.retrieval_sources).length;
  if (retrievalCount >= 4) {
    score += 22;
  } else if (retrievalCount >= 1) {
    score += 12;
  } else if (d.intent && d.intent !== 'general_or_non_frc') {
    score -= 12;
    flags.push('no_retrieval_sources');
  }

  const librarianSourceCount = asArray(librarian?.sources).length;
  if (librarianSourceCount >= 2) {
    score += 14;
  } else if (librarianSourceCount === 0 && d.intent && d.intent !== 'general_or_non_frc') {
    score -= 10;
    flags.push('no_librarian_sources');
  }

  const confidence = String(patternscout?.confidence || '').toLowerCase();
  if (confidence === 'high') score += 10;
  if (confidence === 'low' && d.intent && d.intent !== 'general_or_non_frc') {
    score -= 8;
    flags.push('low_pattern_confidence');
  }

  return { score: clampScore(score), flags };
}

function confidenceBucket(overall, flags) {
  if (overall >= 82 && flags.length <= 2) return 'high';
  if (overall >= 60) return 'medium';
  return 'low';
}

function buildRecommendations(scores, flags) {
  const recs = [];

  if (scores.safety < 60) {
    recs.push('Route through Arbiter review before presenting implementation guidance.');
  }
  if (flags.includes('checker_failed') || flags.includes('checker_skipped')) {
    recs.push('Improve validation reliability: run checker with a safe profile and surface exact failures.');
  }
  if (flags.includes('no_retrieval_sources') || flags.includes('no_librarian_sources')) {
    recs.push('Increase retrieval coverage by improving query normalization and docs indexing.');
  }
  if (flags.includes('short_or_missing_explanation')) {
    recs.push('Add a student-facing explanation with steps, assumptions, and why the code works.');
  }
  if (flags.includes('missing_code_blocks')) {
    recs.push('For implementation intents, include at least one runnable code block with file path.');
  }

  if (recs.length === 0) {
    recs.push('No major quality gaps detected. Preserve this routing pattern as a baseline.');
  }

  return recs.slice(0, 6);
}

function coachEvaluatorWorker(payload) {
  const started = Date.now();
  const requestId = payload?.request_id || null;
  const d = payload?.dossier || {};
  const trace = asArray(d.worker_trace);

  const correctness = evaluateCorrectnessScore(d);
  const safety = evaluateSafetyScore(d);
  const teaching = evaluateTeachingScore(d);
  const evidence = evaluateEvidenceScore(d);

  const overall = clampScore(
    (correctness.score * 0.34) +
    (safety.score * 0.32) +
    (evidence.score * 0.2) +
    (teaching.score * 0.14)
  );

  const flags = Array.from(new Set(
    correctness.flags
      .concat(safety.flags)
      .concat(teaching.flags)
      .concat(evidence.flags)
  ));

  const confidence = confidenceBucket(overall, flags);
  const recommendations = buildRecommendations({
    overall,
    correctness: correctness.score,
    safety: safety.score,
    teaching: teaching.score,
    evidence: evidence.score
  }, flags);

  const checkerStatus = d?.worker_outputs?.checker?.overall_status || null;
  const summary = `Quality score ${overall}/100 (safety ${safety.score}, correctness ${correctness.score}, evidence ${evidence.score}, teaching ${teaching.score})`;
  const elapsed = Date.now() - started;

  return {
    request_id: requestId,
    status: 'success',
    kind: 'quality_evaluation',
    summary,
    overall_score: overall,
    confidence,
    scores: {
      overall,
      correctness: correctness.score,
      safety: safety.score,
      teaching: teaching.score,
      evidence: evidence.score
    },
    flags,
    recommendations,
    metrics: {
      intent: d.intent || null,
      answer_mode: d.answer_mode || null,
      worker_count: trace.length,
      retrieval_source_count: asArray(d.retrieval_sources).length,
      checker_status: checkerStatus,
      reviewed: Boolean(d.review_state?.review_completed),
      escalated: Boolean(d.review_state?.escalation_completed),
      guarded: Boolean(d.review_state?.guarded)
    },
    warnings: [],
    contract_flags: {
      reviewed: false,
      escalated: false,
      implementation_safe: overall >= 75,
      pattern_only: false
    },
    telemetry_hints: {
      elapsed_time_ms: elapsed
    }
  };
}

module.exports = {
  coachEvaluatorWorker,
  evaluateCorrectnessScore,
  evaluateSafetyScore,
  evaluateTeachingScore,
  evaluateEvidenceScore,
  buildRecommendations
};
