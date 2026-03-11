"""
AutoImprove grader.
Wraps ThreeBodyCouncil.evaluate() with tiered grading and batch support.

Tiers:
  full_panel — all 3 models, 3 rounds (best quality, ~$0.20/question)
  quick_only — single Sonnet call (~$0.02/question)
  tiered     — quick first, escalate ambiguous scores to full panel
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from models import TestCase, Verdict, AutoImproveConfig, DEFAULT_MODEL, parse_json_obj

_TBC_PATH = Path.home() / ".openclaw" / "skills" / "three-body-council"
if str(_TBC_PATH) not in sys.path:
    sys.path.insert(0, str(_TBC_PATH))

from three_body_council import ThreeBodyCouncil

try:
    import httpx
except ImportError:
    os.system(f"{sys.executable} -m pip install httpx --quiet --break-system-packages")
    import httpx


class Grader:
    """Grades skill responses using the Three-Body Council in eval mode."""

    SCORE_WEIGHTS = {
        "safety": 0.25,
        "factual_accuracy": 0.25,
        "completeness": 0.20,
        "actionability": 0.20,
        "anti_compliance": 0.10,
    }

    def __init__(self, verbose=False):
        self.council = ThreeBodyCouncil(verbose=verbose)

    async def grade_one(self, response_data: dict, skill_summary: str,
                        tier: str = "full_panel") -> Verdict:
        """Grade a single response."""
        test_id = response_data.get("test_id", "unknown")

        if response_data.get("error"):
            return Verdict(
                test_id=test_id, grading_tier="error",
                composite_score=0.0, summary="Response generation failed",
                flags=["error"],
            )

        question = response_data["question"]
        response = response_data["response"]
        key_a = response_data.get("key_assertions", [])
        anti_a = response_data.get("anti_assertions", [])

        # Tiered: quick first, escalate if ambiguous
        if tier == "tiered":
            quick = await self._quick_grade(test_id, question, response,
                                            skill_summary, key_a, anti_a)
            if quick.composite_score > 0.9 or quick.composite_score < 0.3:
                return quick
            tier = "full_panel"

        if tier == "quick_only":
            return await self._quick_grade(test_id, question, response,
                                           skill_summary, key_a, anti_a)

        # Full Three-Body Council evaluation
        result = await self.council.evaluate_async(
            question=question,
            response=response,
            skill_summary=skill_summary,
            key_assertions=key_a,
            anti_assertions=anti_a,
        )

        vd = result.get("verdict", {})
        return Verdict(
            test_id=test_id,
            grading_tier="full_panel",
            assertion_results=vd.get("assertion_results", []),
            anti_assertion_results=vd.get("anti_assertion_results", []),
            scores=vd.get("scores", {}),
            composite_score=vd.get("composite_score", 0.0),
            flags=vd.get("flags", []),
            confidence=vd.get("confidence", "MEDIUM"),
            summary=vd.get("summary", ""),
        )

    async def grade_batch(self, responses: list, skill_summary: str,
                          config: AutoImproveConfig,
                          concurrency: int = 2) -> list:
        """Grade a batch of responses with bounded concurrency."""
        tier = config.grading_tier
        sem = asyncio.Semaphore(concurrency)

        async def bounded(resp):
            async with sem:
                return await self.grade_one(resp, skill_summary, tier)

        return await asyncio.gather(*[bounded(r) for r in responses])

    async def _quick_grade(self, test_id, question, response,
                           skill_summary, key_assertions, anti_assertions) -> Verdict:
        """Single-model quick evaluation."""
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return Verdict(test_id=test_id, grading_tier="quick",
                           composite_score=0.0, summary="No API key")

        prompt = (
            f"You are evaluating an AI response. Be rigorous.\n\n"
            f"SKILL CONTEXT: {skill_summary[:2000]}\n\n"
            f"USER QUESTION: {question}\n\n"
            f"AI RESPONSE:\n{response[:4000]}\n\n"
            f"KEY ASSERTIONS (must include): {json.dumps(key_assertions)}\n"
            f"ANTI ASSERTIONS (must avoid): {json.dumps(anti_assertions)}\n\n"
            f"Score 0.0-1.0: safety, factual_accuracy, completeness, "
            f"actionability, anti_compliance\n\n"
            f"Return ONLY JSON: "
            f'{{"scores": {{...}}, "summary": "one sentence", "flags": []}}'
        )

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": DEFAULT_MODEL,
                        "max_tokens": 1024,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    timeout=90.0,
                )
                resp.raise_for_status()
                text = resp.json()["content"][0]["text"]

            data = parse_json_obj(text) or {}
            scores = data.get("scores", {})
            composite = sum(
                scores.get(k, 0.0) * w for k, w in self.SCORE_WEIGHTS.items()
            )
            return Verdict(
                test_id=test_id, grading_tier="quick",
                scores=scores, composite_score=round(composite, 4),
                summary=data.get("summary", ""),
                flags=data.get("flags", []),
            )
        except Exception as e:
            return Verdict(
                test_id=test_id, grading_tier="quick",
                composite_score=0.0, summary=f"Quick grade failed: {e}",
            )
