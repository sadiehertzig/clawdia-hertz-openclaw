"""
AutoImprove question generator.
Uses the Three-Body Council to generate test questions for any skill.

Channels:
    A — Analyze skill file, produce diverse test questions
    C — Expand coverage around weak areas (after first scoring run)
"""

import time
import sys
import os
from datetime import datetime, timezone
from pathlib import Path

from models import TestCase, AutoImproveConfig, parse_json_array

# Import Three-Body Council
_TBC_PATH = Path.home() / ".openclaw" / "skills" / "three-body-council"
if str(_TBC_PATH) not in sys.path:
    sys.path.insert(0, str(_TBC_PATH))

from three_body_council import ThreeBodyCouncil


CHANNEL_A_PROMPT = """\
You are analyzing an OpenClaw skill file to generate test questions \
for an automated quality improvement system.

SKILL FILE:
---
{skill_content}
---

IMPROVEMENT PRIORITIES (from the skill owner):
{priorities}

AUDIENCE: {audience} ({expertise})

Generate exactly 20 diverse test questions a real user would ask this \
skill. Return ONLY a JSON array (no markdown fences, no commentary). \
Each element:

{{"question":"...","intent_class":"short_label","difficulty":"easy|medium|hard|adversarial","key_assertions":["..."],"anti_assertions":["..."]}}

Distribution:
- 5 easy (common questions, the 80% case)
- 5 medium (nuance, tradeoffs, multi-step)
- 5 hard (edge cases, version-specific gotchas, tricky failures)
- 5 adversarial (designed to expose hallucinations, outdated info, or gaps)

Make key_assertions specific and testable. Not "gives a good answer" but \
"mentions that TalonFX import changed from com.ctre.phoenix to com.ctre.phoenix6". \
Anti_assertions should catch hallucinations and dangerous advice specific to this domain.

JSON array only. No other text."""


CHANNEL_C_PROMPT = """\
A test question exposed a weakness in an OpenClaw skill. The skill scored \
poorly on this question:

Question: {question}
Score: {score:.2f}
Failure summary: {failure_summary}

Skill context: {skill_summary}

Generate exactly 3 more test questions that probe the SAME weakness from \
different angles. Related but not identical.

Return ONLY a JSON array of 3 objects (same schema). No other text."""


class QuestionGenerator:
    """Generates test questions using the Three-Body Council."""

    def __init__(self, verbose=False):
        self.council = ThreeBodyCouncil(verbose=verbose)

    async def channel_a(self, skill_content: str, config: AutoImproveConfig) -> list:
        """Channel A: Generate questions from the skill file."""
        priorities = "\n".join(f"- {p}" for p in config.priorities) or "None specified"

        prompt = CHANNEL_A_PROMPT.format(
            skill_content=skill_content[:8000],
            priorities=priorities,
            audience=config.audience or "general users",
            expertise=config.expertise_level or "mixed",
        )

        result = await self.council.convene_async(prompt)
        raw = result.get("synthesis", result.get("final_answer", ""))
        questions = parse_json_array(raw)

        test_cases = []
        for i, q in enumerate(questions):
            tc = TestCase(
                id=f"tq-a-{i+1:03d}",
                question=q.get("question", ""),
                tier="generated",
                source="channel_a",
                created=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                intent_class=q.get("intent_class", ""),
                difficulty=q.get("difficulty", "medium"),
                key_assertions=q.get("key_assertions", []),
                anti_assertions=q.get("anti_assertions", []),
            )
            if tc.question:
                test_cases.append(tc)

        return test_cases

    async def channel_c(self, weak_questions: list, skill_summary: str) -> list:
        """Channel C: Expand coverage around failures."""
        all_new = []

        for wq in weak_questions[:3]:
            prompt = CHANNEL_C_PROMPT.format(
                question=wq["question"],
                score=wq.get("score", 0.0),
                failure_summary=wq.get("summary", "low score"),
                skill_summary=skill_summary[:4000],
            )

            result = await self.council.convene_async(prompt)
            questions = parse_json_array(result.get("synthesis", result.get("final_answer", "")))

            for i, q in enumerate(questions):
                tc = TestCase(
                    id=f"tq-c-{wq.get('id', 'x')}-{i+1}",
                    question=q.get("question", ""),
                    tier="candidate",
                    source="channel_c",
                    created=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    intent_class=q.get("intent_class", ""),
                    difficulty=q.get("difficulty", "hard"),
                    key_assertions=q.get("key_assertions", []),
                    anti_assertions=q.get("anti_assertions", []),
                )
                if tc.question:
                    all_new.append(tc)

        return all_new

    def create_from_example(self, question: str, answer: str) -> TestCase:
        """Create a curated test case from a user-provided Q&A pair."""
        return TestCase(
            id=f"tq-curated-{int(time.time())}",
            question=question,
            tier="curated",
            source="manual",
            created=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            verified_answer_summary=answer,
        )
