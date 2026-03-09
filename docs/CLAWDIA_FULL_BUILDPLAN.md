# Clawdia Hertz Full Build Plan (Continuation)

## Purpose

This is a copy-paste implementation guide to move the current repository from its present state to the target architecture in the master plan.

This plan is written for the repository at:

- `/home/openclaw/clawdia-hertz-openclaw`

Date authored:

- 2026-03-08

## What this plan includes

- Step-by-step build sequence
- File-by-file code templates
- Contracts for Builder, Librarian, Arbiter, Checker, DeepDebug
- Dossier runtime integration details
- Testing and rollout checklist

## Current baseline summary

From the current codebase:

- Dossier core exists in `agents/clawdia/runtime/gatorbots_helpdesk_runtime.js`
- `frc_pitcrew`, `frc_codegen`, `frc_triage`, `patternscout` skills exist
- `agents/builder`, `agents/librarian`, `agents/checker`, `agents/deepdebug` directories exist but are empty
- `openclaw.json` is not in repo (gitignored), so runtime hardening must be done with a tracked template + private deployed config

---

## Implementation order

1. Runtime hardening artifacts
2. Worker contracts and scaffolding
3. Builder lane + Arbiter gate
4. Librarian lane
5. Dossier integration into FRC orchestration path
6. `frc_pitcrew` policy upgrade
7. PatternScout hybrid retrieval
8. Checker lane
9. DeepDebug lane
10. Telemetry and ops rollout

---

## Step 1: Runtime hardening artifacts

### 1.1 Create tracked runtime template

Create file: `docs/runtime/openclaw.template.json`

```json
{
  "$schema": "https://example.invalid/openclaw.schema.json",
  "runtime": {
    "name": "clawdia-gatorbots",
    "environment": "production"
  },
  "session": {
    "dmScope": "per-channel-peer",
    "workerDefault": "sessions_spawn"
  },
  "providers": {
    "anthropic": {
      "enabled": true,
      "healthProbe": "anthropic.models.list"
    },
    "openai": {
      "enabled": true,
      "healthProbe": "openai.models.list"
    },
    "google": {
      "enabled": true,
      "healthProbe": "google.models.list"
    }
  },
  "models": {
    "clawdia": {
      "primary": "anthropic:claude-sonnet-4-6",
      "fallback": [
        "openai:gpt-5.3",
        "google:gemini-2.5-pro"
      ]
    },
    "builder": {
      "primary": "openai:gpt-5.3-codex",
      "fallback": [
        "anthropic:claude-sonnet-4-6"
      ]
    },
    "librarian": {
      "primary": "google:gemini-2.5-pro",
      "fallback": [
        "google:gemini-2.5-flash-lite"
      ]
    },
    "arbiter": {
      "primary": "anthropic:claude-sonnet-4-6",
      "fallback": [
        "openai:gpt-5.3"
      ]
    },
    "deepdebug": {
      "primary": "anthropic:claude-opus-4-6",
      "fallback": [
        "anthropic:claude-sonnet-4-6"
      ]
    },
    "checker": {
      "primary": "tool-first",
      "fallback": []
    }
  },
  "agents": {
    "list": [
      "clawdia",
      "builder",
      "librarian",
      "arbiter",
      "checker",
      "deepdebug"
    ]
  },
  "bindings": {
    "telegram": {
      "defaultAgent": "clawdia",
      "approvedRooms": [],
      "mentionGating": {
        "dm": "always",
        "group": "mentions-only"
      }
    }
  },
  "policies": {
    "clawdia": {
      "tools": ["sessions_spawn", "sessions_send", "patternscout"],
      "sandbox": "strict"
    },
    "builder": {
      "tools": ["codegen"],
      "sandbox": "strict"
    },
    "librarian": {
      "tools": ["web_search", "web_fetch"],
      "sandbox": "strict"
    },
    "arbiter": {
      "tools": ["review"],
      "sandbox": "strict"
    },
    "checker": {
      "tools": ["exec_allowlist"],
      "sandbox": "checked"
    },
    "deepdebug": {
      "tools": ["analysis", "sessions_spawn"],
      "sandbox": "strict"
    }
  }
}
```

### 1.2 Add ops audit note template

Create file: `docs/ops/runtime-audit.md`

```md
# Runtime Audit

## Live host
- Hostname:
- Runtime service name:
- Date audited:

## Binding and routing
- Telegram bot token identity:
- Workspace path:
- Default routed agent:
- DM scope:
- Group policy:

## Providers and auth
- Anthropic key present: yes/no
- OpenAI key present: yes/no
- Google key present: yes/no
- GitHub CLI auth: yes/no

## Health probes
- anthropic:
- openai:
- google:

## Baseline prompts (5-10)
- Prompt:
- Observed behavior:
- Risk notes:

## Non-regression guardrails
- Must not break:
- Rollback command:
```

