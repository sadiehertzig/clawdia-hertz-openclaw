# Post-Regionals Rollout

## Freeze window (regionals)

- Keep runtime behavior equivalent to current production (`worker_invocation_mode=local_only`).
- Capture baseline snapshot:
  - `node scripts/capture-helpdesk-baseline.js --lookback-hours 72`
- Keep rollback policy pinned:
  - force `worker_invocation_mode=local_only`
  - keep guarded enforcement enabled

## Rollout phases

1. **Phase 0: dark ship**
   - land codepaths/telemetry/tests with local-only effective behavior
2. **Phase 1: canary**
   - enable `hybrid` in one private test thread
   - delegated Builder/Arbiter/DeepDebug only
3. **Phase 2: limited production**
   - expand to selected FRC maintainer chats
4. **Phase 3: full rollout**
   - enable `hybrid` for all FRC flows
   - keep local fallback permanent

## Promotion gates (aggressive)

- review-truth violations = `0`
- no outage regressions
- p95 latency increase `<= 50%` vs baseline
- cost/request increase `<= 60%` vs baseline
- fallback rate `<= 40%`
