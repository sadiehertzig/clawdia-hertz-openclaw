---
name: patternscout
description: Mine high-signal FRC/WPILib Java patterns using GitHub CLI search and curated filtering.
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["gh"]}}}
---

# PatternScout (GitHub CLI Powered)

## Purpose

Find strong FRC/WPILib Java patterns from real GitHub repos and explain how to apply them.

This is NOT random web search.
This uses GitHub code search via `gh`.

---

## When To Use

Use for:
- "Show me a clean swerve subsystem pattern"
- "How do good teams structure autos?"
- "Find examples of SwerveDrivePoseEstimator usage"
- "What’s a clean command-based intake structure?"

---

## Search Strategy

1. Identify key search phrase.
    Examples:
    - SwerveDrivePoseEstimator
    - SubsystemBase
    - PathPlanner AutoBuilder
    - TalonFXConfiguration
    - CommandScheduler

2. Run targeted GitHub searches:

    Code search:
    gh search code "<SEARCH_TERM>" --language Java --limit 20

    Repo search:
    gh search repos "topic:frc language:java" --limit 20

3. Prefer:
    - Official WPILib examples
    - Vendor example repos
    - Well-known team repos
    - Repos with meaningful stars

4. Avoid:
    - Tiny or clearly unfinished repos
    - Repos with only 1–2 commits

---

## Output Format

Return:

### 1️⃣ Best Fit Pattern
- Repo link
- File path
- Why it's strong

### 2️⃣ Alternative Pattern
- Repo link
- Tradeoffs

### 3️⃣ Recommendation
- Which one to use
- Why
- One pitfall to avoid

Keep it concise.

---

## Tone

- Engineering mentor energy
- Practical
- No fluff