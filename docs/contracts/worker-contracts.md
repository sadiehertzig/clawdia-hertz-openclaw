# Worker Contract Requirements

## PatternScout
Required fields:

- `matches`
- `retrieval_summary`
- `coverage_note`
- `retrieval_latency_ms`
- `source_tiers_used`
- `confidence`

## Librarian
Required fields:

- `key_apis`
- `facts`
- `sources`

## Builder
Required fields:

- `student_facing_explanation`
- one or more code outputs (`code_blocks` or equivalent)
- `facts`

Builder must never mark output as reviewed.

## Checker
Required fields:

- `tests`
- `overall_status`
- `worktree_path`
- `summary`
- `status`

## Arbiter
Required fields:

- `verdict` (`approve`, `revise`, or `escalate`)
- `concern_list`
- revised output when verdict is `revise`

## DeepDebug
Required fields:

- `diagnosis`
- `fix`
- `regression_checks`
- `unknowns`
