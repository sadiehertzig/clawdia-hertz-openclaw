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

## Verification

Run representative prompts:

- code draft
- docs lookup
- deploy error
- follow-up failure
- non-FRC chat

Confirm answer mode and stage traces are honest.
