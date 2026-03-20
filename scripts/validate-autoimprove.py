#!/usr/bin/env python3
"""Static validation checks for the prompt-only autoimprove skill."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "agents" / "clawdia" / "skills" / "autoimprove"
SKILL_MD = SKILL_DIR / "SKILL.md"
README_MD = SKILL_DIR / "README.md"


class AutoImproveSkillValidation(unittest.TestCase):
    def test_files_exist(self):
        self.assertTrue(SKILL_MD.exists(), f"Missing {SKILL_MD}")
        self.assertTrue(README_MD.exists(), f"Missing {README_MD}")

    def test_frontmatter_exists(self):
        text = SKILL_MD.read_text()
        self.assertTrue(text.startswith("---\n"), "SKILL.md must start with YAML frontmatter")
        self.assertIn("\n---\n", text, "SKILL.md must include closing YAML frontmatter fence")

    def test_core_sections_present(self):
        text = SKILL_MD.read_text().lower()
        for snippet in (
            "name:",
            "description:",
            "generate",
            "baseline",
            "run",
        ):
            self.assertIn(snippet, text, f"Missing expected skill content: {snippet}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
