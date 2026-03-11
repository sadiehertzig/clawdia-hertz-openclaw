#!/usr/bin/env python3
"""
AutoImprove — Self-Improving Skill Loop for OpenClaw
Orchestrator, CLI, and OpenClaw entry point.

CLI:
    python autoimprove.py interview  --skill /path/to/SKILL.md
    python autoimprove.py generate   --target skill-name
    python autoimprove.py baseline   --target skill-name
    python autoimprove.py run        --target skill-name [--iterations 15]
    python autoimprove.py report     --target skill-name
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_SELF_DIR = Path(__file__).resolve().parent
if str(_SELF_DIR) not in sys.path:
    sys.path.insert(0, str(_SELF_DIR))

# Load API keys from ~/.openclaw/.env if present
_ENV_FILE = Path.home() / ".openclaw" / ".env"
if _ENV_FILE.exists():
    for line in _ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

from models import (
    TestCase, Verdict, AutoImproveConfig,
    ResultsLogger, load_test_bank, save_test_bank,
)
from interview import InterviewEngine
from question_gen import QuestionGenerator
from runner import ResponseRunner
from grader import Grader
from scorer import Scorer, Ratchet
from improver import Improver
from notify import TelegramApproval, apply_approved_skill, discard_proposed_skill

TARGETS_DIR = Path.home() / ".openclaw" / "skills" / "autoimprove" / "targets"


class AutoImprove:
    """Main orchestrator."""

    def __init__(self, target_name: str, verbose: bool = True):
        self.target_name = target_name
        self.target_dir = TARGETS_DIR / target_name
        self.target_dir.mkdir(parents=True, exist_ok=True)
        (self.target_dir / "verdicts").mkdir(exist_ok=True)

        self.verbose = verbose

        self.runner = ResponseRunner()
        self.scorer = Scorer()
        self.improver = Improver()
        self.logger = ResultsLogger(str(self.target_dir / "results.tsv"))

    def _log(self, msg):
        if self.verbose:
            print(msg, file=sys.stderr)

    # -- Persistence --

    def config_path(self): return self.target_dir / "program.md"
    def bank_path(self):   return self.target_dir / "test_bank.json"

    def load_config(self):
        p = self.config_path()
        return AutoImproveConfig.load(str(p)) if p.exists() else AutoImproveConfig(target_skill=self.target_name)

    def save_config(self, cfg):
        cfg.save(str(self.config_path()))

    def load_bank(self):
        return load_test_bank(str(self.bank_path()))

    def save_bank(self, bank):
        save_test_bank(bank, str(self.bank_path()))

    # -- Interview --

    async def run_interview_cli(self, skill_path: str):
        """Interactive CLI interview."""
        content = Path(skill_path).read_text()
        name = Path(skill_path).parent.name

        engine = InterviewEngine(name, content, skill_path)

        while not engine.is_complete():
            prompt = engine.get_next_prompt()
            if not prompt:
                break
            print(f"\n{prompt}\n")
            answer = input("> ").strip()

            result = engine.process_response(answer)
            if result == "confirm_program_revision":
                print("\nGot it, revising...\n")

        config = engine.build_config()
        self.save_config(config)
        self._log(f"\nSaved: {self.config_path()}")

        # Curated test cases from examples
        examples = engine.get_example_pairs()
        if examples:
            gen = QuestionGenerator.__new__(QuestionGenerator)
            bank = self.load_bank()
            for ex in examples:
                bank.append(gen.create_from_example(ex["question"], ex["answer"]))
            self.save_bank(bank)
            self._log(f"Added {len(examples)} curated test case(s)")

        return config

    # -- Question generation --

    async def generate_questions(self):
        config = self.load_config()
        content = Path(config.skill_path).read_text()

        self._log("Convening Three-Body Council for test questions...")
        gen = QuestionGenerator(verbose=self.verbose)
        new_tcs = await gen.channel_a(content, config)

        bank = self.load_bank()
        existing = {tc.id for tc in bank}
        added = [tc for tc in new_tcs if tc.id not in existing]
        bank.extend(added)
        self.save_bank(bank)
        self._log(f"Generated {len(added)} questions. Bank: {len(bank)} total")
        return bank

    # -- Baseline --

    async def run_baseline(self):
        config = self.load_config()
        bank = self.load_bank()
        content = Path(config.skill_path).read_text()

        self._log(f"Baseline: {len(bank)} questions...")
        responses = await self.runner.run_batch(content, bank, config.mode)

        self._log("Grading...")
        grader = Grader(verbose=self.verbose)
        verdicts = await grader.grade_batch(responses, content[:3000], config)

        scores = self.scorer.per_question_scores(verdicts)
        agg = self.scorer.weighted_mean(scores, bank)
        self.logger.log("baseline", 0.0, agg, True, "baseline")

        self._log(f"\nBaseline: {agg:.3f}")
        for tid, sc in sorted(scores.items(), key=lambda x: x[1]):
            self._log(f"  {tid}: {sc:.3f}")

        return {"scores": scores, "verdicts": verdicts, "aggregate": agg}

    # -- Improvement loop --

    async def run_loop(self, max_iters: int = None):
        config = self.load_config()
        bank = self.load_bank()
        skill_content = Path(config.skill_path).read_text()

        ratchet = Ratchet(config.repo_path)
        grader = Grader(verbose=False)
        iters = max_iters or config.max_iterations

        self._log(f"Loop: {iters} iterations, {len(bank)} questions\n")

        # Baseline
        responses = await self.runner.run_batch(skill_content, bank, config.mode)
        verdicts = await grader.grade_batch(responses, skill_content[:3000], config)
        cur_scores = self.scorer.per_question_scores(verdicts)
        cur_verdicts = verdicts
        cur_agg = self.scorer.weighted_mean(cur_scores, bank)
        self._log(f"Baseline: {cur_agg:.3f}\n")

        consec_reverts = 0
        tc_map = {tc.id: tc for tc in bank}

        for i in range(iters):
            self._log(f"-- Iter {i+1}/{iters} --")

            if consec_reverts >= 3:
                self._log("3 consecutive reverts — stopping")
                break

            # Build worst-questions payload
            worst = self.scorer.find_worst(cur_scores, 5)
            verdict_map = {v.test_id: v for v in cur_verdicts}
            worst_payload = [{
                "test_id": tid,
                "question": tc_map.get(tid, TestCase(id="", question="")).question,
                "score": sc,
                "summary": verdict_map.get(tid, Verdict(test_id="")).summary,
                "flags": verdict_map.get(tid, Verdict(test_id="")).flags,
            } for tid, sc in worst]

            # Propose
            edit = await self.improver.propose(
                skill_content, config, worst_payload,
                edit_history=self.logger.tail(10),
            )
            if not edit:
                self._log("  No edit proposed. Stopping.")
                break

            desc = edit.get("edit_description", "unknown")
            self._log(f"  Proposed: {desc}")

            if not self.improver.apply(config.skill_path, edit):
                self._log("  Apply failed. Skipping.")
                consec_reverts += 1
                continue

            modified = Path(config.skill_path).read_text()

            # Score
            new_resp = await self.runner.run_batch(modified, bank, config.mode)
            new_verd = await grader.grade_batch(new_resp, modified[:3000], config)
            new_scores = self.scorer.per_question_scores(new_verd)
            new_agg = self.scorer.weighted_mean(new_scores, bank)

            # Ratchet
            keep, reason = ratchet.should_keep(
                cur_scores, new_scores, cur_verdicts, new_verd,
                bank, config, self.scorer,
            )

            w_tid = min(new_scores, key=new_scores.get) if new_scores else ""
            w_sc = new_scores.get(w_tid, 0.0)

            if keep:
                ratchet.commit(desc)
                self.logger.log(desc, cur_agg, new_agg, True, reason, w_tid, w_sc)
                cur_scores, cur_verdicts, cur_agg = new_scores, new_verd, new_agg
                skill_content = modified
                consec_reverts = 0
                self._log(f"  KEPT ({cur_agg:.3f} -> {new_agg:.3f})")
            else:
                # Restore the known-good content to disk (works with or without git)
                Path(config.skill_path).write_text(skill_content)
                ratchet.revert()
                self.logger.log(desc, cur_agg, new_agg, False, reason, w_tid, w_sc)
                consec_reverts += 1
                self._log(f"  REVERTED ({reason})")

            # Channel C every 5 iters
            if i > 0 and i % 5 == 0:
                weak = [
                    {"id": t, "question": tc_map.get(t, TestCase(id="", question="")).question,
                     "score": s, "summary": "low"}
                    for t, s in cur_scores.items() if s < 0.5
                ]
                if weak:
                    self._log(f"  Expanding {len(weak)} weak areas...")
                    gen = QuestionGenerator(verbose=False)
                    new_tcs = await gen.channel_c(weak, skill_content[:4000])
                    bank.extend(new_tcs)
                    tc_map.update({tc.id: tc for tc in new_tcs})
                    self.save_bank(bank)

        try: ratchet.push()
        except Exception: pass

        final = self.scorer.weighted_mean(cur_scores, bank)
        self._log(f"\nFinal: {final:.3f}")
        return {"aggregate": final, "scores": cur_scores, "verdicts": cur_verdicts}

    # -- Sweep (Karpathy loop) --

    async def sweep(self, max_rounds: int = 10, iters_per_round: int = 5):
        """
        The recursive self-improvement loop:
        1. Copy skill to a temp working file
        2. Run rounds of improvements until convergence
        3. Send original vs proposed diff to Telegram for approval
        4. If accepted: overwrite original, git commit + push, delete temp
        5. If rejected: delete temp, original untouched

        Requires interview + generate to have been run first.
        """
        config = self.load_config()
        if not config.skill_path or not Path(config.skill_path).exists():
            self._log("No config found. Run 'interview' and 'generate' first.")
            return

        bank = self.load_bank()
        if not bank:
            self._log("No test bank. Run 'generate' first.")
            return

        original_path = config.skill_path
        original_content = Path(original_path).read_text()

        # Work on a temp copy so the original is never touched until approval
        import tempfile
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", prefix=f"autoimprove_{self.target_name}_",
            dir="/tmp", delete=False,
        )
        tmp.write(original_content)
        tmp.close()
        working_path = tmp.name

        # Point config at the temp file for the duration of the sweep
        config.skill_path = working_path
        self.save_config(config)

        self._log(f"=== SWEEP: {self.target_name} ===")
        self._log(f"Skill: {original_path}")
        self._log(f"Working copy: {working_path}")
        self._log(f"Test bank: {len(bank)} questions")
        self._log(f"Max rounds: {max_rounds}, iters/round: {iters_per_round}")
        self._log("")

        prev_agg = 0.0
        stale_rounds = 0
        baseline_agg = 0.0

        for round_num in range(1, max_rounds + 1):
            self._log(f"=== Round {round_num}/{max_rounds} ===")

            result = await self.run_loop(max_iters=iters_per_round)
            cur_agg = result["aggregate"] if result else 0.0

            if round_num == 1:
                baseline_agg = cur_agg

            improvement = cur_agg - prev_agg
            if round_num > 1:
                if improvement < config.min_improvement:
                    stale_rounds += 1
                    self._log(f"  Round delta: {improvement:+.4f} (stale {stale_rounds}/3)")
                else:
                    stale_rounds = 0
                    self._log(f"  Round delta: {improvement:+.4f}")

            if stale_rounds >= 3:
                self._log(f"\n3 stale rounds — converged at {cur_agg:.3f}")
                break

            prev_agg = cur_agg

            # Between rounds: expand test bank for weak areas
            if round_num < max_rounds:
                bank = self.load_bank()
                scores = result.get("scores", {})
                weak = [
                    {"id": tid, "question": tc.question, "score": scores.get(tid, 0.0),
                     "summary": "low score"}
                    for tc in bank
                    for tid in [tc.id]
                    if scores.get(tid, 1.0) < 0.5
                ]
                if weak:
                    self._log(f"\nGenerating follow-up questions for {len(weak)} weak areas...")
                    gen = QuestionGenerator(verbose=False)
                    new_tcs = await gen.channel_c(weak[:3], Path(working_path).read_text()[:4000])
                    existing = {tc.id for tc in bank}
                    added = [tc for tc in new_tcs if tc.id not in existing]
                    bank.extend(added)
                    self.save_bank(bank)
                    if added:
                        self._log(f"Added {len(added)} new questions. Bank: {len(bank)} total")
                self._log("")

        # Restore config to point at the original
        config.skill_path = original_path
        self.save_config(config)

        modified_content = Path(working_path).read_text()

        self._log(f"\n=== SWEEP COMPLETE ===")
        self._log(f"Score: {baseline_agg:.3f} -> {prev_agg:.3f}")

        # If no changes were made, clean up and exit
        if original_content == modified_content:
            self._log("No changes to propose.")
            discard_proposed_skill(working_path)
            return

        # Send to Telegram for approval
        self._log("Sending to Telegram for approval...")
        tg = TelegramApproval()
        accepted = await tg.request_approval(
            skill_name=self.target_name,
            original=original_content,
            modified=modified_content,
            score_before=baseline_agg,
            score_after=prev_agg,
        )

        if accepted:
            self._log("ACCEPTED — applying to repo")
            apply_approved_skill(original_path, working_path, self.target_name)
            await tg.notify(f"AutoImprove: <b>{self.target_name}</b> updated and pushed.")
        else:
            self._log("REJECTED — discarding proposed changes")
            discard_proposed_skill(working_path)
            await tg.notify(f"AutoImprove: <b>{self.target_name}</b> changes discarded.")

        self._log(self.report())

    # -- Report --

    def report(self) -> str:
        entries = self.logger.parse_entries()
        if not entries:
            return f"No results for {self.target_name}."

        non_bl = [e for e in entries if e.get("edit_description") != "baseline"]
        kept = sum(1 for e in non_bl if e.get("kept") == "True")
        reverted = len(non_bl) - kept

        first_agg = entries[0].get("aggregate_after", "?")
        last_agg = entries[-1].get("aggregate_after", "?")

        lines = [
            f"AutoImprove Report — {self.target_name}",
            f"Date: {datetime.now().strftime('%Y-%m-%d')}",
            "",
            f"Starting score: {first_agg}",
            f"Current score:  {last_agg}",
            f"Edits proposed: {len(non_bl)}",
            f"Edits kept:     {kept}" + (f" ({kept*100//max(len(non_bl),1)}%)" if non_bl else ""),
            f"Edits reverted: {reverted}",
            "",
            "Recent changes:",
        ]
        for e in non_bl[-10:]:
            status = "KEPT" if e.get("kept") == "True" else f"REVERTED ({e.get('reason', '?')})"
            lines.append(f"  {e.get('edit_description', '?')} -> {status}")

        return "\n".join(lines)


# ---------------------------------------------------------
# OpenClaw skill entry point
# ---------------------------------------------------------

SKILL_TRIGGERS = [
    "improve ", "make better", "autoimprove", "self-improve",
    "optimize skill", "tune up", "skill quality", "nightly improvement",
]

REPORT_TRIGGERS = [
    "autoimprove results", "autoimprove report", "autoimprove status",
    "what did autoimprove", "improvement report",
]


async def handle_skill_request(user_input: str, context=None):
    lower = user_input.lower().strip()

    if any(t in lower for t in REPORT_TRIGGERS):
        if TARGETS_DIR.exists():
            targets = [d.name for d in TARGETS_DIR.iterdir() if d.is_dir()]
            if targets:
                return "\n\n---\n\n".join(AutoImprove(t, verbose=False).report() for t in targets)
        return "No autoimprove targets yet. Say 'improve [skill name]' to start."

    hint = lower
    for t in SKILL_TRIGGERS:
        hint = hint.replace(t, "")
    hint = hint.strip()

    if not hint:
        return "Which skill should I improve? Name it, upload the SKILL.md, or give me the path."

    skills_dir = Path.home() / ".openclaw" / "skills"

    found = None
    if skills_dir.exists():
        for d in skills_dir.iterdir():
            if d.is_dir() and hint in d.name.lower():
                md = d / "SKILL.md"
                if md.exists():
                    found = md
                    break

    if not found:
        return f"Couldn't find a skill matching '{hint}'. Upload the SKILL.md or give me the path."

    content = found.read_text()
    name = found.parent.name

    return (
        f"I've read the **{name}** skill ({len(content)} chars).\n\n"
        f"Let me ask a few questions to set up the improvement program.\n\n"
        f"What's bothering you about this skill right now? Specific failures, "
        f"general quality issues, complaints — anything."
    )


# ---------------------------------------------------------
# CLI
# ---------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="AutoImprove — Self-Improving Skill Loop")
    sub = parser.add_subparsers(dest="cmd")

    p = sub.add_parser("interview"); p.add_argument("--skill", required=True); p.add_argument("--target", default="")
    p = sub.add_parser("generate");  p.add_argument("--target", required=True)
    p = sub.add_parser("baseline");  p.add_argument("--target", required=True)
    p = sub.add_parser("run");       p.add_argument("--target", required=True); p.add_argument("--iterations", type=int, default=None)
    p = sub.add_parser("sweep");     p.add_argument("--target", required=True); p.add_argument("--rounds", type=int, default=10); p.add_argument("--iters", type=int, default=5)
    p = sub.add_parser("report");    p.add_argument("--target", required=True)

    args = parser.parse_args()

    if args.cmd == "interview":
        asyncio.run(AutoImprove(args.target or Path(args.skill).parent.name).run_interview_cli(args.skill))
    elif args.cmd == "generate":
        asyncio.run(AutoImprove(args.target).generate_questions())
    elif args.cmd == "baseline":
        asyncio.run(AutoImprove(args.target).run_baseline())
    elif args.cmd == "run":
        asyncio.run(AutoImprove(args.target).run_loop(args.iterations))
    elif args.cmd == "sweep":
        asyncio.run(AutoImprove(args.target).sweep(max_rounds=args.rounds, iters_per_round=args.iters))
    elif args.cmd == "report":
        print(AutoImprove(args.target, verbose=False).report())
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
