# Clawdia Master Plan

## Executive summary

This is a retrofit of the existing Clawdia/OpenClaw system, not a rebuild.

The architecture target is:

- one public Clawdia
- OpenClaw-native orchestration
- internal specialists for drafting, docs truth, review, checking, and hard debug
- explicit model specialization
- explicit failover
- request-scoped worker runs as the target end state
- structured runtime state through dossiers

## Locked decisions

### 1. Public surface
Clawdia is the only public Telegram identity.

Students should see one assistant, not a puppet show of visible worker bots.

### 2. Runtime owner
OpenClaw remains the runtime.
Use OpenClaw for:

- workspaces
- bindings
- session isolation
- spawned worker runs
- model and provider failover
- group and channel policy

Do not build a parallel runtime framework.

### 3. Repo philosophy
Preserve the live bot first.
Do not break the current system just to make the repo prettier.

### 4. Retrieval philosophy
Retrieval before invention.

If the problem touches team code, vendor APIs, or known FRC patterns, gather evidence before drafting.

### 5. Review philosophy
Review before ship.

Any answer that could materially affect robot behavior, build behavior, or hardware interaction must go through Arbiter or its fallback review chain.

### 6. Session philosophy
Request isolation beats transcript soup.

The long-term default is request-scoped `sessions_spawn`.
Persistent worker sessions should exist only when continuity is deliberate.

### 7. State philosophy
Machine state and human state are different.

Keep:

- a structured machine dossier
- a short human-readable breadcrumb note

Do not force one transcript to do both jobs.

### 8. Failure philosophy
Fail soft, not dumb.

If a worker or provider fails, the system should degrade gracefully instead of pretending success.

## Target architecture

```text
Telegram DM / approved Gatorbots room
                  |
                  v
           Clawdia (public)
     narrator + router + final synthesis
                  |
   +--------------+-------------+-------------+
   |              |             |             |
   v              v             v             v
PatternScout   Librarian      Builder      Checker
(skill/helper) (worker)       (worker)     (worker)
   |              |             |             |
   +--------------+-------------+-------------+
                  |
                  v
               Arbiter
        review / revise / escalate
                  |
                  v
              DeepDebug
             hard escalations
                  |
                  v
       Clawdia final student response
```

## Role map

### Clawdia
Public narrator, router, and final synthesizer.

Clawdia should:

- classify requests
- detect follow-ups
- create or load the dossier
- decide answer mode
- call retrieval and workers
- return one polished answer

Clawdia should not:

- hold broad `exec`
- be the default substantive code drafter once Builder exists
- dump worker chatter into Telegram
- pretend review happened when it did not

### Builder
Dedicated implementation worker.

Builder should:

- write diffs, snippets, patches, or stepwise implementation plans
- prefer the smallest useful change
- specify insertion points
- consume retrieval and docs evidence
- hand substantive output to Arbiter

### Librarian
Dedicated docs and API truth worker.

Librarian should:

- resolve API signatures
- answer vendordep and version questions
- handle deprecation and migration questions
- fetch official examples and docs
- resolve contradictions in reference-heavy cases

### Arbiter
Review gate.

Arbiter should:

- approve, revise, or escalate
- adjust explanation depth for student level
- interpret Checker output
- block unsafe or weak substantive guidance

### Checker
Sandboxed validation worker.

Checker should:

- refresh repo mirror or worktree
- run allowlisted validation commands
- return structured results
- never talk to Telegram directly

### DeepDebug
Hard-case lane.

DeepDebug should:

- do multi-file root-cause analysis
- handle repeated failures
- settle contradictions that Arbiter cannot resolve confidently
- return disciplined diagnosis and regression guidance

### PatternScout
Retrieval front door.

PatternScout should:

- remain the front door skill
- support multiple retrieval lanes behind one contract
- prefer team repos and official sources first

## Model strategy

## Current recommendation

### Phase 1
Preserve the current live public model if changing it would create behavior regression.

### Target steady state after Builder exists
- Clawdia: Claude Sonnet 4.6
- Builder: GPT-5.3-Codex
- Librarian: Gemini 2.5 Flash-Lite or Gemini 2.5 Pro
- Arbiter: Claude Sonnet 4.6
- DeepDebug: Claude Opus 4.6
- Checker: tool-first, model optional
- PatternScout: tool-first contract, model optional for summarization

### Why
- Codex belongs in the workshop
- Sonnet belongs at the front desk and review gate
- Gemini belongs in the library
- Opus belongs in the emergency room

## Clawdia model decision

Keep Clawdia on the current live model during runtime hardening if needed for stability.

Flip Clawdia to Sonnet when both of these are true:

1. Builder exists as a real worker
2. Clawdia no longer owns the primary substantive code drafting path

## Answer modes

- `direct_answer`
- `reviewed_answer`
- `escalated_answer`
- `guarded_answer`

## Intent classes

- `build_deploy_error`
- `api_docs_lookup`
- `subsystem_or_command_draft`
- `autonomous_or_pathing`
- `sensor_or_can_fault`
- `vision_problem`
- `explain_or_review`
- `deep_debug`
- `follow_up`
- `general_or_non_frc`

## Project boundaries

### Runtime project owns
- `openclaw.json`
- bindings
- session policy
- tool policy
- model and provider failover
- Telegram room/topic policy

### Builder project owns
- `agents/builder/`
- `frc_codegen`
- code routing policy

### Librarian project owns
- `agents/librarian/`
- docs/reference memory
- docs-heavy routing

### Dossier project owns
- request IDs
- machine dossier
- human dossier note
- follow-up linkage

### PitCrew project owns
- orchestration policy
- answer modes
- worker call style
- stage tags

### PatternScout project owns
- retrieval contract
- local mirror path
- cache
- source ranking

### Checker project owns
- `agents/checker/`
- repo mirror/worktree flow
- allowlisted validation commands
- result contract

### DeepDebug and Ops project owns
- `agents/deepdebug/`
- escalation rules
- telemetry
- runbooks
- room rollout

## Recommended implementation order

1. Runtime hardening
2. Builder and Arbiter
3. Librarian
4. Dossier and follow-up
5. `frc_pitcrew` orchestration
6. PatternScout hybrid retrieval
7. Checker
8. DeepDebug and ops

## What not to build first

- giant all-GitHub vector crawl
- new framework outside OpenClaw
- public multi-bot theater
- DeepDebug before Builder and Arbiter are solid
- broad shell access on the public bot

## Acceptance rubric

The migration is working when:

- students can DM one Clawdia and get coherent answers
- substantive code flows through Builder and Arbiter
- docs/API questions stop depending on code-drafter guessing
- follow-ups attach to prior work
- provider outages trigger failover instead of silence
- team-first retrieval beats random internet snippets
- checks are clearly marked as run, failed, or skipped
- hard failures have one clean escalation path
