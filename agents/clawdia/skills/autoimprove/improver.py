"""
AutoImprove improver agent.
Proposes one surgical edit per iteration to address failing test questions.
"""

import json
import os
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    os.system(f"{sys.executable} -m pip install httpx --quiet --break-system-packages")
    import httpx

from models import AutoImproveConfig, DEFAULT_MODEL, parse_json_obj, empty_usage, add_usage


IMPROVER_PROMPT = """\
You are a skill file improvement agent for OpenClaw.

Make ONE surgical edit to the skill file to improve its ability to answer \
the failing test questions below.

SKILL FILE:
---
{skill_content}
---

IMPROVEMENT PRIORITIES:
{priorities}

AUDIENCE: {audience}

CONSTRAINTS (the skill must avoid violating these):
{constraints}

SAFETY RULES (the skill must NEVER do these):
{safety_rules}

WORST-SCORING TEST QUESTIONS:
{worst_questions}

PREVIOUSLY TRIED (avoid repeating):
{edit_history}

RULES:
- ONE focused addition per iteration
- ADD new sections, examples, edge cases, or patterns
- EXPAND existing content with more detail
- Do NOT delete or restructure existing content
- Do NOT touch the YAML front matter or trigger phrases
- Your edit must directly help at least one failing question
- Your edit must NOT violate any constraint or safety rule listed above
- content_to_add should be valid markdown, ready to insert as-is

Return ONLY a JSON object (no markdown fences, no commentary):
{{"edit_description":"what and why","edit_type":"add_section|expand_existing|add_example|add_edge_case","insert_after":"exact line from skill file to insert after","content_to_add":"the new content"}}
"""


class Improver:
    """Proposes and applies targeted skill file edits."""

    def __init__(self):
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")
        self.token_usage = empty_usage()

    def _track_usage(self, raw_usage: dict | None):
        add_usage(self.token_usage, raw_usage)

    def consume_usage(self) -> dict:
        usage = dict(self.token_usage)
        self.token_usage = empty_usage()
        return usage

    async def propose(self, skill_content: str, config: AutoImproveConfig,
                      worst_questions: list, edit_history: str = "") -> dict:
        """
        Propose one edit. Returns dict with edit_description, insert_after,
        content_to_add, etc. Returns None on failure.
        """
        if not self.api_key:
            return None

        prompt = IMPROVER_PROMPT.format(
            skill_content=skill_content[:8000],
            priorities="\n".join(f"- {p}" for p in config.priorities) or "None",
            audience=f"{config.audience} ({config.expertise_level})",
            constraints="\n".join(f"- {c}" for c in config.constraints) or "None specified",
            safety_rules="\n".join(f"- {s}" for s in config.safety_rules) or "None specified",
            worst_questions=json.dumps(worst_questions[:5], indent=2),
            edit_history=edit_history[-2000:] or "None yet.",
        )

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": DEFAULT_MODEL,
                        "max_tokens": 4096,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    timeout=120.0,
                )
                resp.raise_for_status()
                payload = resp.json()
                self._track_usage(payload.get("usage"))
                text = payload["content"][0]["text"]
                return parse_json_obj(text)
        except Exception as e:
            print(f"Improver error: {e}", file=sys.stderr)
            return None

    def apply(self, skill_path: str, edit: dict) -> bool:
        """
        Apply edit to file. Tries exact match, then fuzzy match,
        then appends to end as last resort. Returns True if applied.
        """
        if not edit:
            return False

        content = Path(skill_path).read_text()
        anchor = edit.get("insert_after", "")
        new_text = edit.get("content_to_add", "")

        if not new_text:
            return False

        if not anchor:
            # No anchor — append to end
            Path(skill_path).write_text(content.rstrip() + "\n\n" + new_text + "\n")
            return True

        # Try 1: Exact substring match
        idx = content.find(anchor)
        if idx >= 0:
            eol = content.find("\n", idx + len(anchor))
            if eol < 0:
                eol = len(content)
            Path(skill_path).write_text(
                content[:eol] + "\n\n" + new_text + content[eol:]
            )
            return True

        # Try 2: Fuzzy line match (word overlap)
        lines = content.split("\n")
        anchor_words = set(anchor.lower().split())
        best_i, best_score = -1, 0.0
        for i, line in enumerate(lines):
            lw = set(line.lower().strip().split())
            if not lw or not anchor_words:
                continue
            overlap = len(anchor_words & lw) / max(len(anchor_words), len(lw))
            if overlap > best_score:
                best_score = overlap
                best_i = i

        if best_score > 0.5 and best_i >= 0:
            lines.insert(best_i + 1, "\n" + new_text)
            Path(skill_path).write_text("\n".join(lines))
            return True

        # Try 3: Append to end
        Path(skill_path).write_text(content.rstrip() + "\n\n" + new_text + "\n")
        return True
