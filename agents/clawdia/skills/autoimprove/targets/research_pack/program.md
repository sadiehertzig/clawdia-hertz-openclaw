# AutoImprove Program — research_pack

target_skill: research_pack
skill_path: ../../research-helper/SKILL.md
mode: tool_simulation
audience: high school students
expertise_level: beginner
style_notes: clear explanation with concrete examples

priorities:
  - Define "high-quality sources" with explicit criteria (peer-reviewed, textbooks, .gov/.edu — no random blogs)
  - Add reading-level guidance so explanations target a high school audience
  - Specify minimum depth per output section so results are consistent

constraints:
  - Never fabricate or assume sources — only cite what was actually retrieved
  - Double-check all sources before including them

safety_rules:
  - No made-up sources
  - No jargon without a plain-English definition

grading_tier: tiered
max_iterations: 15
token_budget: 12000000

audit: true
audit_artifacts:
  - test_bank_original.json
  - interim_scores.tsv
  - verdicts/
