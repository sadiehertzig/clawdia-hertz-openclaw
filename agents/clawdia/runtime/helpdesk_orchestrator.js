'use strict';

const dossier = require('./dossier_helpers');
const classifier = require('./intent_classifier');
const adapters = require('./worker_adapters');
const { patternScoutWorker } = require('./patternscout_worker');
const { checkerWorker } = require('../../checker/checker_worker');
const { librarianWorker } = require('../../librarian/librarian_worker');
const { builderWorker } = require('../../builder/builder_worker');
const { arbiterWorker } = require('../../arbiter/arbiter_worker');
const { deepdebugWorker } = require('../../deepdebug/deepdebug_worker');
const { coachEvaluatorWorker } = require('./coach_evaluator_worker');

const BASE_EXECUTION_PLANS = {
  build_deploy_error: ['patternscout', 'librarian', 'builder', 'checker', 'arbiter'],
  api_docs_lookup: ['patternscout', 'librarian'],
  subsystem_or_command_draft: ['patternscout', 'librarian', 'builder', 'checker', 'arbiter'],
  autonomous_or_pathing: ['patternscout', 'librarian', 'builder', 'checker', 'arbiter'],
  sensor_or_can_fault: ['patternscout', 'librarian', 'arbiter'],
  vision_problem: ['patternscout', 'librarian', 'builder', 'checker', 'arbiter'],
  explain_or_review: ['patternscout', 'librarian'],
  deep_debug: ['patternscout', 'librarian', 'deepdebug'],
  follow_up: ['patternscout', 'librarian'],
  general_or_non_frc: []
};

const SUBSTANTIVE_INTENTS = new Set([
  'build_deploy_error',
  'subsystem_or_command_draft',
  'autonomous_or_pathing',
  'vision_problem',
  'sensor_or_can_fault',
  'deep_debug'
]);
const DEFAULT_CONVERSATION_PARENT_LOOKBACK_MS = 2 * 60 * 60 * 1000;

function uniquePlan(plan) {
  const seen = new Set();
  const out = [];

  for (const worker of plan) {
    if (!seen.has(worker)) {
      seen.add(worker);
      out.push(worker);
    }
  }

  return out;
}

function isSubstantiveIntent(intent) {
  return SUBSTANTIVE_INTENTS.has(intent);
}

function loadLikelyParentDossier(options) {
  const opts = options || {};
  const sessionId = dossier.makeSessionId(opts.peerId);
  const latestPeer = dossier.loadLatestDossier(sessionId, { runtimeRoot: opts.runtimeRoot });
  const explicitParentRequestId = opts?.conversationContext?.parent_request_id || null;

  if (explicitParentRequestId) {
    const explicitPeerParent = dossier.loadRequestDossier(sessionId, explicitParentRequestId, { runtimeRoot: opts.runtimeRoot });
    if (explicitPeerParent) {
      return explicitPeerParent;
    }

    const explicitGlobalParent = dossier.loadRequestDossierById(explicitParentRequestId, { runtimeRoot: opts.runtimeRoot });
    if (explicitGlobalParent) {
      return explicitGlobalParent;
    }
  }

  const hints = classifier.detectRoutingHints(opts.userMessage || '');
  const shouldAttachFollowUpParent = opts.intent === 'follow_up' || hints.is_follow_up;
  if (!shouldAttachFollowUpParent) {
    return null;
  }

  const lookbackMs = Number(opts.parentLookbackMs);
  const resolvedLookbackMs = Number.isFinite(lookbackMs) && lookbackMs > 0
    ? lookbackMs
    : DEFAULT_CONVERSATION_PARENT_LOOKBACK_MS;

  const latestConversation = dossier.loadLatestDossierForConversation(opts.chatId, opts.threadOrTopicId, {
    runtimeRoot: opts.runtimeRoot,
    maxAgeMs: resolvedLookbackMs
  });
  if (latestConversation) {
    return latestConversation;
  }

  return latestPeer;
}

