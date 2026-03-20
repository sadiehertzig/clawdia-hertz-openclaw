#!/usr/bin/env python3
"""Regression checks for AutoImprove-TBC runtime behavior."""

import asyncio
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTOIMPROVE_DIR = ROOT / "agents" / "clawdia" / "skills" / "autoimprove-tbc"

import sys
sys.path.insert(0, str(AUTOIMPROVE_DIR))

try:
    import httpx  # type: ignore  # noqa: F401
except ModuleNotFoundError:
    import types

    stub = types.ModuleType("httpx")

    class _DummyAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def request(self, *args, **kwargs):
            raise RuntimeError("httpx unavailable in validation environment")

        async def post(self, *args, **kwargs):
            raise RuntimeError("httpx unavailable in validation environment")

    stub.AsyncClient = _DummyAsyncClient
    class _DummyResponse:  # pragma: no cover - validation fallback only
        status_code = 0
        headers = {}
        text = ""
        request = None

        def json(self):
            return {}

    class _DummyError(Exception):
        pass

    stub.Response = _DummyResponse
    stub.ReadTimeout = _DummyError
    stub.TimeoutException = _DummyError
    stub.RequestError = _DummyError
    stub.HTTPStatusError = _DummyError
    sys.modules["httpx"] = stub

import autoimprove
from improver import Improver
from models import AutoImproveConfig, ResultsLogger
from runner import ResponseRunner


class AutoImproveRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_session_path = autoimprove.SESSION_STATE_PATH
        cls._orig_paused_path = autoimprove.PAUSED_TARGETS_PATH

    @classmethod
    def tearDownClass(cls):
        autoimprove.SESSION_STATE_PATH = cls._orig_session_path
        autoimprove.PAUSED_TARGETS_PATH = cls._orig_paused_path

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        tmp_root = Path(self.tempdir.name)
        self._orig_targets_dir = autoimprove.TARGETS_DIR
        autoimprove.SESSION_STATE_PATH = tmp_root / "sessions.json"
        autoimprove.PAUSED_TARGETS_PATH = tmp_root / "paused.json"
        autoimprove.TARGETS_DIR = tmp_root / "targets"
        autoimprove.TARGETS_DIR.mkdir(parents=True, exist_ok=True)
        self._orig_skills_dir_env = os.environ.get("OPENCLAW_SKILLS_DIR")
        self._orig_skills_dir = autoimprove._SKILLS_DIR
        os.environ["OPENCLAW_SKILLS_DIR"] = self.tempdir.name
        autoimprove._SKILLS_DIR = Path(self.tempdir.name)
        seed_skill = autoimprove._SKILLS_DIR / "autoimprove"
        seed_skill.mkdir(parents=True, exist_ok=True)
        (seed_skill / "SKILL.md").write_text(
            "---\nname: autoimprove\ndescription: seed skill\n---\n\n# Skill\n- Be clear.\n"
        )

    def tearDown(self):
        autoimprove._SKILLS_DIR = self._orig_skills_dir
        autoimprove.TARGETS_DIR = self._orig_targets_dir
        if self._orig_skills_dir_env is None:
            os.environ.pop("OPENCLAW_SKILLS_DIR", None)
        else:
            os.environ["OPENCLAW_SKILLS_DIR"] = self._orig_skills_dir_env
        self.tempdir.cleanup()

    def test_legacy_program_parser(self):
        legacy = Path(self.tempdir.name) / "program.md"
        legacy.write_text(
            """
# AutoImprove Program - legacy

target_skill: legacy_skill
skill_path: /tmp/legacy/SKILL.md
mode: tool_simulation
audience: high school students
expertise_level: beginner
style_notes: clear explanation

priorities:
  - simplify language
  - cite sources

constraints:
  - no fabrication

safety_rules:
  - no fake urls

grading_tier: tiered
max_iterations: 9
""".strip()
        )

        cfg = AutoImproveConfig.load(str(legacy))
        self.assertEqual(cfg.target_skill, "legacy_skill")
        self.assertEqual(cfg.audience, "high school students")
        self.assertEqual(cfg.style_notes, "clear explanation")
        self.assertEqual(cfg.priorities, ["simplify language", "cite sources"])
        self.assertEqual(cfg.constraints, ["no fabrication"])
        self.assertEqual(cfg.safety_rules, ["no fake urls"])
        self.assertEqual(cfg.max_iterations, 9)

    def test_config_bounds_enforced(self):
        legacy = Path(self.tempdir.name) / "program-bounds.md"
        legacy.write_text(
            """
target_skill: legacy_skill
skill_path: /tmp/legacy/SKILL.md
max_iterations: 5000
token_budget: 999999999
""".strip()
        )
        cfg = AutoImproveConfig.load(str(legacy))
        self.assertEqual(cfg.max_iterations, 50)
        self.assertEqual(cfg.token_budget, 5_000_000)

    def test_report_uses_latest_baseline(self):
        target_name = "__utest_report__"
        target_dir = autoimprove.TARGETS_DIR / target_name
        target_dir.mkdir(parents=True, exist_ok=True)

        results = target_dir / "results.tsv"
        logger = ResultsLogger(str(results))
        logger.log("baseline", 0.0, 0.9, True, "baseline")
        logger.log("baseline", 0.0, 0.7, True, "baseline")
        logger.log("edit", 0.7, 0.75, True, "improved")

        rep = autoimprove.AutoImprove(target_name, verbose=False).report()
        self.assertIn("Starting score: 0.7000", rep)
        self.assertIn("Current score:  0.7500", rep)

        shutil.rmtree(target_dir, ignore_errors=True)

    def test_handle_skill_request_session_flow(self):
        ctx = {"session_id": "utest-session-1"}

        first = asyncio.run(autoimprove.handle_skill_request("improve autoimprove", context=ctx))
        self.assertIn("What's bothering you", first)

        second = asyncio.run(autoimprove.handle_skill_request("It is vague", context=ctx))
        self.assertIn("Who's the primary audience", second)

    def test_pause_command_parsing(self):
        resp = asyncio.run(autoimprove.handle_skill_request("autoimprove pause research-helper"))
        self.assertIn("Paused autoimprove-tbc target: research-helper", resp)

    def test_add_and_show_test_bank_commands(self):
        tmp_skill_dir = autoimprove._SKILLS_DIR / "__utest_skill__"
        tmp_skill_dir.mkdir(parents=True, exist_ok=True)
        skill_md = tmp_skill_dir / "SKILL.md"
        skill_md.write_text(
            """
---
name: utest-skill
description: test skill
---

# Skill
- Use clarity.
""".strip()
        )

        add_cmd = (
            f"add test question for {skill_md} :: What does this skill do? "
            "|| It explains behavior clearly."
        )
        add_resp = asyncio.run(autoimprove.handle_skill_request(add_cmd))
        self.assertIn("Added curated test question", add_resp)

        show_resp = asyncio.run(autoimprove.handle_skill_request(f"show test bank for {skill_md}"))
        self.assertIn("Test bank", show_resp)
        self.assertIn("What does this skill do?", show_resp)

    def test_improver_parse_and_fallback(self):
        improver = Improver()
        noisy = (
            "Sure, here is the patch:\n```json\n"
            "{\"edit_description\":\"x\",\"edit_type\":\"add_section\","
            "\"insert_after\":\"# Skill\",\"content_to_add\":\"## Added\\nDetails\"}"
            "\n```"
        )
        parsed = improver._parse_edit_response(noisy)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["edit_type"], "add_section")

        fallback = improver._fallback_edit("# Skill\n", [{"question": "unknown company"}])
        self.assertIn("content_to_add", fallback)
        self.assertIn("Reliability", fallback["content_to_add"])

    def test_improver_rejects_suspicious_content(self):
        improver = Improver()
        blocked = {
            "edit_description": "bad",
            "edit_type": "add_section",
            "insert_after": "# Skill",
            "content_to_add": "```bash\nrm -rf /\n```",
        }
        self.assertIsNone(improver._sanitize_edit(blocked))

    def test_direct_invocation_disabled_by_default(self):
        os.environ.pop("AUTOIMPROVE_ALLOW_DIRECT_INVOCATION", None)
        runner = ResponseRunner()
        tc = autoimprove.TestCase(id="t1", question="hello")
        result = asyncio.run(runner._run_direct("/tmp/whatever.py", tc))
        self.assertTrue(result["error"])
        self.assertIn("disabled", result["response"])

    def test_path_traversal_rejected(self):
        self.assertIsNone(autoimprove._validated_skill_md("/etc/passwd"))
        self.assertIsNone(autoimprove._resolve_skill_match("../../etc/passwd"))

    def test_improver_model_chain_resolution(self):
        env_keys = [
            "AUTOIMPROVE_IMPROVER_MODEL_CHAIN",
            "AUTOIMPROVE_IMPROVER_MODEL",
            "AUTOIMPROVE_IMPROVER_FALLBACK_MODEL",
        ]
        saved = {k: os.environ.get(k) for k in env_keys}
        try:
            for key in env_keys:
                os.environ.pop(key, None)

            os.environ["AUTOIMPROVE_IMPROVER_MODEL"] = "claude-opus-4-6"
            improver = Improver()
            self.assertEqual(
                improver.model_chain,
                ["claude-opus-4-6", "claude-sonnet-4-6"],
            )

            os.environ["AUTOIMPROVE_IMPROVER_MODEL_CHAIN"] = (
                "claude-opus-4-6, claude-sonnet-4-6, claude-3-5-haiku-latest"
            )
            improver = Improver()
            self.assertEqual(
                improver.model_chain,
                ["claude-opus-4-6", "claude-sonnet-4-6", "claude-3-5-haiku-latest"],
            )
        finally:
            for key in env_keys:
                if saved[key] is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = saved[key]


if __name__ == "__main__":
    unittest.main(verbosity=2)
