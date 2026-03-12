# Clawdia Hertz — OpenClaw

This is my personal AI assistant project. I'm Sadie, and I'm learning coding and AI skills by building things hands-on. This whole repo is me figuring things out as I go.

**Clawdia** is my AI assistant, built on [OpenClaw](https://github.com/openclaw). She helps me learn, answers questions, and is slowly becoming the backbone of what I'm really trying to build: the most epic **FRC GatorBots help desk** ever.

## What's in here

- **Clawdia** (`agents/clawdia/`) — My primary AI agent with a growing collection of skills
- **Arbiter** (`agents/arbiter/`) — An FRC robotics coding assistant with reference docs for WPILib, PathPlanner, REV Spark, CTRE Phoenix6, and deploy checklists
- **Skills** (`agents/clawdia/skills/`) — Modular capabilities like quiz generation, essay coaching, FRC code generation, trivia, research assistance, and a self-improving skill loop

## Scripts

```bash
./scripts/codex-plan.sh docs/audits/test_task.md       # Run planning only
./scripts/codex-implement.sh docs/audits/test_task.md   # Run plan + implementation
./scripts/secret-scan.sh                                # Check for leaked secrets
```
