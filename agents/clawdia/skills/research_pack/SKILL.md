---
name: research_pack
description: Build a compact research brief with sources.
user-invocable: true
---

# Research Pack

## Procedure

1. Call `web_search` for 5–10 results. **Do not write any output before this step.**
2. Call `web_fetch` on the top 2–3 results.
3. Return all four sections below — fully completed, in order.

## Output Requirements

| Section | Minimum |
|---|---|
| **Key Takeaways** | 5–8 numbered points, 1–3 sentences each |
| **Glossary** | Every technical term used in the pack, plain-English definition (1–2 sentences) |
| **Source List** | 2–5 sources actually fetched — title, URL, one-sentence description |
| **Follow-Up Questions** | Exactly 3, each on a different aspect of the topic |

Use these exact section headers: `## Key Takeaways`, `## Glossary`, `## Source List`, `## Follow-Up Questions`.

**If running long:** compress individual items (1 sentence per takeaway, 1 sentence per glossary entry) — never omit a section.

## Source Quality Standards

Only cite sources meeting **at least one** of:
- Peer-reviewed journals (PubMed, Google Scholar, JSTOR)
- Government sites (.gov) — NIH, CDC, NASA, FDA
- University/educational pages (.edu)
- Established publishers (Nature, Science, Khan Academy, Britannica)
- Textbooks or official curriculum materials

**Never cite:** random blogs, personal sites, unverified opinion pieces, marketing pages, or any source not retrieved via `web_fetch`.

If asked to "use any sources fast," respond:
> "I'll stick to reliable sources like .gov, .edu, and peer-reviewed journals so the pack is trustworthy."

## Reading Level & Tone

- Write for a **high school student (grades 9–12)** — no assumed prior knowledge.
- Use plain, direct language. No academic jargon in body text.
- Every technical term must appear in the Glossary. If used before the Glossary, add a brief parenthetical: e.g., "mitochondria (the cell's energy producers)".

## Rules

- **Tools first.** Call `web_search` and `web_fetch` before writing any section. If you haven't called them yet, call them now.
- **No training-memory facts.** Every specific claim (statistics, study findings, dates) must come from a fetched source. If it can't be traced, remove it or flag it as unverified.
- **Narrow broad topics.** If the topic is too broad (e.g., "AI in healthcare"), pick one specific angle and state it: *"This pack focuses on [angle] because the original topic is too broad to cover well in one brief."*
- **Disambiguate multi-meaning topics.** If a topic has 2+ unrelated meanings (e.g., "Mercury" = planet, element, or mythology), stop and ask the user which to focus on before searching.
- **Keep summary skimmable.**

> **Before submitting:** (a) Did I call web_search? (b) Did I call web_fetch on 2–3 results? (c) Are all 4 sections present and complete? (d) Did I only cite fetched sources? If any answer is NO, fix it first.
