# AutoImprove

A [Karpathy](https://github.com/karpathy)-inspired self-improving skill loop for [OpenClaw](https://github.com/openclaw) that makes any skill better overnight using the [Three-Body Council](https://clawhub.ai/clawdia-hertz/three-body-council) as an automated grading panel.

Built by Sadie Hertzig. Inspired by Andrej Karpathy's autoresearch concept.

## What it does

AutoImprove takes a skill you've already built and systematically makes it better:

1. **Interview** — Asks you what "better" means for this skill (audience, ideal answers, things to avoid)
2. **Generate** — Creates a test bank of questions across difficulty levels (easy, medium, hard, adversarial)
3. **Baseline** — Scores the skill as-is to establish a starting point
4. **Improve** — Proposes edits, grades the result, keeps improvements, reverts regressions
5. **Report** — Sends you a summary of what changed

The ratchet mechanism ensures the skill never gets worse — every proposed edit is scored against the full test bank, and reverted if quality drops on any dimension.

## How the ratchet works

Every edit must pass four rules before it sticks:

1. **Aggregate score must improve** — overall weighted score goes up
2. **Curated questions can't regress** — hand-picked test cases are protected
3. **No new safety flags** — safety score never drops
4. **Minimum improvement threshold** — changes must be meaningful, not noise

If an edit fails any rule, it's reverted and the skill stays at its previous best.

## Commands

| Command | What it does |
|---------|-------------|
| `improve [skill]` | Start the interview flow for a skill |
| `autoimprove status` | Show state of active improvement programs |
| `autoimprove results` | Morning report for the most recent run |
| `autoimprove pause/resume [skill]` | Control nightly runs |
| `add test question for [skill]` | Manually add a curated test case |
| `show test bank for [skill]` | Display test questions and scores |

## Setup

### Requirements

- Python 3.10+
- `httpx` (`pip install httpx`)
- `git` (for the ratchet mechanism)
- [Three-Body Council](https://clawhub.ai/clawdia-hertz/three-body-council) skill installed
- At least 2 of 3 API keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`

### Optional: Telegram Approval

AutoImprove can send proposed changes to Telegram for manual approval before committing. Set these in `~/.openclaw/openclaw.json` or as environment variables:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Without Telegram configured, AutoImprove runs fully autonomously (ratchet still prevents regressions).

### Install via ClawHub

```bash
clawhub install autoimprove
```

## Architecture

```
autoimprove.py   — Main orchestrator and CLI
interview.py     — Onboarding conversation (7-step state machine)
question_gen.py  — Test bank generation (Channel A: diverse, Channel C: gap-filling)
runner.py        — Executes skill against test questions
grader.py        — Tiered evaluation via Three-Body Council
scorer.py        — Weighted scoring and ratchet logic
improver.py      — Proposes and applies SKILL.md edits
notify.py        — Telegram approval flow
models.py        — Data models (TestCase, Verdict, Config, ResultsLogger)
```

## License

MIT
