# Gatorbots Help Desk - Retrofit Build Plan v4

## Goal

Upgrade the existing Clawdia/OpenClaw repo into a robust Gatorbots help desk without breaking the currently running bot.

This plan assumes:

- the live Clawdia Telegram bot already exists
- the repo already contains Clawdia, Arbiter, `frc_pitcrew`, `frc_codegen`, `frc_triage`, and `patternscout`
- the objective is to harden and extend, not restart from zero

## Build principles

- preserve the live bot first
- prove value in Telegram early
- add model specialization before fancy retrieval plumbing
- default to request-scoped worker runs
- log enough runtime state to debug the system later
- prefer thin working slices over architecture cosplay

## Phase 0 - Freeze and audit the live system

### Objective

Capture what is already running before changing behavior.

### Tasks

- confirm which workspace the live Telegram binding actually targets
- capture the current `openclaw.json` from the host into a private operator note
- list current enabled channels, group settings, and mention behavior
- confirm current provider keys and auth profiles
- confirm whether the host already has `gh`, Java, Gradle, and any repo mirrors
- record current behavior for 5 to 10 representative student prompts

### Deliverables

- live-system audit note
- private config inventory
- baseline behavior examples

### Exit criteria

- you can describe the current Clawdia runtime without guessing
- you know what must not break during the retrofit

## Phase 1 - Runtime hardening and failover

### Objective

Make the current bot resilient before adding more moving parts.

### Tasks

- add `agents.list` entries for Builder, Librarian, DeepDebug, and Checker
- add `bindings` so Telegram traffic is explicitly routed to Clawdia
- set `session.dmScope` to `per-channel-peer`
- configure per-role model fallbacks
- set per-agent tool policies and sandboxing
- verify approved groups and topics are configured deliberately
- add basic health probe commands for all providers

### Deliverables

- hardened `openclaw.json`
- provider and fallback map
- tool/sandbox policy sheet

### Exit criteria

- DM isolation works
- Clawdia stays the public bot
- provider failure no longer means silent collapse

## Phase 2 - Builder lane and Arbiter gate

### Objective

Bring back frontier-model specialization where students will feel it first.

### Tasks

- create `agents/builder/`
- point Builder to GPT-5.3-Codex with fallbacks
- upgrade `frc_codegen` to call Builder then Arbiter instead of doing everything inline
- upgrade Arbiter output contract with approve, revise, escalate, student difficulty, and concern tags
- define `guarded_answer` behavior when review is unavailable
- test on real FRC tasks: command draft, subsystem patch, deploy issue, sensor fix

### Deliverables

- Builder worker
- upgraded Arbiter contract
- upgraded codegen routing

### Exit criteria

- Clawdia can call Builder and get better code than the current inline draft path
- substantive code no longer ships without a real review lane

## Phase 3 - Librarian lane

### Objective

Separate docs truth from code invention.

### Tasks

- create `agents/librarian/`
- seed vendor and WPILib docs in `memory/docs/`
- route `frc_triage` and docs-heavy `frc_pitcrew` cases through Librarian
- define structured Librarian output
- test version, vendordep, and API signature questions

### Deliverables

- Librarian worker
- docs/reference output contract
- upgraded triage path

### Exit criteria

- docs and API questions no longer depend on the code drafter guessing correctly
- Clawdia can blend Librarian notes into short student-facing answers

## Phase 4 - Dossier and follow-up backbone

### Objective

Stop treating multi-stage requests like loose confetti.

### Tasks

- add request ID generation
- add machine dossier store in ignored runtime data
- add short human-readable dossier note in session for complex requests
- add follow-up linkage rules
- track per-stage timing, serving model, fallback events, and final status
- make Clawdia load parent dossiers on follow-ups

### Deliverables

- dossier schema
- dossier helper
- follow-up linkage rules

### Exit criteria

- `that didn't work` can link back to the right prior answer
- you can see which stage was slow or failed

## Phase 5 - Upgrade `frc_pitcrew`

### Objective

Turn the current routing skill into a real orchestration policy.

### Tasks

- expand intent classes
- add answer modes: direct, reviewed, escalated, guarded
- add stage-tag policy and immediate acknowledgment behavior
- default worker calls to `sessions_spawn`
- reserve `sessions_send` for deliberate persistent threads
- add `show work` behavior for verbose evidence mode

