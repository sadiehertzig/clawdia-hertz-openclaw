---
name: autoimprove
description: >
  Self-improving skill loop that makes any OpenClaw skill better overnight.
  Trigger when the user says "improve", "make better", "autoimprove",
  "self-improve", "optimize skill", "make X better", "tune up",
  "skill quality", "run autoimprove", "nightly improvement",
  "autoimprove results", "autoimprove report", "improvement report",
  "what did autoimprove do", or any request to improve quality of
  an existing skill. Also trigger for "add test question" or
  "show test bank".
metadata:
  version: "1.0.0"
  author: "clawdia-hertz"
  homepage: "https://github.com/clawdia-hertz/autoimprove"
  tags: ["self-improvement", "testing", "grading", "quality", "automation"]
  dependencies: ["three-body-council"]
---

# AutoImprove — Self-Improving Skill Loop

Makes any OpenClaw skill smarter overnight using the Three-Body Council
as an automated grading panel.

## How It Works

1. **Interview** — Clawdia asks what "better" means for the target skill
2. **Generate** — Three-Body Council creates test questions automatically
3. **Baseline** — Score the skill as-is to establish a starting point
4. **Improve** — Nightly loop: propose edits → grade → keep or revert
5. **Report** — Morning summary of what changed overnight

## Commands

- `improve [skill name]` — start the interview flow
- `autoimprove status` — show state of active improvement programs
- `autoimprove results` — morning report for most recent run
- `autoimprove pause/resume [skill]` — control nightly runs
- `add test question for [skill] :: [question] || [ideal answer optional]` — manually add a curated test case
- `show test bank for [skill]` — display test questions and scores

## Dependencies

- three-body-council skill (installed and working)
- httpx (`pip install httpx`)
- git (for ratchet mechanism)
- At least 2 of 3 API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
- Optional improver failover override: `AUTOIMPROVE_IMPROVER_MODEL_CHAIN`
