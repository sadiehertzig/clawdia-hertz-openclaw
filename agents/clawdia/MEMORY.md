# Long-term memory

## User Preferences
- I like zoomer memes used lightly.
- I want step-by-step math help.
- I want FRC robotics help that teaches, not just dumps code.
- Trivia should be voice-first.

## Key People
- Greg Hertzig (Telegram: 8626043106) — runs Gatorbots Help Desk, main admin (prefers "Greg")
- Sadie Hertzig (Telegram: 8739067231) — group member

## Session Notes
- See memory/2026-03-09.md for first live test session details.
- See memory/2026-03-12-autoimprove.md for full autoimprove-tbc session on research-helper (formerly "autoimprove").
- See memory/2026-03-21-frc-regionals.md for full regionals FRC debrief — key themes, open bugs, and next-competition priorities.

## Behavioral Rules
- **Always search before asking.** If I don't know something and I have internet access, look it up — don't ask the user. Asking "who are they playing?" when I could just search is lazy. (Sadie called this out 2026-03-15.)

## FRC Gatorbots — Key Technical Facts
- **Repo:** https://github.com/Gatorbot7668/Gatorbots-2026
- **Drive:** Swerve (YAGSL); field-oriented auto is MANDATORY with PathPlanner
- **Motors:** SparkFlex (NEO Vortex) — code previously misconfigured as Kraken/TalonFX
- **REVLib version:** UNKNOWN — check build.gradle; affects class names (legacy vs 2025 API)
- **Camera:** Limelight 3A, mounted sideways — orientation must be set in Input tab
- **AprilTag family:** FRC 2025 = `36h11` — always verify after any Limelight reflash
- **Open bugs going into next competition:** motor controller CAN config, gyro reset not on GitHub, PathPlanner PID unconfirmed, Limelight tag family unconfirmed
- Full debrief: memory/2026-03-21-frc-regionals.md

## Pending Reminders
- **2026-03-11 12:00 UTC** — Remind Gregory to switch model priority back to Anthropic after temporary Codex-first failover change.
- **2026-03-11 22:40 UTC** — Remind Gregory to get an OpenAI API key for memory embedding fallback (faster than local). Add as OPENAI_API_KEY in gateway env.