#!/usr/bin/env python3
"""Regression checks for AutoImprove runtime behavior."""

import asyncio
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTOIMPROVE_DIR = ROOT / "agents" / "clawdia" / "skills" / "autoimprove"

import sys
sys.path.insert(0, str(AUTOIMPROVE_DIR))

import autoimprove
from improver import Improver
from models import AutoImproveConfig, ResultsLogger


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
        autoimprove.SESSION_STATE_PATH = tmp_root / "sessions.json"
        autoimprove.PAUSED_TARGETS_PATH = tmp_root / "paused.json"

    def tearDown(self):
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
        self.assertIn("Paused autoimprove target: research-helper", resp)

    def test_add_and_show_test_bank_commands(self):
        tmp_skill_dir = Path(self.tempdir.name) / "utest-skill"
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