function isWorkerAvailable(worker, runtimeCtx) {
  const ctx = runtimeCtx || {};
  if (typeof ctx.isWorkerAvailable === 'function') {
    return Boolean(ctx.isWorkerAvailable(worker));
  }

  if (ctx.availableWorkers && typeof ctx.availableWorkers === 'object') {
    if (worker in ctx.availableWorkers) return Boolean(ctx.availableWorkers[worker]);
  }

  if (ctx.workerHandlers && typeof ctx.workerHandlers[worker] === 'function') {
    return true;
  }

  if (worker === 'patternscout' || worker === 'checker' ||
      worker === 'librarian' || worker === 'builder' ||
      worker === 'arbiter' || worker === 'deepdebug' ||
      worker === 'coach_evaluator') {
    return true;
  }

  return false;
}

function callWorker(worker, payload, runtimeCtx) {
  const ctx = runtimeCtx || {};

  if (typeof ctx.callWorker === 'function') {
    return ctx.callWorker(worker, payload);
  }

  if (ctx.workerHandlers && typeof ctx.workerHandlers[worker] === 'function') {
    return ctx.workerHandlers[worker](payload);
  }

  if (worker === 'patternscout') {
    return patternScoutWorker(payload);
  }

  if (worker === 'checker') {
    return checkerWorker(payload);
  }

  if (worker === 'librarian') {
    return librarianWorker(payload);
  }

  if (worker === 'builder') {
    return builderWorker(payload);
  }

  if (worker === 'arbiter') {
    return arbiterWorker(payload);
  }

  if (worker === 'deepdebug') {
    return deepdebugWorker(payload);
  }

  if (worker === 'coach_evaluator') {
    return coachEvaluatorWorker(payload);
  }

  return {
    request_id: payload?.request_id || null,
    status: 'error',
    kind: 'missing_worker',
    summary: `${worker} worker unavailable`,
    error: { message: `${worker} worker unavailable` },
    warnings: [`${worker} worker unavailable`]
  };
}

function planForIntent(intent, hints, parentDossier) {
  const resolvedIntent = intent || 'general_or_non_frc';
  let basePlan = BASE_EXECUTION_PLANS[resolvedIntent] || [];

  if (resolvedIntent === 'follow_up') {
    const parentIntent = parentDossier?.intent || parentDossier?.context?.parent_intent || null;
    const reviewedOrEscalated = Boolean(
      parentDossier?.review_state?.review_completed || parentDossier?.review_state?.escalation_completed
    );

    if (hints.follow_up_failure && reviewedOrEscalated) {
      basePlan = ['patternscout', 'librarian', 'arbiter', 'deepdebug'];
    } else if (parentIntent && parentIntent !== 'follow_up' && BASE_EXECUTION_PLANS[parentIntent]) {
      basePlan = BASE_EXECUTION_PLANS[parentIntent].slice();
    } else {
      basePlan = ['patternscout', 'librarian'];
      if (hints.safety_or_hardware || hints.explicit_review) {
        basePlan.push('arbiter');
      }
    }
  }

  if (resolvedIntent === 'explain_or_review' && (hints.safety_or_hardware || hints.explicit_review)) {
    basePlan = basePlan.concat(['arbiter']);
  }

  if (resolvedIntent === 'sensor_or_can_fault' && !basePlan.includes('arbiter')) {
    basePlan = basePlan.concat(['arbiter']);
  }

  return uniquePlan(basePlan);
}

function formatAnswerBadge(answerMode) {
  switch (answerMode) {
    case 'reviewed_answer':
      return '[reviewed]';
    case 'escalated_answer':
      return '[escalated]';
    case 'guarded_answer':
      return '[⚠️ unreviewed]';
    default:
      return '[direct]';
  }
}

function formatCheckerBadge(checkerOutput, executionPlan) {
  const checkerPlanned = Array.isArray(executionPlan) && executionPlan.includes('checker');
  if (!checkerPlanned && !checkerOutput) return null;
  if (!checkerOutput || checkerOutput.status === 'error') return '[checks unavailable]';

  const overall = String(checkerOutput.overall_status || '').toLowerCase();
  if (overall === 'passed' || overall === 'pass') return '[checks passed]';
  if (overall === 'failed' || overall === 'fail') return '[checks failed]';
  if (overall === 'error') return '[checks unavailable]';
  return '[checks skipped]';
}

