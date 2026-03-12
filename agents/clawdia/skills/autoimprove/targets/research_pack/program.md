# AutoImprove Program — research_pack

target_skill: research_pack
skill_path: /home/openclaw/clawdia-hertz-openclaw/agents/clawdia/skills/research_pack/SKILL.md
mode: tool_simulation
audience: high school students
expertise_level: beginner
style_notes: clear explanation with concrete examples

priorities:
  - Simplify explanations of technical topics to a high school reading level
  - Prioritize academic and research paper sources (Scholar, PubMed, arXiv)
  - Eliminate jargon or immediately define it in plain English

constraints:
  - Answers must be specific and actionable, not vague or generic

safety_rules:
  - No jargon without a plain-English definition
  - No fake or low-quality sources

grading_tier: tiered
max_iterations: 15
token_budget: 1000000

audit: true
audit_artifacts:
  - test_bank_original.json
  - interim_scores.tsv
  - verdicts/
