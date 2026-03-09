# Builder Contract

Required:

- `student_facing_explanation`
- `code_blocks` (or equivalent draft code payload)
- `facts`
- `summary`

Builder must set:

- `contract_flags.reviewed = false`
- `contract_flags.escalated = false`

Builder must not claim review completion.