function pickPrimarySummary(dossierObj) {
  const outputs = dossierObj?.worker_outputs || {};
  const workerOrder = ['arbiter', 'deepdebug', 'builder', 'librarian', 'patternscout'];

  for (const worker of workerOrder) {
    const out = outputs[worker];
    if (out && out.status !== 'error' && typeof out.summary === 'string' && out.summary.trim()) {
      return out.summary.trim();
    }
  }

  for (const worker of workerOrder) {
    const out = outputs[worker];
    if (out && typeof out.summary === 'string' && out.summary.trim()) {
      return out.summary.trim();
    }
  }

  return 'Response synthesized from available worker outputs.';
}

function composeFinalMessage(options) {
  const opts = options || {};
  const d = opts.dossier || {};
  const markers = (Array.isArray(opts.statusMarkers) ? opts.statusMarkers : []).filter(Boolean).join(' ').trim();
  const summary = pickPrimarySummary(d);
  const parts = [];

  if (markers) parts.push(markers);
  if (summary) parts.push(summary);

  const checkerBadge = opts.checkerBadge || null;
  if (checkerBadge === '[checks failed]') {
    parts.push('Validation reported failures.');
  } else if (checkerBadge === '[checks skipped]') {
    parts.push('Validation was skipped in this run.');
  } else if (checkerBadge === '[checks unavailable]') {
    parts.push('Validation was unavailable in this run.');
  }

  if (d.review_state?.guarded) {
    parts.push('Guidance is unreviewed; verify before applying on robot hardware.');
  } else if (opts.substantiveFlow && !d.review_state?.review_completed) {
    parts.push('No Arbiter review completed in this run.');
  }

  return parts.join(' ').trim();
}

function runCoachEvaluator(reqDossier, runtimeCtx, meta) {
  const ctx = runtimeCtx || {};
  const worker = 'coach_evaluator';
  const info = meta || {};

  dossier.noteStageStatus(reqDossier, worker, 'started');

  if (!isWorkerAvailable(worker, ctx)) {
    const skipped = adapters.adaptWorkerOutput(worker, {
      request_id: reqDossier.request_id,
      status: 'error',
      summary: `${worker} unavailable`,
      skipped: true,
      warnings: [`${worker} unavailable`]
    }, reqDossier.request_id);

    dossier.recordWorkerOutput(reqDossier, worker, skipped);
    dossier.noteStageStatus(reqDossier, worker, 'skipped');
    return reqDossier;
  }

  const startedAt = Date.now();
  let raw;

  try {
    raw = callWorker(worker, {
      request_id: reqDossier.request_id,
      user_message: reqDossier.user_message,
      intent: reqDossier.intent,
      dossier: reqDossier,
      status_markers: info.statusMarkers || [],
      execution_plan: info.executionPlan || []
    }, ctx);
  } catch (err) {
    raw = {
      request_id: reqDossier.request_id,
      status: 'error',
      summary: `${worker} threw an exception`,
      error: {
        message: err instanceof Error ? err.message : String(err)
      }
    };
  }

  const normalized = adapters.adaptWorkerOutput(worker, raw, reqDossier.request_id);
  const elapsed = Date.now() - startedAt;

  dossier.recordWorkerOutput(reqDossier, worker, normalized);
  dossier.mergeTelemetry(reqDossier, worker, {
    elapsed_time_ms: elapsed,
    serving_model: normalized.telemetry_hints?.serving_model,
    fallback_event: normalized.telemetry_hints?.fallback_event
  });

  if (normalized.status === 'error') {
    dossier.noteStageStatus(reqDossier, worker, normalized.skipped ? 'skipped' : 'error');
    return reqDossier;
  }

  dossier.noteStageStatus(reqDossier, worker, 'completed');
  return reqDossier;
}

