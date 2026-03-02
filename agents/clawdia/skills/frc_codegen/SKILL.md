---
name: frc_codegen
description: Generate FRC Java code and run Arbiter review before finalizing.
user-invocable: true
---

# FRC Codegen

## Internal Sessions

- agent:arbiter:main
- agent:librarian:main

## Procedure

1. If API accuracy matters → ask Librarian first.
2. Draft clean WPILib command-based Java code.
3. Send draft to Arbiter.
4. Merge corrections.
5. Return:
    - Final code
    - What changed
    - Why it matters
    - What to test next