### Deliverables

- upgraded `frc_pitcrew/SKILL.md`
- routing policy table
- stage-tag rules

### Exit criteria

- routing is consistent across common FRC request types
- students get quicker feedback and clearer progress signals

## Phase 6 - PatternScout hybrid retrieval

### Objective

Keep the useful existing skill and upgrade the engine behind it.

### Tasks

- keep current `gh`-based skill front door
- add recent-query cache
- add local repo mirror search path
- prefer Gatorbots repos, then official and vendor examples
- define one stable PatternScout output contract
- add broader GitHub fallback only when local and curated lanes are weak

### Deliverables

- upgraded `patternscout` skill
- retrieval contract
- cache and local-mirror helper

### Exit criteria

- common FRC questions pull team-first evidence before draft generation
- PatternScout is no longer architecturally married to GitHub CLI alone

## Phase 7 - Checker worker and repo mirror

### Objective

Add objective validation without giving Clawdia broad shell access.

### Tasks

- create `agents/checker/`
- build repo mirror or local checkout refresh flow
- add temporary worktree per request
- allow only safe commands
- return structured build and test results to Arbiter
- mark checks as skipped when the environment is unavailable

### Deliverables

- Checker worker
- repo sync helper
- build/test result contract

### Exit criteria

- a proposed patch can be validated in a controlled environment
- Clawdia clearly distinguishes checked fixes from unchecked guidance

## Phase 8 - DeepDebug

### Objective

Add the heavyweight lane after the faster path is already solid.

### Tasks

- create `agents/deepdebug/`
- wire escalation from Arbiter and follow-up failure cases
- feed it dossier, logs, prior drafts, and retrieval evidence
- keep output disciplined: diagnosis, fix, regression checks, unknowns
- limit repeated escalations per request

### Deliverables

- DeepDebug worker
- escalation rules
- hard-case output contract

### Exit criteria

- repeated or multi-file failures stop bouncing forever between draft and review
- hard bugs get one clearly structured diagnosis path

## Phase 9 - Team-room rollout and ops telemetry

### Objective

Make the system usable for more than one student without losing observability.

### Tasks

- test approved group and topic behavior
- tune mention gating for general rooms versus dedicated help rooms
- add provider/model usage logging
- add stage latency logging
- add fallback event logging
- add simple operator runbook for outages and degraded mode

### Deliverables

- room-policy guide
- telemetry note format
- outage playbook

### Exit criteria

- the bot behaves sanely in DMs and team rooms
- you can tell what failed without forensics theater

## Phase 10 - Optional retrieval sidecars

### Objective

Add extra reach only after the core help desk works.

### Tasks

- add optional semantic index sidecar over approved sources
- add optional approved internal resolution memory
- test whether external public FRC sidecar improves edge cases or causes drift
- prune junk sources aggressively

### Deliverables

- sidecar retrieval plan
- curation rules
- quality notes

### Exit criteria

- retrieval gets smarter without drifting away from Gatorbots conventions

## Recommended implementation order

1. Phase 0 - freeze and audit
2. Phase 1 - runtime hardening and failover
3. Phase 2 - Builder and Arbiter
4. Phase 3 - Librarian
5. Phase 4 - dossier and follow-up
6. Phase 5 - `frc_pitcrew` upgrade
7. Phase 6 - PatternScout hybrid retrieval
8. Phase 7 - Checker and repo mirror
9. Phase 8 - DeepDebug
10. Phase 9 - team-room rollout and telemetry
11. Phase 10 - optional sidecars

## What not to build first

Do not start with:

- a giant all-GitHub vector crawl
- a brand-new framework outside OpenClaw
- public multi-bot theater in Telegram
- DeepDebug before Builder and Arbiter are solid
- broad shell access on the public bot

## Acceptance rubric

The retrofit is working when all of these are true:

- a student can DM Clawdia and get a coherent FRC answer
- substantive code flows through Builder and Arbiter
- follow-ups attach to prior work most of the time
- provider outages trigger failover instead of dead air
- team-first retrieval beats random internet snippets
- Clawdia clearly marks when checks ran, failed, or were skipped
- hard failures have a clean escalation path

## Final note

This project should evolve like a real competition robot:

keep the drivetrain running, add the better mechanism, then tune the sensors. Do not strip the robot to the frame in week one just because the wiring diagram looks cleaner that way.
