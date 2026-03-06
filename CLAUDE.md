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
essay_polish/
frc_codegen/
frc_pitcrew/
frc_triage/
patternscout/
quiz_me/
research_pack/
trivia_voice/
AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md (root-level configs)
CLAUDE.md           — This file

## Agents

Clawdia is the primary agent. Her skills are in agents/clawdia/skills/.
Arbiter is the FRC robotics coding assistant with reference docs for WPILib, PathPlanner, REV Spark, CTRE Phoenix6, and deploy checklists.

## Skills

Each skill is a folder inside agents/clawdia/skills/ containing a SKILL.md (and optionally a README.md).

Skills follow the OpenClaw/AgentSkills format:

- YAML frontmatter with name, description, and optional homepage and metadata
- Markdown body with instructions the agent follows
- Pure prompt-instruction skills preferred — no executable code unless necessary

### Existing Skills

- essay_polish — Essay polishing/editing
- frc_codegen — FRC robotics code generation
- frc_pitcrew — FRC pit crew support
- frc_triage — FRC troubleshooting/triage
- patternscout — Pattern analysis
- quiz_me — Quiz generation
- research_pack — Research assistance
- trivia_voice — Voice trivia game

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

The college-app-essay-coach skill (when installed) has strict refusal logic. When editing:

- NEVER weaken the Non-Negotiables or Disallowed Help sections
- NEVER add capabilities that generate submission-ready essay text
- The coaching-only boundary must be maintained

## Do Not Commit

- memory/ directories contain conversation history — keep in .gitignore
- .openclaw/workspace-state.json — local state file
- API keys, tokens, or secrets of any kind

## After Making Changes

1. Restart OpenClaw: sudo systemctl restart openclaw (or pm2 restart openclaw)
1. Push to GitHub: git add . && git commit -m “description” && git push origin main
1. If updating a ClawHub-published skill, bump the version and republish
