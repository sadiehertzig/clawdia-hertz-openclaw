# Three-Body Council

A multi-model deliberation and grading skill for [OpenClaw](https://github.com/openclaw) that convenes three frontier AI models into a structured three-round debate. Use it to get better answers (deliberation mode) or to automatically grade AI responses (evaluation mode).

Built by Sadie Hertzig with Claude Opus 4.6, GPT-5.4, and Gemini 3.1 Pro.

## What it does

Three-Body Council sends the same question to Claude Opus 4.6, GPT-5.4, and Gemini 3.1 Pro, then runs them through three rounds:

1. **Independent Analysis** — Each model answers the question on its own
2. **Cross-Examination** — Each model reads the other two answers and refines its position
3. **Synthesis** — A lead synthesizer produces the final answer incorporating all insights

The result is a single answer that's been stress-tested across three different models.

## Modes

### Deliberation Mode

Ask the council a question and get a synthesized answer.

```python
from three_body_council import ThreeBodyCouncil

council = ThreeBodyCouncil()
result = council.convene("What is the best approach to implementing a PID controller?")
print(result["synthesis"])
```

### Evaluation Mode

Grade any AI response against a set of assertions. Works for any domain — coding assistants, tutoring bots, customer support, whatever. Used by the [AutoImprove](https://clawhub.ai/clawdia-hertz/autoimprove) skill as an automated grading panel.

```python
council = ThreeBodyCouncil()
result = council.evaluate(
    question="What's the difference between a list and a tuple in Python?",
    response="Lists use square brackets and are mutable...",
    skill_summary="Python tutoring assistant for beginners",
    key_assertions=[
        "explains mutability difference",
        "shows syntax for both ([] vs ())",
        "mentions performance difference",
    ],
    anti_assertions=[
        "does not claim tuples are always faster",
        "does not confuse with dictionaries",
    ],
)
print(result["composite_score"])  # 0.0 - 1.0
```

Evaluation scores five dimensions with these weights:
| Dimension | Weight |
|-----------|--------|
| Safety | 25% |
| Factual accuracy | 25% |
| Completeness | 20% |
| Actionability | 20% |
| Anti-assertion compliance | 10% |

## Graceful Degradation

- **3 API keys**: Full three-model deliberation
- **2 API keys**: Two-model cross-examination (still useful)
- **1 API key**: Single-model pass-through (no cross-examination)

## Setup

### Requirements

- Python 3.10+
- `requests` (`pip install requests`)
- At least 2 of 3 API keys (all 3 recommended)

### API Keys

Set these as environment variables or in `~/.openclaw/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
```

### Install via ClawHub

```bash
clawhub install three-body-council
```

## CLI Usage

```bash
python3 three_body_council.py "Your question here"
```

## License

MIT
