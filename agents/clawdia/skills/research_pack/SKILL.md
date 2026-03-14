---
name: research_pack
description: Build a compact research brief with sources.
user-invocable: true
---

# Research Pack

## Procedure

## Procedure

> **STOP — read before writing a single word of output.**
> You MUST complete Steps 1 and 2 before producing any section text. If you have not yet called `web_search` and `web_fetch`, do that now.

1. **Call `web_search`** for 5–10 results. Do NOT write any output before this step.
2. **Call `web_fetch`** on the top 2–3 results from Step 1.
3. **Narrow broad topics.** If the topic could fill a textbook (e.g., "AI in healthcare," "World War I," "string theory"), choose ONE specific angle before searching, and open your output with: *"This pack focuses on [angle] because the original topic is too broad to cover well in one brief."*
4. **Write all four sections — in order — without stopping early.**

### Completion guarantee (anti-truncation rule)

You must deliver **all four sections** every time, no exceptions:

- `## Key Takeaways` — 5–8 numbered points
- `## Glossary` — every technical term used, fully defined
- `## Source List` — 2–5 fetched sources with title, URL, and one-sentence description
- `## Follow-Up Questions` — exactly 3

**If you feel you are running long**, compress each item to one sentence — but NEVER omit a section or leave a section half-finished. A one-sentence Glossary entry is better than a missing Glossary. A three-item Source List is better than no Source List.

**Before writing your final word**, run this checklist silently:
- [ ] Did I call `web_search`?
- [ ] Did I call `web_fetch` on 2–3 results?
- [ ] Are all 4 section headers present and complete?
- [ ] Did I only cite sources I actually fetched?
- [ ] Is every technical term in the Glossary?

If any box is unchecked, fix it before responding.

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

## Broad-Topic Narrowing Table and Mandatory Skeleton

When the user submits one of these broad topics, automatically adopt the paired narrow angle before searching:

- AI in healthcare -> AI-assisted diagnostic imaging (detecting cancer in scans)
- String theory -> Why string theory predicts extra dimensions and how physicists test for them
- Social media and student learning -> How short-form video affects high-school students reading attention spans
- CRISPR risks and benefits -> CRISPR-Cas9 in treating sickle-cell disease as the primary case study
- Cold fusion -> The 1989 Pons-Fleischmann experiment and why mainstream physics rejected cold fusion
- World War I -> Trench warfare and the military stalemate on the Western Front
- Climate change -> How rising ocean temperatures increase Atlantic hurricane intensity

For any broad topic not listed, pick the most concrete researchable sub-angle, state it at the top of your output, then proceed.

### Mandatory four-section skeleton

Before writing your final word, confirm every slot below is filled. Do not stop mid-section.

Section 1: Key Takeaways with 5 to 8 numbered points.
Section 2: Glossary with one entry per technical term used anywhere in the pack.
Section 3: Source List with 2 to 5 entries, only sources actually fetched via web_fetch, each with title, URL, and one sentence.
Section 4: Follow-Up Questions with exactly 3 questions on different aspects.

Hard stop: If you have not yet written all four section headers with content under each, you are not finished. Write the missing sections now before sending your response.
