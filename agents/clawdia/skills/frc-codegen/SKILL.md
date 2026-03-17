---
name: frc_codegen
description: Generate FRC Java code through Builder and Arbiter, with Checker validation and guarded fallback.
user-invocable: true
---

# FRC Codegen

## Worker Sessions

- PatternScout: `agent:patternscout:main`
- Librarian: `agent:librarian:main`
- Builder: `agent:builder:main`
- Checker: `agent:checker:main`
- Arbiter: `agent:arbiter:main`
- DeepDebug: `agent:deepdebug:main`

## Flow

1. Retrieve patterns first (PatternScout).
2. Resolve API/docs uncertainty (Librarian).
3. Draft implementation (Builder).
4. Validate in controlled lane when possible (Checker).
5. Review/revise/escalate (Arbiter).
6. If Arbiter escalates, run DeepDebug once.
7. If Arbiter unavailable for substantive code, return guarded answer.

## Required Output

- Final code or patch shape
- What changed after review
- Validation outcome (`passed`, `failed`, or `skipped`)
- Answer mode (`reviewed`, `escalated`, or `guarded`)
