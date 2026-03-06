---
name: repo_brain
description: Explain Clawdia's repository structure, locate functionality, trace agent/skill wiring, and diagnose config issues.
user-invocable: true
---

# Repo Brain

## Purpose

Help Clawdia understand and explain how this repository is organized and how parts connect.

## When To Use

Use for:
- "Explain this repo architecture."
- "Where does this behavior live?"
- "How do agents and skills connect?"
- "Why is this config not being picked up?"

## Repository Exploration Workflow

1. Start with top-level orientation:
    - Read `README.md`, `AGENTS.md`, and relevant rules files.
    - List top-level folders to identify boundaries (`agents/`, `docs/`, `scripts/`, `memory/`).

2. Map where functionality lives:
    - Use fast file discovery (`rg --files`, `find`) to locate likely files.
    - Prefer primary implementation files and adjacent docs over broad scans.

3. Trace agent and skill connections:
    - Inspect agent-level instruction files (`AGENTS.md`, agent config, memory files).
    - Inspect skill metadata and `SKILL.md` files to understand triggers and capability boundaries.
    - Follow references from docs to concrete files.

4. Debug configuration issues:
    - Verify file paths, naming, and placement conventions.
    - Compare expected vs actual structure.
    - Identify likely mismatch points (wrong directory, missing frontmatter fields, stale docs, conflicting rules).

5. Return a concrete explanation:
    - Current architecture summary
    - Exact file paths involved
    - Connection flow (what calls/uses what)
    - Minimal fix recommendation if something is broken

## Output Style

- Be explicit about file paths.
- Separate confirmed facts from inference.
- Keep recommendations minimal and safe.