### 1.3 Add failover map

Create file: `docs/ops/provider-failover-map.md`

```md
# Provider Failover Map

| Role | Primary | Fallback 1 | Fallback 2 | Trigger |
|---|---|---|---|---|
| Clawdia | Claude Sonnet 4.6 | GPT-5.3 | Gemini 2.5 Pro | provider timeout, 5xx, quota |
| Builder | GPT-5.3-Codex | Claude Sonnet 4.6 | - | generation failure |
| Librarian | Gemini 2.5 Pro | Gemini 2.5 Flash-Lite | - | retrieval/model error |
| Arbiter | Claude Sonnet 4.6 | GPT-5.3 | - | review timeout/error |
| DeepDebug | Claude Opus 4.6 | Claude Sonnet 4.6 | - | escalation timeout/error |
| Checker | tool-first | model optional | - | parser failure only |
```

---

## Step 2: Worker contracts and scaffolding

Create these files first so orchestration has stable contracts.

### 2.1 Builder contract

Create file: `agents/builder/CONTRACT.md`

```md
# Builder Contract

Input JSON:

```json
{
  "request_id": "req_x",
  "intent": "subsystem_or_command_draft",
  "user_message": "...",
  "constraints": [],
  "retrieval": [],
  "context": {}
}
```

Output JSON:

```json
{
  "status": "success",
  "kind": "draft",
  "summary": "Generated command-based intake subsystem draft",
  "student_facing_explanation": "...",
  "code_blocks": [
    {
      "path": "src/main/java/frc/robot/subsystems/IntakeSubsystem.java",
      "language": "java",
      "code": "..."
    }
  ],
  "facts": [],
  "warnings": [],
  "contract_flags": {
    "reviewed": false,
    "escalated": false,
    "implementation_safe": false,
    "pattern_only": false
  }
}
```
```

### 2.2 Librarian contract

Create file: `agents/librarian/CONTRACT.md`

```md
# Librarian Contract

Output JSON:

```json
{
  "status": "success",
  "kind": "docs_truth",
  "summary": "Resolved TalonFX API signature for 2026 season",
  "key_apis": [
    {
      "symbol": "TalonFX",
      "signature": "...",
      "version": "...",
      "source": "..."
    }
  ],
  "facts": [],
  "warnings": [],
  "sources": [
    {
      "title": "WPILib docs",
      "url": "https://docs.wpilib.org/..."
    }
  ],
  "contract_flags": {
    "reviewed": false,
    "escalated": false,
    "implementation_safe": true,
    "pattern_only": true
  }
}
```
```

### 2.3 Arbiter contract

Create file: `agents/arbiter/CONTRACT.md`

```md
# Arbiter Contract

Output JSON:

```json
{
  "status": "success",
  "kind": "review",
  "summary": "Revise: add motor neutral mode and current limit",
  "verdict": "revise",
  "student_difficulty": "intermediate",
  "concern_list": ["safety", "reliability"],
  "changed_after_review": [
    "Added neutral mode setup",
    "Added current limit configuration"
  ],
  "warnings": [],
  "contract_flags": {
    "reviewed": true,
    "escalated": false,
    "implementation_safe": true,
    "pattern_only": false
  }
}
```

Allowed `verdict` values:

- `approve`
- `revise`
- `escalate`
```

### 2.4 Checker contract

Create file: `agents/checker/CONTRACT.md`

```md
# Checker Contract

Output JSON:

```json
{
  "status": "success",
  "kind": "validation",
  "summary": "Build passed, tests skipped (environment missing vendordeps)",
  "tests": [
    {
      "name": "./gradlew build",
      "result": "passed"
    },
    {
      "name": "./gradlew test",
      "result": "skipped",
      "reason": "environment_unavailable"
    }
  ],
  "warnings": [],
  "contract_flags": {
    "reviewed": false,
    "escalated": false,
    "implementation_safe": true,
    "pattern_only": false
  }
}
```
```

### 2.5 DeepDebug contract

Create file: `agents/deepdebug/CONTRACT.md`

```md
# DeepDebug Contract

Output JSON:

```json
{
  "status": "success",
  "kind": "escalation",
  "summary": "Root cause isolated to scheduler lifecycle conflict",
  "diagnosis": "...",
  "fix": "...",
  "regression_checks": ["..."],
  "unknowns": ["..."],
  "contract_flags": {
    "reviewed": false,
    "escalated": true,
    "implementation_safe": true,
    "pattern_only": false
  }
}
```
```

