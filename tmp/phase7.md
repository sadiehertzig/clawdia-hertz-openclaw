GatorBots Help Desk Runtime – Phase 7

Current state:
Phase 6 completed. The wrapper scripts/codex-implement.sh captures Codex output,
detects FINAL_STATUS markers, records a dossier result, and preserves the real
Codex exit code even if dossier recording fails.

Goal for Phase 7:
Improve robustness of FINAL_STATUS detection so only the LAST marker in the log
determines the semantic result.

Constraints:
- Smallest safe patch
- No refactors
- Do not change prompt contract
- Preserve Codex exit code behavior

Primary file to inspect:
scripts/codex-implement.sh