function orchestrateRequest(input, runtimeCtx) {
  const ctx = runtimeCtx || {};
  const prompt = input?.userMessage || '';
  const classify = classifier.quickClassify(prompt, { modelOutput: input?.modelClassifierOutput });
  const hints = classify.hints || classifier.detectRoutingHints(prompt);

  let intent = input?.intent || classify.intent;
  if (hints.is_follow_up && intent !== 'follow_up') {
    intent = 'follow_up';
  }

  const parentDossier = loadLikelyParentDossier({
    peerId: input?.peerId,
    route: input?.route,
    userMessage: prompt,
    conversationContext: input?.conversationContext,
    intent,
    chatId: input?.chatId,
    threadOrTopicId: input?.threadOrTopicId,
    parentLookbackMs: ctx.parentLookbackMs,
    runtimeRoot: ctx.runtimeRoot
  });

  const reqDossier = dossier.createInitialDossier({
    peerId: input?.peerId,
    route: input?.route || 'helpdesk',
    userMessage: prompt,
    intent,
    conversationContext: input?.conversationContext,
    chatId: input?.chatId,
    threadOrTopicId: input?.threadOrTopicId,
    parentDossier
  });

  if (parentDossier) {
    dossier.attachParentDossier(reqDossier, parentDossier, {
      followUpFailure: hints.follow_up_failure
    });
  }

  if (parentDossier && hints.follow_up_failure && parentDossier.request_id) {
    try {
      dossier.updateOutcomeLabel(parentDossier.request_id, 'failed', {
        runtimeRoot: ctx.runtimeRoot,
        source: 'follow_up_inference',
        note: `Detected follow-up failure from child request ${reqDossier.request_id}`
      });
    } catch {
      dossier.noteHumanEvent(reqDossier, 'outcome_label', 'failed_to_update_parent');
    }
  }

  dossier.noteStageStatus(reqDossier, 'intake', 'completed');

  if (intent === 'general_or_non_frc') {
    dossier.noteHumanEvent(reqDossier, 'routing', 'general_or_non_frc direct answer path');
    dossier.setExecutionPlanTelemetry(reqDossier, ['coach_evaluator']);
    runCoachEvaluator(reqDossier, ctx, {
      statusMarkers: ['[direct]'],
      executionPlan: ['coach_evaluator']
    });
    dossier.finalizeDossier(reqDossier);
    const answerBadge = formatAnswerBadge(reqDossier.answer_mode);
    const statusMarkers = [answerBadge];
    dossier.finalizeSelfImprovementTelemetry(reqDossier, { statusMarkers });
    dossier.saveDossier(reqDossier, { runtimeRoot: ctx.runtimeRoot });
    const finalMessage = `${answerBadge} Direct answer path selected.`.trim();

    return {
      intent,
      execution_plan: ['coach_evaluator'],
      answer_mode: reqDossier.answer_mode,
      answer_badge: answerBadge,
      checker_badge: null,
      status_markers: statusMarkers,
      final_message: finalMessage,
      dossier: reqDossier
    };
  }

  const executionPlan = planForIntent(intent, hints, parentDossier);
  const executionPlanWithEvaluation = uniquePlan(executionPlan.concat(['coach_evaluator']));
  dossier.noteHumanEvent(reqDossier, 'execution_plan', executionPlan.join(' -> '));
  dossier.setExecutionPlanTelemetry(reqDossier, executionPlanWithEvaluation);
  dossier.noteStageStatus(reqDossier, 'plan', 'completed');

  const substantiveFlow = isSubstantiveIntent(intent) || executionPlan.includes('builder');
  let deepDebugUsed = false;

  for (const worker of executionPlan) {
    if (worker === 'deepdebug' && deepDebugUsed) {
      continue;
    }

    dossier.noteStageStatus(reqDossier, worker, 'started');

    if (!isWorkerAvailable(worker, ctx)) {
      const skipped = adapters.adaptWorkerOutput(worker, {
        request_id: reqDossier.request_id,
        status: 'error',
        summary: `${worker} unavailable`,
        skipped: true,
        warnings: [`${worker} unavailable`]
      }, reqDossier.request_id);

      dossier.recordWorkerOutput(reqDossier, worker, skipped);
      dossier.noteStageStatus(reqDossier, worker, 'skipped');

      if (worker === 'arbiter' && (substantiveFlow || hints.explicit_review || hints.safety_or_hardware)) {
        dossier.markGuarded(reqDossier, 'arbiter_unavailable_for_substantive_flow');
      }
      continue;
    }

    const startedAt = Date.now();
    let raw;

    try {
      raw = callWorker(worker, {
        request_id: reqDossier.request_id,
        user_message: reqDossier.user_message,
        intent,
        dossier: reqDossier,
        parent_dossier: parentDossier,
        retrieval_sources: reqDossier.retrieval_sources,
        source_repo: ctx.sourceRepo || process.cwd()
      }, ctx);
    } catch (err) {
      raw = {
        request_id: reqDossier.request_id,
        status: 'error',
        summary: `${worker} threw an exception`,
        error: {
          message: err instanceof Error ? err.message : String(err)
        }
      };
    }

    const normalized = adapters.adaptWorkerOutput(worker, raw, reqDossier.request_id);
    const elapsed = Date.now() - startedAt;

    dossier.recordWorkerOutput(reqDossier, worker, normalized);
    dossier.mergeTelemetry(reqDossier, worker, {
      elapsed_time_ms: elapsed,
      serving_model: normalized.telemetry_hints?.serving_model,
      fallback_event: normalized.telemetry_hints?.fallback_event
    });

    if (normalized.status === 'error') {
      if (worker === 'arbiter' && (substantiveFlow || hints.explicit_review || hints.safety_or_hardware)) {
        dossier.markGuarded(reqDossier, 'arbiter_failed_for_substantive_flow');
      }
      if (worker === 'deepdebug') {
        dossier.markGuarded(reqDossier, 'deepdebug_failed');
      }
      if (worker === 'builder') {
        dossier.markGuarded(reqDossier, 'builder_failed');
      }
      dossier.noteStageStatus(reqDossier, worker, normalized.skipped ? 'skipped' : 'error');
      continue;
    }

    if (worker === 'arbiter') {
      if (normalized.verdict === 'escalate') {
        dossier.markEscalated(reqDossier, 'arbiter');
        if (!executionPlan.includes('deepdebug') && !deepDebugUsed) {
          executionPlan.push('deepdebug');
        }
      } else {
        dossier.markReviewCompleted(reqDossier, 'arbiter');
      }
    }

    if (worker === 'deepdebug') {
      dossier.markEscalated(reqDossier, 'deepdebug');
      deepDebugUsed = true;
    }

    dossier.noteStageStatus(reqDossier, worker, 'completed');
  }

  const provisionalAnswerBadge = formatAnswerBadge(dossier.resolveAnswerMode(reqDossier));
  const checkerBadge = formatCheckerBadge(reqDossier.worker_outputs?.checker, executionPlan);
  const provisionalMarkers = [provisionalAnswerBadge];
  if (checkerBadge) provisionalMarkers.push(checkerBadge);
  runCoachEvaluator(reqDossier, ctx, {
    statusMarkers: provisionalMarkers,
    executionPlan: executionPlanWithEvaluation
  });

  dossier.finalizeDossier(reqDossier);
  const answerBadge = formatAnswerBadge(reqDossier.answer_mode);
  const statusMarkers = [answerBadge];
  if (checkerBadge) statusMarkers.push(checkerBadge);
  dossier.finalizeSelfImprovementTelemetry(reqDossier, { statusMarkers });
  dossier.saveDossier(reqDossier, { runtimeRoot: ctx.runtimeRoot });
  const finalMessage = composeFinalMessage({
    dossier: reqDossier,
    statusMarkers,
    checkerBadge,
    substantiveFlow
  });

  return {
    intent,
    execution_plan: executionPlanWithEvaluation,
    answer_mode: reqDossier.answer_mode,
    answer_badge: answerBadge,
    checker_badge: checkerBadge,
    status_markers: statusMarkers,
    final_message: finalMessage,
    dossier: reqDossier
  };
}

module.exports = {
  BASE_EXECUTION_PLANS,
  formatAnswerBadge,
  formatCheckerBadge,
  composeFinalMessage,
  loadLikelyParentDossier,
  planForIntent,
  callWorker,
  isWorkerAvailable,
  orchestrateRequest
};
