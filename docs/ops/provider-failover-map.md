# Provider Failover Map

## Runtime model map

| Role | Primary | Fallbacks | Notes |
|---|---|---|---|
| Clawdia (main) | `anthropic/claude-sonnet-4-6` | provider chain from runtime config | keep public assistant identity stable |
| Builder | `openai/gpt-5.3-codex` | `openai/gpt-5.4` | drafting lane |
| Librarian | `openai/gpt-5.4` | provider default chain | docs/API lane |
| Arbiter | `openai/gpt-5.4-pro` | `openai/gpt-5.4`, Sonnet-class | review gate, premium allocation priority |
| Checker | tool-first + `openai/gpt-5.4` | tool-first fallback behavior | validation lane |
| DeepDebug | `anthropic/claude-opus-4-6` | `openai/gpt-5.4`, Sonnet-class | hard escalation |
| PatternScout | in-process retrieval worker | local retrieval fallback tiers | remains non-spawned for now |

## Delegation strategy

- Core orchestration uses SDK-style spawned worker delegation for substantive Builder/Arbiter/DeepDebug stages.
- MCP remains for external integrations and tools, not primary multi-worker orchestration.