---

## Step 3: Builder lane + Arbiter gate

### 3.1 Update `frc_codegen` to explicit Builder then Arbiter path

Replace file: `agents/clawdia/skills/frc_codegen/SKILL.md`

```md
---
name: frc_codegen
description: Generate FRC Java code through Builder, then require Arbiter review before final answer.
user-invocable: true
---

# FRC Codegen

## Worker Sessions

- Builder: `agent:builder:main`
- Librarian: `agent:librarian:main`
- Arbiter: `agent:arbiter:main`

## Policy

1. If API/version certainty is needed, call Librarian first.
2. Call Builder to produce initial code draft.
3. Send Builder output to Arbiter.
4. If Arbiter verdict is `approve`, return final code.
5. If verdict is `revise`, apply revisions then return.
6. If verdict is `escalate`, call DeepDebug and return escalated answer.
7. If Arbiter is unavailable, return `guarded_answer` with explicit uncertainty.

## Output Format

- Final code
- What changed after review
- Why it matters
- What to test next
- Answer mode (`reviewed_answer`, `escalated_answer`, or `guarded_answer`)
```

### 3.2 Add guarded answer helper in runtime

Patch file: `agents/clawdia/runtime/gatorbots_helpdesk_runtime.js`

Add this function near `resolveAnswerMode`:

```js
function resolveAnswerMode(dossier) {
  const reviewState = dossier?.review_state || {};

  if (reviewState.guarded === true) {
    return 'guarded_answer';
  }

  if (reviewState.escalation_completed === true && reviewState.escalation_worker) {
    return 'escalated_answer';
  }

  if (reviewState.review_completed === true && reviewState.reviewer) {
    return 'reviewed_answer';
  }

  return 'direct_answer';
}
```

Also expand default review state in dossier creation:

```js
review_state: {
  review_completed: false,
  reviewer: null,
  escalation_completed: false,
  escalation_worker: null,
  guarded: false
},
```

---

## Step 4: Librarian lane

### 4.1 Seed docs memory directories

Create these directories:

- `agents/clawdia/memory/docs/wpilib/`
- `agents/clawdia/memory/docs/vendors/`
- `agents/arbiter/memory/docs/wpilib/`
- `agents/arbiter/memory/docs/vendors/`

Add index file: `agents/clawdia/memory/docs/INDEX.md`

```md
# Docs Index

## WPILib
- command-based.md
- scheduler.md
- pose-estimator.md

## Vendors
- ctre-phoenix6.md
- rev-sparkmax.md
- pathplanner.md
```

### 4.2 Upgrade triage to structured docs output

Replace file: `agents/clawdia/skills/frc_triage/SKILL.md`

```md
---
name: frc_triage
description: Fast FRC error and docs triage through Librarian with structured evidence.
user-invocable: true
---

# FRC Triage

## Worker Sessions

- Librarian: `agent:librarian:main`
- Arbiter: `agent:arbiter:main` (optional for safety-critical guidance)

## Procedure

1. Send question to Librarian.
2. Require structured response with likely cause, API/version notes, and sources.
3. If robot safety or hardware behavior is impacted, send to Arbiter for review.
4. Return concise student-facing answer:
   - Most likely cause
   - Try this first
   - If that fails
   - Source confidence
```

---

## Step 5: Dossier integration into orchestration path

### 5.1 Add orchestrator helper

Create file: `agents/clawdia/runtime/helpdesk_orchestrator.js`

```js
'use strict';

const runtime = require('./gatorbots_helpdesk_runtime');

function beginRequest({ peerId, route, userMessage }) {
  const dossier = runtime.createInitialDossier({ peerId, route, userMessage });
  runtime.saveDossier(dossier);
  return dossier;
}

function appendWorker(dossier, worker, kind, raw) {
  const normalized = runtime.normalizeWorkerResult({
    worker,
    request_id: dossier.request_id,
    defaultKind: kind,
    raw
  });
  runtime.recordWorkerResult(dossier, normalized);
  runtime.saveDossier(dossier);
  return dossier;
}

function markGuarded(dossier, reason) {
  if (!dossier.review_state) {
    dossier.review_state = {};
  }
  dossier.review_state.guarded = true;
  if (!dossier.context) {
    dossier.context = { constraints: [], assumptions: [], notes: [] };
  }
  dossier.context.notes = Array.isArray(dossier.context.notes) ? dossier.context.notes : [];
  dossier.context.notes.push(`guarded: ${reason}`);
  runtime.saveDossier(dossier);
  return dossier;
}

module.exports = {
  beginRequest,
  appendWorker,
  markGuarded
};
```

