# Provider Failover Map

| Role | Primary | Fallback | Notes |
|---|---|---|---|
| Clawdia | live configured model | provider fallback chain | preserve deployed production IDs |
| Builder | OpenAI Codex-class model | Sonnet-class reviewer model | drafting lane |
| Librarian | Gemini-class docs model | lighter Gemini fallback | docs/API lane |
| Arbiter | Sonnet-class review model | GPT-class fallback | review gate |
| DeepDebug | Opus-class model | Sonnet fallback | hard escalation |
| Checker | tool-first | model optional | validation lane |

Use live host identifiers over placeholder names when applying this map.
