"""
AutoImprove response runner.
Runs test questions through a skill, captures responses.

Modes:
    agent_simulation — inject skill as system prompt, query a model
    direct_invocation — call the skill's Python entry point
"""

import asyncio
import importlib.util
import inspect
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

from models import TestCase, DEFAULT_MODEL, empty_usage, add_usage


class ResponseRunner:
    """Runs test questions through a skill and captures responses."""

    def __init__(self):
        self.anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
        self.token_usage = empty_usage()

    def _track_usage(self, raw_usage: dict | None):
        add_usage(self.token_usage, raw_usage)

    def consume_usage(self) -> dict:
        usage = dict(self.token_usage)
        self.token_usage = empty_usage()
        return usage

    async def run_one(self, skill_content: str, test_case: TestCase,
                      mode: str = "agent_simulation",
                      model: str = DEFAULT_MODEL,
                      style_notes: str = "",
                      skill_path: str = "") -> dict:
        """Run a single test question."""
        if mode == "direct_invocation":
            return await self._run_direct(skill_path, test_case)
        return await self._run_sim(skill_content, test_case, model, style_notes)

    async def run_batch(self, skill_content: str, test_bank: list,
                        mode: str = "agent_simulation",
                        model: str = DEFAULT_MODEL,
                        concurrency: int = 3,
                        style_notes: str = "",
                        skill_path: str = "") -> list:
        """Run all test questions with bounded concurrency."""
        sem = asyncio.Semaphore(concurrency)

        async def bounded(tc):
            async with sem:
                return await self.run_one(skill_content, tc, mode, model,
                                          style_notes, skill_path)

        return await asyncio.gather(*[bounded(tc) for tc in test_bank])

    async def _run_sim(self, skill_content: str, tc: TestCase, model: str,
                       style_notes: str = "") -> dict:
        if not self.anthropic_key:
            return self._err(tc, "No ANTHROPIC_API_KEY set")

        style_instruction = ""
        if style_notes:
            style_instruction = f"\n\nResponse style: {style_notes}"

        system = (
            "You are an OpenClaw agent with this skill loaded:\n\n"
            f"{skill_content[:12000]}\n\n"
            "Answer the user's question using the knowledge and procedures "
            f"in this skill file. Be specific, concrete, and actionable.{style_instruction}"
        )

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": self.anthropic_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": 4096,
                        "system": system,
                        "messages": [{"role": "user", "content": tc.question}],
                    },
                    timeout=120.0,
                )
                resp.raise_for_status()
                payload = resp.json()
                self._track_usage(payload.get("usage"))
                text = payload["content"][0]["text"]
                return {
                    "test_id": tc.id,
                    "question": tc.question,
                    "response": text,
                    "key_assertions": tc.key_assertions,
                    "anti_assertions": tc.anti_assertions,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": model,
                    "mode": "agent_simulation",
                    "token_usage": payload.get("usage", {}),
                    "error": False,
                }
            except Exception as e:
                return self._err(tc, str(e))

    def _find_entry_point(self, skill_path: str) -> str | None:
        """
        Locate the Python entry point for a skill.

        If skill_path is a .py file, use it directly.
        If it's a .md file or directory, scan the parent/directory for
        .py files containing handle_skill_request.
        """
        p = Path(skill_path)

        # Direct .py file
        if p.suffix == ".py" and p.exists():
            return str(p)

        # Determine directory to scan
        if p.is_dir():
            scan_dir = p
        elif p.exists():
            scan_dir = p.parent
        else:
            return None

        # Look for .py files with handle_skill_request
        for py_file in sorted(scan_dir.glob("*.py")):
            if py_file.name.startswith("__"):
                continue
            try:
                text = py_file.read_text()
                if "def handle_skill_request" in text:
                    return str(py_file)
            except OSError:
                continue

        return None

    async def _run_direct(self, skill_path: str, tc: TestCase) -> dict:
        if not skill_path:
            return self._err(tc, "No skill_path provided for direct_invocation mode")

        entry_point = self._find_entry_point(skill_path)
        if not entry_point:
            return self._err(tc, f"No Python entry point with handle_skill_request found near {skill_path}")

        try:
            spec = importlib.util.spec_from_file_location("skill_mod", entry_point)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            if hasattr(module, "handle_skill_request"):
                fn = module.handle_skill_request
                if asyncio.iscoroutinefunction(fn):
                    response = await fn(tc.question)
                else:
                    response = fn(tc.question)
            elif hasattr(module, "main"):
                response = module.main(tc.question)
            else:
                return self._err(tc, "No callable entry point (handle_skill_request or main)")

            return {
                "test_id": tc.id, "question": tc.question,
                "response": str(response),
                "key_assertions": tc.key_assertions,
                "anti_assertions": tc.anti_assertions,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "mode": "direct_invocation",
                "token_usage": {},
                "error": False,
            }
        except Exception as e:
            return self._err(tc, str(e))

    def _err(self, tc: TestCase, msg: str) -> dict:
        return {
            "test_id": tc.id, "question": tc.question,
            "response": f"ERROR: {msg}",
            "key_assertions": tc.key_assertions,
            "anti_assertions": tc.anti_assertions,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "mode": "error",
            "token_usage": {},
            "error": True,
        }
