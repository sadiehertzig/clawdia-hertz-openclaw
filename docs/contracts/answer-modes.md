# Answer Modes

Priority order:

1. `guarded_answer`
2. `escalated_answer`
3. `reviewed_answer`
4. `direct_answer`

Interpretation:

- `direct_answer`: no review or escalation happened
- `reviewed_answer`: Arbiter completed review
- `escalated_answer`: request escalated to DeepDebug
- `guarded_answer`: a required review/escalation stage was unavailable or failed

Integrity constraints:

- `reviewed_answer` is only valid when Arbiter completed in the same request.
- Substantive FRC requests must become `guarded_answer` if Arbiter is unavailable or errors.
