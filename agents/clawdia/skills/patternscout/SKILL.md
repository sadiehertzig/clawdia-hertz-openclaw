---
name: patternscout
description: "Hybrid retrieval front door for FRC patterns: local team sources, curated docs, official examples, then remote fallback."
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["rg","gh"]}}}
---

# PatternScout

## Retrieval Order

1. Local team sources and repo mirrors
2. Learned pattern cards from successful prior dossiers
3. Curated local docs memory
4. Official/approved examples
5. Remote GitHub fallback scoped to curated high-quality repos (cached)

## Output Contract

Return:

- `matches`
- `retrieval_summary`
- `coverage_note`
- `retrieval_latency_ms`
- `source_tiers_used`
- `confidence`
- `source_receipts`
- `freshness_badge`

## Rules

- Prefer team and official sources before random public snippets.
- Weight candidate repositories by quality, recency, officialness, dynamic learned performance, and intent alignment.
- Keep retrieval diverse: cap repeated snippets per repo so answers cite multiple sources.
- Include evidence receipts for top sources to support explainability.
- If retrieval is sparse, say so explicitly in coverage/confidence.
- Cache retrieval queries with a bounded TTL and include registry/weight file versions in cache keying.
- Learn over time: nightly jobs should update source weights and rebuild pattern cards from labeled outcomes.