### 5.2 Add stage telemetry fields to dossier

Patch `createInitialDossier` in `gatorbots_helpdesk_runtime.js`:

```js
telemetry: {
  stage_timings_ms: {},
  serving_model_by_stage: {},
  fallback_events: [],
  final_status: 'in_progress'
},
```

Patch `recordWorkerResult` to optionally capture timing/model from `result.raw`:

```js
if (!dossier.telemetry || typeof dossier.telemetry !== 'object') {
  dossier.telemetry = {
    stage_timings_ms: {},
    serving_model_by_stage: {},
    fallback_events: [],
    final_status: 'in_progress'
  };
}

if (result.raw && typeof result.raw === 'object') {
  if (typeof result.raw.stage_timing_ms === 'number') {
    dossier.telemetry.stage_timings_ms[result.kind] = result.raw.stage_timing_ms;
  }
  if (typeof result.raw.serving_model === 'string' && result.raw.serving_model) {
    dossier.telemetry.serving_model_by_stage[result.kind] = result.raw.serving_model;
  }
  if (result.raw.fallback_event) {
    dossier.telemetry.fallback_events.push(result.raw.fallback_event);
  }
}
```

---

## Step 6: `frc_pitcrew` policy upgrade

Replace file: `agents/clawdia/skills/frc_pitcrew/SKILL.md`

```md
---
name: frc_pitcrew
description: Main Gatorbots orchestration policy for FRC help desk.
user-invocable: true
---

# FRC PitCrew

## Intent Classes

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

## Answer Modes

- `direct_answer`
- `reviewed_answer`
- `escalated_answer`
- `guarded_answer`

## Worker Policy

- Default worker call style: `sessions_spawn`
- Use `sessions_send` only for deliberate persistent thread continuity

## Routing

1. Create/load dossier and classify intent.
2. `api_docs_lookup` and docs-heavy triage: Librarian first.
3. Code drafting: Builder then Arbiter.
4. Repeated failures/contradictions: DeepDebug.
5. Run Checker when executable validation is feasible.
6. Synthesize one student-facing response with explicit answer mode.

## Stage Tags

- `intake`
- `retrieve`
- `draft`
- `review`
- `check`
- `escalate`
- `finalize`

## Show Work Mode

If user asks for evidence or "show work", include:

- source list
- contract verdicts
- what changed after review
- what was checked vs skipped
```

---

## Step 7: PatternScout hybrid retrieval

### 7.1 Replace `patternscout` policy with hybrid lanes

Replace file: `agents/clawdia/skills/patternscout/SKILL.md`

```md
---
name: patternscout
description: Hybrid team-first retrieval for FRC patterns (local mirror + curated + GitHub fallback).
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["gh","rg"]}}}
---

# PatternScout

## Retrieval order

1. Local mirror lane (team repos first)
2. Curated docs lane (WPILib/vendor)
3. GitHub search lane (fallback only)

## Output contract

Return:

- best_fit_pattern
- alternative_pattern
- recommendation
- confidence
- sources

## Rules

- Prefer Gatorbots repos first.
- Prefer official/vendordep examples next.
- Use broad GitHub only if local+curated are weak.
- Keep output concise and actionable.
```

### 7.2 Add local cache helper

Create file: `scripts/patternscout-cache.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

CACHE_DIR="tmp/patternscout-cache"
mkdir -p "$CACHE_DIR"

QUERY="${1:-}"
if [ -z "$QUERY" ]; then
  echo "Usage: patternscout-cache.sh <query>"
  exit 1
fi

KEY="$(printf '%s' "$QUERY" | sha1sum | awk '{print $1}')"
FILE="$CACHE_DIR/$KEY.json"

if [ -f "$FILE" ]; then
  cat "$FILE"
  exit 0
fi

gh search code "$QUERY" --language Java --limit 20 --json path,repository,url > "$FILE"
cat "$FILE"
```

---

## Step 8: Checker lane

### 8.1 Create checker allowlist runner

Create file: `agents/checker/run-checks.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

WORKTREE_DIR="${1:-}"
if [ -z "$WORKTREE_DIR" ]; then
  echo '{"status":"error","summary":"missing worktree path"}'
  exit 1
fi

if [ ! -d "$WORKTREE_DIR" ]; then
  echo '{"status":"error","summary":"worktree does not exist"}'
  exit 1
fi

cd "$WORKTREE_DIR"

RESULT='{"status":"success","kind":"validation","tests":[]}'

if [ -x ./gradlew ]; then
  if ./gradlew build; then
    BUILD_RESULT='{"name":"./gradlew build","result":"passed"}'
  else
    BUILD_RESULT='{"name":"./gradlew build","result":"failed"}'
  fi
else
  BUILD_RESULT='{"name":"./gradlew build","result":"skipped","reason":"gradlew_missing"}'
fi

printf '{"status":"success","kind":"validation","summary":"checker run complete","tests":[%s]}
' "$BUILD_RESULT"
```

