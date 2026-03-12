# AutoImprove Session — research_pack (2026-03-12)

## Result
- Baseline: 0.594 → Final: 0.691 (+16%)
- 3 edits kept: source quality standards, anti-truncation + tool enforcement, disambiguation + compress-not-omit
- Skill cleaned up manually after run (redundancy removed, ~4k → 2.9k chars)

## Key Learnings

### Runner
- Use `gemini-2.5-flash` for runner, not `gemini-3.1-pro-preview` (quota issues + overkill)
- `tool_simulation` mode is correct for skills that call `web_search`/`web_fetch`
- Fallback to `gemini-2.5-flash` in Three-Body Council works; runner had no fallback (now fixed)

### Token Budget
- 1M token budget is too small — hits limit after ~3 iterations
- 5M is the right budget for a full 15-iteration run
- Actual usage this session: **3,116,674 tokens** across 1,176 API calls
  - grader: 2,028,755 (65%)
  - runner: 1,055,824 (34%)
  - improver: 32,095 (1%)

### Architecture
- `agent_simulation` can't run real tools — model fakes tool calls and fabricates URLs
- `tool_simulation` uses real Gemini web grounding (correct for research_pack)
- Real ceiling fix: build Python `handle_skill_request()` entry point for `direct_invocation` mode

### Interview Flow
- Pre-interview diagnostic (top 3 improvement hypotheses) is valuable — steers test bank
- New interview.py auto-detects `tool_simulation` vs `agent_simulation` from skill content

### AutoImprove Behavior
- 3 consecutive reverts triggers early stop
- Improver tends to over-add enforcement text when stuck — sign of hitting a ceiling
- Grader uses ~65% of all tokens; improver uses <1%

## Pending Follow-up
- Build Python entry point for research_pack to enable `direct_invocation` mode for higher-quality eval
- Consider adding pre-interview diagnostic step to interview.py (not yet implemented)
