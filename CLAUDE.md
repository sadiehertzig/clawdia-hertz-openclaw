# Clawdia Hertz — OpenClaw Project

## Project Structure

clawdia-hertz-openclaw/
agents/
arbiter/          — FRC robotics coding assistant
AGENTS.md, HEARTBEAT.md, IDENTITY.md, SOUL.md, TOOLS.md, USER.md
memory/docs/    — FRC reference docs (phoenix6, pathplanner, rev-spark, wpilib, deploy checklist)
clawdia/          — Primary agent
AGENTS.md, HEARTBEAT.md, IDENTITY.md, MEMORY.md, SOUL.md, TOOLS.md, USER.md
memory/docs/    — FRC reference docs
skills/         — ALL SKILLS LIVE HERE
essay-polish/
frc-codegen/
frc-pitcrew/
frc-triage/
patternscout/
quiz-me/
academic-deep-research/
voice-trivia/
AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md (root-level configs)
CLAUDE.md           — This file

## Agents

Current agent directories:
- arbiter
- builder
- checker
- clawdia
- deepdebug
- librarian

Clawdia is the primary agent. Her skills are in `agents/clawdia/skills/`.

## Workspace Canonical Path

- Canonical workspace: `/home/openclaw/clawdia-hertz-openclaw`
- Legacy ubuntu workspace path is retired and must not be used in active configs/scripts.
- Ubuntu copy is rollback archive only for 7 days:
  - `/home/ubuntu/archive/clawdia-hertz-openclaw-20260319-154316`
- Guardrail: run `scripts/check-no-legacy-ubuntu-path.sh` before shipping path-related changes.

## Skills

Each skill is a folder inside agents/clawdia/skills/ containing a SKILL.md (and optionally a README.md).

Skills follow the OpenClaw/AgentSkills format:

- YAML frontmatter with name, description, and optional homepage and metadata
- Markdown body with instructions the agent follows
- Pure prompt-instruction skills preferred — no executable code unless necessary

### Existing Skills

Most skills live as real directories in `agents/clawdia/skills/`.

`copylobsta` is the exception:
- Source of truth lives in `/home/openclaw/copylobsta/agents/main/skills/copylobsta`
- `agents/clawdia/skills/copylobsta` is a symlink into that repo
- Do not copy the files back into this repo or point the deploy repo at this workspace again
- Any fresh-instance/bootstrap change needed by CopyLobsta must land in the `copylobsta` repo first
- Verify the link locally with `scripts/check-copylobsta-source-of-truth.sh`

- academic-deep-research
- agent-browser
- api-spend-tracker
- autoimprove
- autoimprove-tbc
- code-tutor
- college-essay
- copylobsta
- creative-writing
- essay-polish
- frc-codegen
- frc-pitcrew
- frc-triage
- frontend-design
- github
- nano-banana-pro
- nano-pdf
- notes-quiz
- openai-whisper
- patternscout
- quiz-me
- repo_brain
- research-paper-writer
- resume-builder
- self-improving
- self-improving-agent
- study-habits
- summarize
- three-body-council
- voice-trivia

### Installing Community Skills from ClawHub

cd ~/clawdia-hertz-openclaw/agents/clawdia/skills
npx clawhub@latest install author/skill-slug –workdir .

### Creating Custom Skills

1. Create a folder in agents/clawdia/skills/
1. Add a SKILL.md with YAML frontmatter and instructions
1. Optionally add a README.md for human-facing documentation
1. Restart OpenClaw to pick up the new skill

### Publishing to ClawHub

cd agents/clawdia/skills/skill-name
npx clawhub@latest login
npx clawhub@latest publish . –slug skill-name –name “Display Name” –version X.Y.Z –tags latest –changelog “Description”

## Safety Rules

The college-essay skill (when installed) has strict refusal logic. When editing:

- NEVER weaken the Non-Negotiables or Disallowed Help sections
- NEVER add capabilities that generate submission-ready essay text
- The coaching-only boundary must be maintained

## Do Not Commit

- memory/ directories contain conversation history — keep in .gitignore
- .openclaw/workspace-state.json — local state file
- API keys, tokens, or secrets of any kind

## After Making Changes

1. Restart OpenClaw: systemctl --user restart openclaw-gateway
1. Push to GitHub: git add . && git commit -m “description” && git push origin main
1. If updating a ClawHub-published skill, bump the version and republish
