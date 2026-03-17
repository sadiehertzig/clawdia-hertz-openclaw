---
name: frc_pitcrew
description: Main Gatorbots FRC orchestrator policy for deterministic worker routing and honest answer modes.
user-invocable: true
---

# FRC PitCrew

## Intent Classes

- `build_deploy_error`
- `api_docs_lookup`
- `subsystem_or_command_draft`
- `autonomous_or_pathing`
- `sensor_or_can_fault`
- `vision_problem`
- `simulation_or_halsim`
- `explain_or_review`
- `deep_debug`
- `follow_up`
- `general_or_non_frc`

## Answer Modes

- `direct_answer`
- `reviewed_answer`
- `escalated_answer`
- `guarded_answer`

Priority:

1. guarded
2. escalated
3. reviewed
4. direct

## Stage Tags

- `intake`
- `plan`
- `patternscout`
- `librarian`
- `builder`
- `checker`
- `arbiter`
- `deepdebug`
- `finalize`

## Worker Plans

- `build_deploy_error` -> PatternScout, Librarian, Builder, Checker, Arbiter
- `api_docs_lookup` -> PatternScout, Librarian
- `subsystem_or_command_draft` -> PatternScout, Librarian, Builder, Checker, Arbiter
- `autonomous_or_pathing` -> PatternScout, Librarian, Builder, Checker, Arbiter
- `sensor_or_can_fault` -> PatternScout, Librarian, Arbiter
- `vision_problem` -> PatternScout, Librarian, Builder, Checker, Arbiter
- `simulation_or_halsim` -> PatternScout, Librarian, Builder, Checker, Arbiter
- `explain_or_review` -> PatternScout, Librarian (+ Arbiter for review/safety hints)
- `deep_debug` -> PatternScout, Librarian, DeepDebug
- `follow_up` -> dynamic follow-up policy
- `general_or_non_frc` -> direct answer, no workers

## Follow-up Policy

- Attach parent dossier when likely follow-up language appears.
- If follow-up failure comes after reviewed/escalated response, route to PatternScout -> Librarian -> Arbiter -> DeepDebug.
- Otherwise recurse to parent intent plan when available.

## Execution Rules

- Default worker call style: `sessions_spawn`.
- `sessions_send` reserved for deliberate persistent context.
- PatternScout and Checker may skip gracefully if unavailable.
- Arbiter must not be silently skipped on substantive/review-worthy flows.
- If Arbiter is unavailable, answer must be `guarded_answer`.
- Never claim review/checks that did not happen.

## Show Work Mode

When user requests evidence/show-work, include:

- retrieval sources and coverage note
- review verdict and concern list
- what checks passed/failed/skipped
- explicit uncertainty if guarded
