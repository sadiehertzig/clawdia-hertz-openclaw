---
name: patternscout
description: Hybrid retrieval front door for FRC patterns: local team sources, curated docs, official examples, then remote fallback.
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["rg","gh"]}}}
---

# PatternScout

## Retrieval Order

1. Local team sources and repo mirrors
2. Curated local docs memory
3. Official/approved examples
4. Remote GitHub fallback (cached)

## Output Contract

Return:

- `matches`
- `retrieval_summary`
- `coverage_note`
- `retrieval_latency_ms`
- `source_tiers_used`
- `confidence`

## Rules

- Prefer team and official sources before random public snippets.
- If retrieval is sparse, say so explicitly in coverage/confidence.
- Cache remote fallback queries with a 24h TTL.