### 8.2 Add checker command allowlist doc

Create file: `agents/checker/ALLOWLIST.md`

```md
# Checker Allowlist

Allowed commands:

- `./gradlew build`
- `./gradlew test`
- `./gradlew spotlessCheck`
- `./gradlew check`

Disallowed:

- destructive git history edits
- package manager installs without operator approval
- external network writes
```

---

## Step 9: DeepDebug lane

### 9.1 Add escalation policy doc

Create file: `agents/deepdebug/ESCALATION.md`

```md
# DeepDebug Escalation Policy

Escalate when any is true:

- Arbiter verdict is `escalate`
- same request thread fails 2 or more times
- multi-file contradiction remains unresolved

DeepDebug response must include:

- diagnosis
- probable root cause
- fix plan
- regression checks
- unknowns
```

### 9.2 Add escalation limiter helper

Create file: `agents/clawdia/runtime/escalation_limit.js`

```js
'use strict';

function shouldEscalate(dossier, maxEscalations = 1) {
  const trace = Array.isArray(dossier?.worker_trace) ? dossier.worker_trace : [];
  const count = trace.filter((x) => x.worker === 'deepdebug').length;
  return count < maxEscalations;
}

module.exports = {
  shouldEscalate
};
```

---

## Step 10: Telemetry and ops rollout

### 10.1 Add operator runbook

Create file: `docs/ops/outage-playbook.md`

```md
# Outage Playbook

## Symptoms
- provider timeouts
- empty worker responses
- repeated escalation loops

## Immediate actions
1. Switch to fallback provider by role.
2. Force `guarded_answer` mode for safety-critical requests.
3. Disable Checker stage if environment unavailable.
4. Capture dossier IDs and affected request IDs.

## Recovery verification
- run 5 baseline prompts
- confirm answer mode is marked correctly
- confirm fallback events are logged
```

### 10.2 Add telemetry log format

Create file: `docs/ops/telemetry-format.md`

```md
# Telemetry Format

Required fields per request:

- request_id
- session_id
- route
- answer_mode
- stage_timings_ms
- serving_model_by_stage
- fallback_events
- final_status
```

---

## Required fixes to existing files

### Fix `scripts/codex-plan.sh` duplicate content

Replace `scripts/codex-plan.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK="${1:-}"

if [ -z "$TASK" ]; then
  echo "Usage: codex-plan.sh <taskfile>"
  exit 1
fi

if [ ! -f "$TASK" ]; then
  echo "Error: task file not found: $TASK"
  exit 1
fi

PROMPT="Read CODEX_RULES.md and $TASK.

Analyze the repository.

Do NOT modify any files.

Return:
- findings
- implementation plan
- files that would change
"

codex exec "$PROMPT"
```

---

## Validation checklist

Run after implementation:

```bash
node scripts/tests/test-codex-implement-semantic.js
bash -n scripts/codex-plan.sh
bash -n scripts/codex-implement.sh
```

If checker is wired:

```bash
bash agents/checker/run-checks.sh /path/to/worktree
```

Manual acceptance tests:

1. Codegen request returns `reviewed_answer` when Arbiter is healthy.
2. Codegen request returns `guarded_answer` when Arbiter is unavailable.
3. Follow-up message links to parent dossier.
4. Docs lookup question routes through Librarian and includes sources.
5. Repeated failure triggers one DeepDebug escalation.
6. Response clearly marks checked vs skipped validation.

---

## Rollout plan

1. Deploy runtime config changes in staging.
2. Run baseline prompt pack.
3. Enable Builder+Arbiter lane in production.
4. Enable Librarian lane.
5. Enable Checker for safe allowlisted checks.
6. Enable DeepDebug escalation.
7. Enable group-room routing and telemetry.

Rollback:

- keep Clawdia public identity unchanged
- disable worker lanes one at a time
- revert to direct answer path + guarded mode

---

## Definition of done

The build plan is complete when:

- one public Clawdia handles DMs and approved rooms
- substantive code is generated by Builder and reviewed by Arbiter
- docs/API truth is routed through Librarian
- follow-ups reliably attach to prior dossier context
- checks are marked as passed/failed/skipped
- hard cases escalate once to DeepDebug with structured output
- provider/model fallback events are visible in telemetry

