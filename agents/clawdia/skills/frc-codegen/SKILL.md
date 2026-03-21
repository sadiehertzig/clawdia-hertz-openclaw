---
name: frc_codegen
description: Generate FRC Java code through Builder and Arbiter, with Checker validation and guarded fallback.
user-invocable: true
---

# FRC Codegen

## Worker Sessions

- PatternScout: in-process retrieval lane (local only)
- Librarian: `agent:librarian:main` (local by default)
- Builder: `agent:builder:main` (spawned in `hybrid`/`spawn_only` when substantive)
- Checker: `agent:checker:main` (tool-first validation lane)
- Arbiter: `agent:arbiter:main` (spawned in `hybrid`/`spawn_only` when substantive)
- DeepDebug: `agent:deepdebug:main` (spawned for escalation/failure follow-up)

## Flow

1. Retrieve patterns first (PatternScout).
2. Resolve API/docs uncertainty (Librarian).
3. Draft implementation (Builder).
4. Validate in controlled lane when possible (Checker).
5. Review/revise/escalate (Arbiter).
6. If Arbiter escalates, run DeepDebug once.
7. If follow-up failure occurs after a reviewed answer, run Arbiter -> DeepDebug once.
8. If Arbiter unavailable/fails for substantive code, return guarded answer.

## Invocation Modes

- `local_only`: force local worker execution (regionals-safe default).
- `hybrid`: use spawned delegation for substantive Builder/Arbiter/DeepDebug stages; fallback local on spawn failure.
- `spawn_only`: require spawned delegation for substantive Builder/Arbiter/DeepDebug; no local fallback.

## Required Output

- Final code or patch shape
- What changed after review
- Validation outcome (`passed`, `failed`, or `skipped`)
- Answer mode (`reviewed`, `escalated`, or `guarded`)
