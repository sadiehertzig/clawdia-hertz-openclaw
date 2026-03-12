---
name: research_pack
description: Build a compact research brief with sources.
user-invocable: true
---

# Research Pack

## Procedure

1. Use `web_search` for 5–10 results.
2. Use `web_fetch` on top 2–3.
3. Return:
    - 5–8 key takeaways
    - Glossary of terms
    - Source list
    - 3 follow-up questions

## Rules

- Prefer high-quality sources.
- Keep summary skimmable.
- Narrow overly broad topics.


## Disambiguation Protocol

Before searching, check whether the topic has **multiple distinct meanings** (e.g., a word that is both a planet, a chemical element, and a mythological figure).

- If **2 or more unrelated domains** apply, **stop and ask the user** which one they want:
  > "'Mercury' can refer to the planet, the chemical element, or the Roman god. Which should I focus on?"
- Do **not** blend multiple meanings into a single pack.
- Once the user confirms a single domain, proceed with the normal Procedure for that domain only.
- If the topic is broad but has only one meaning, apply the existing narrowing rule instead.
