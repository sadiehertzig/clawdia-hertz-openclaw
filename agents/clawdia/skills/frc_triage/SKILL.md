---
name: frc_triage
description: Fast FRC triage with Librarian evidence and Arbiter escalation for safety/review-sensitive cases.
user-invocable: true
---

# FRC Triage

## Worker Sessions

- PatternScout: `agent:patternscout:main`
- Librarian: `agent:librarian:main`
- Arbiter: `agent:arbiter:main` (when safety/review hints exist)

## Procedure

1. Pull patterns/evidence (PatternScout).
2. Pull docs/API truth (Librarian).
3. If safety/hardware or explicit review signal appears, include Arbiter.
4. Return concise response:
   - Most likely cause
   - Try this first
   - If that fails
   - Source confidence

Never present a reviewed claim unless Arbiter actually reviewed.
