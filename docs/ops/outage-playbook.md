# Outage Playbook

## Trigger conditions

- provider outage/timeouts
- worker not available
- repeated escalation failures

## Immediate response

1. keep Clawdia public routing unchanged
2. shift failing role to configured fallback provider
3. if Arbiter unavailable on substantive flow, force `guarded_answer`
4. if Checker unavailable, mark checks as `skipped` with reason
5. if DeepDebug fails, return best partial result in guarded mode
6. force `worker_invocation_mode=local_only` for instant rollback from spawned delegation
7. if review-truth integrity check fails, pin to guarded mode until fixed

## Verification

Run representative prompts:

- code draft
- docs lookup
- deploy error
- follow-up failure
- non-FRC chat

Confirm answer mode and stage traces are honest.

## Rollout gates (aggressive canary policy)

- review-truth violations: `0` (hard blocker)
- outage regressions: none
- p95 latency increase: `<= 50%` vs baseline
- cost/request increase: `<= 60%` vs baseline
- delegation fallback rate: `<= 40%`
