# Codex Implementation Brief — Clawdia Gatorbots Help Desk Retrofit

This file is the implementation source of truth for Codex.

It is intentionally **self-contained**. Do **not** rely on any external instruction like “copy verbatim from the revised plan” or “use the uploaded file from chat.” Implement directly from the requirements below.

The repo already may contain some Phase 1 runtime work. **Preserve stronger existing implementations** and merge missing behavior into them. Do not replace a working runtime core with older, weaker snippets.

---

## 0. Goal

Implement the Clawdia Gatorbots Help Desk retrofit in an existing repo with these outcomes:

- the live Telegram bot keeps working
- Clawdia remains the public identity
- internal workers exist for PatternScout, Librarian, Builder, Arbiter, Checker, and DeepDebug
- substantive FRC answers are routed through deterministic orchestration
- follow-ups attach to prior dossier state
- code answers are never presented as reviewed unless Arbiter actually reviewed them
- PatternScout and Checker are real runtime lanes, not decorative docs
- the system is observable, testable, and can degrade to `guarded_answer`

---

## 1. Rules Codex must follow

### 1.1 Preserve stronger existing code
If the repo already contains stronger logic than an instruction below, keep the stronger logic and only patch the missing requirements.

### 1.2 Do not assume file names blindly
Inspect the active import graph and runtime wiring first.

Examples of path assumptions that may be wrong:
- the active runtime file may **not** be `agents/clawdia/runtime/gatorbots_helpdesk_runtime.js`
- the active skill file may be `skill.md` or `SKILL.md`
- there may already be a `patternscout` implementation under a different path

### 1.3 Do not break live routing during early phases
Until tests pass:
- do **not** change the Telegram binding target
- do **not** change Clawdia’s primary model identifier if the repo already uses a working value
- do **not** remove old behavior until the new behavior is wired and validated

### 1.4 No invisible dependencies
Do not write code that depends on chat-uploaded files or unpublished local artifacts.
Everything needed to implement must come from this file and the repo itself.

### 1.5 Prefer merge-overwrite behavior
When replacing docs or skill files, preserve any useful repo-specific content and merge in the missing retrofit behavior.

---

## 2. Existing stronger Phase 1 behavior to preserve if already present

If the repo already contains these, keep them:

- `general_or_non_frc` resolves to `direct_answer`
- dossiers have **two layers**:
  - machine dossier state
  - human-readable dossier note
- follow-up linkage carries:
  - `parent_request_id`
  - incremented retry count
  - prior evidence carry-forward
- `sensor_or_can_fault` and other safety/hardware flows can route through Arbiter
- PatternScout is a first-class worker in execution plans
- Checker is a first-class worker in execution plans
- worker output adapters smooth over contract drift
- answer mode priority is:
  1. `guarded_answer`
  2. `escalated_answer`
  3. `reviewed_answer`
  4. `direct_answer`

Stable runtime interfaces to preserve if present:
- `createInitialDossier({ peerId, route, userMessage })`
- `quickClassify(prompt)`
- `loadLikelyParentDossier({ peerId, route, userMessage, conversationContext, intent })`
- `callWorker(worker, payload)`
- `isWorkerAvailable(worker)`
- `writeHumanDossierNote(requestId, note)`

Stable dossier fields to preserve if present:
- `request_id`
- `parent_request_id`
- `chat_id`
- `thread_or_topic_id`
- `route`
- `user_message`
- `intent`
- `answer_mode`
- `stage_status`
- `elapsed_time_ms_by_stage`
- `worker_outputs`
- `worker_trace`
- `retrieval_sources`
- `serving_model_by_stage`
- `fallback_events`
- `final_status`
- `review_state`
- `context.retry_count`
- `context.follow_up_failure`
- `context.parent_intent`
- `context.prior_evidence`
- `human_dossier_note`

---

## 3. Known problems in the older linear plan that must be corrected

Implement the spirit of the plan, but correct these flaws:

1. **Do not depend on “copy verbatim from the revised plan.”** Codex must implement directly.
2. **Do not use the weaker classifier snippet** that omits PatternScout and weakens follow-up logic.
3. **Do not leave `follow_up` as an empty stub.** Follow-up linkage and re-routing must actually work.
4. **Do not silently stop safety/hardware questions at Librarian** if the answer is safety-critical or review-worthy.
5. **Do not assume `SKILL.md` casing.** Respect whatever the repo uses.
6. **Do not reference nonexistent files in validation**, like arbitrary scripts that are not in the repo.
7. **Do not create dead code paths.** Patch the runtime entrypoint that is actually used by Clawdia.
8. **Do not treat PatternScout cache alone as full PatternScout implementation.** It also needs retrieval lanes and contract output.
9. **Do not treat Checker as just a shell script.** It needs request-time worktree lifecycle and structured results.

---

## 4. Deliverables

Codex must create or update the following categories of files.
Exact paths may be adapted to existing repo conventions, but keep the semantics.

### 4.1 Contracts and docs
- `docs/contracts/envelope.schema.json`
- `docs/contracts/answer-modes.md`
- per-worker contracts, either under `docs/contracts/` or `agents/*/CONTRACT.md`
- `docs/ops/provider-failover-map.md`
- `docs/ops/outage-playbook.md`
- `docs/ops/telemetry-format.md`
- `docs/runtime/openclaw.template.json`

### 4.2 Runtime core
- `agents/clawdia/runtime/dossier_helpers.js`
- `agents/clawdia/runtime/intent_classifier.js`
- `agents/clawdia/runtime/worker_adapters.js`
- `agents/clawdia/runtime/helpdesk_orchestrator.js`

### 4.3 Worker implementations / helper runners
- PatternScout implementation and cache helper
- Checker implementation and allowlisted runner
- any worker invocation glue required by the live runtime

### 4.4 Seeded local docs memory
- `agents/clawdia/memory/docs/INDEX.md`
- at least a few starter docs under WPILib/vendors, enough for Librarian to search locally first

### 4.5 Tests
- unit tests for classifier, dossier helpers, adapters, orchestrator
- integration/smoke tests for main routes
- tests or fixtures for PatternScout and Checker behavior where practical

### 4.6 Final patch report
At the end, Codex must produce a short summary containing:
- changed files
- key behavior changes
- validation commands run
- pass/fail results
- anything intentionally deferred

---

## 5. Shared contract requirements

### 5.1 Envelope schema
Every worker request/response must be representable via a shared envelope.

Minimum response fields:
- `request_id`
- `contract_version`
- `status` = `success` or `error`
- `kind`
- `summary`
- `warnings`
- `contract_flags`
- `telemetry_hints`
- `error` nullable object

`contract_flags` must contain:
- `reviewed`
- `escalated`
- `implementation_safe`
- `pattern_only`

### 5.2 Answer mode resolution
Final dossier answer mode must resolve with this priority:
1. `guarded_answer`
2. `escalated_answer`
3. `reviewed_answer`
4. `direct_answer`

### 5.3 Worker-specific required output fields

#### PatternScout
Must return:
- `matches`
- `retrieval_summary`
- `coverage_note`
- `retrieval_latency_ms`
- `source_tiers_used`
- `confidence`

#### Librarian
Must return at least:
- `key_apis`
- `facts`
- `sources`

#### Builder
Must return at least:
- `student_facing_explanation`
- code output (`code_blocks`, draft content, or repo patch shape depending on repo conventions)
- `facts`

Builder must **not** mark code as reviewed.

#### Checker
Must return:
- `tests`
- `overall_status`
- `worktree_path`
- `summary`
- `status`

#### Arbiter
Must return:
- `verdict` = `approve`, `revise`, or `escalate`
- `concern_list`
- revised output when verdict is `revise`

Only Arbiter may set reviewed/implementation-safe on code outputs.

#### DeepDebug
Must return:
- `diagnosis`
- `fix`
- `regression_checks`
- `unknowns`

DeepDebug may run at most once per request.

---

## 6. Runtime behavior requirements

### 6.1 Intents
Support these intents:
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

### 6.2 Base execution plans
Use these as the source of truth unless existing stronger code already does so.

- `build_deploy_error` -> `patternscout`, `librarian`, `builder`, `checker`, `arbiter`
- `api_docs_lookup` -> `patternscout`, `librarian`
- `subsystem_or_command_draft` -> `patternscout`, `librarian`, `builder`, `checker`, `arbiter`
- `autonomous_or_pathing` -> `patternscout`, `librarian`, `builder`, `checker`, `arbiter`
- `sensor_or_can_fault` -> `patternscout`, `librarian`, `arbiter`
- `vision_problem` -> `patternscout`, `librarian`, `builder`, `checker`, `arbiter`
- `explain_or_review` -> `patternscout`, `librarian`, and add `arbiter` when safety-critical or explicit review requested
- `deep_debug` -> `patternscout`, `librarian`, `deepdebug`
- `follow_up` -> dynamic logic described below
- `general_or_non_frc` -> no workers

### 6.3 Follow-up handling
This must be real, not a placeholder.

Implement:
- parent dossier lookup
- `parent_request_id`
- retry count increment
- prior evidence carry-forward
- `context.parent_intent`
- `context.follow_up_failure`

Routing rules:
- if follow-up is a failure after a reviewed or escalated answer, route toward `patternscout -> librarian -> arbiter -> deepdebug`
- otherwise, if parent intent exists and is not `follow_up`, recurse to the parent intent’s plan
- otherwise use `patternscout -> librarian`, and add `arbiter` when safety-critical or explicitly review-related

### 6.4 Safety/review hints
Implement lightweight keyword-based routing hints in addition to model classification.

Signals to detect:
- safety/hardware domain terms
- explicit review requests
- follow-up language like “that didn’t work”, “same error”, “what about the other motor”, “instead”, etc.

These hints may append Arbiter or force follow-up behavior even if the base classifier is imperfect.

### 6.5 Worker skip policy
- PatternScout and Checker may be skipped gracefully if unavailable or erroring
- Arbiter may **not** be skipped silently for substantive or review-worthy output
- if Arbiter is unavailable for a substantive reviewed-code flow, mark guarded
- if DeepDebug fails, mark guarded and return the best partial result

### 6.6 Guarded mode
Guarded mode must set dossier review state and final answer mode clearly.
The final student-facing answer must explicitly communicate uncertainty rather than pretending review happened.

---

## 7. Dossier requirements

Implement or preserve helper functions with equivalent behavior:
- `makeRequestId(now)`
- `createInitialDossier(options)`
- `noteStageStatus(dossier, stage, status)`
- `noteHumanEvent(dossier, label, status)`
- `recordWorkerOutput(dossier, worker, result)`
- `attachParentDossier(dossier, parentDossier, options)`
- `markGuarded(dossier, reason)`
- `markReviewCompleted(dossier, reviewer)`
- `markEscalated(dossier, worker)`
- `resolveAnswerMode(dossier)`
- `mergeTelemetry(dossier, stage, hints)`
- `finalizeDossier(dossier)`
- `renderHumanDossierNote(dossier)`

Minimum dossier state must include:
- stage status tracking
- review state
- telemetry
- worker outputs
- worker trace
- retrieval sources
- parent linkage
- human-readable note

Human note should summarize at least:
- request id
- intent
- workers used or skipped
- answer mode
- key review/escalation/guarded state

---

## 8. PatternScout implementation requirements

PatternScout is the retrieval front door.
It is not a public persona.

### 8.1 Retrieval lanes
Implement these retrieval lanes in order of preference:
1. local team repo mirror / approved internal sources
2. curated local docs memory
3. official examples / approved examples
4. GitHub or remote code search fallback

### 8.2 Output requirements
Return structured matches with source tier metadata.
Each match should include as much of the following as practical:
- repo or source id
- path
- symbol or anchor
- excerpt
- tier

### 8.3 Cache
Implement a TTL cache for remote search results. A 24-hour TTL is fine.
Remote cache is a performance helper, not the whole implementation.

### 8.4 Honesty and coverage
If retrieval is thin, say so in `coverage_note` and lower `confidence`.

### 8.5 Source priority
Prefer team-approved and official sources over random public snippets.

---

## 9. Checker implementation requirements

Checker is objective validation.

### 9.1 It needs more than a shell script
Implement request-time lifecycle for validation:
- locate repo mirror or source workspace
- create a temp worktree or temp copy appropriate to the repo
- materialize Builder/Arbiter output into the temp workspace
- run allowlisted validation commands
- collect structured results
- clean up temp resources when safe

### 9.2 Allowed commands
At minimum allow:
- `./gradlew build`
- `./gradlew test`
- `./gradlew spotlessCheck`
- `./gradlew check`

No arbitrary shell execution.
Document the allowlist.

### 9.3 Structured results
Return per-test results and overall status.
If the workspace or Gradle wrapper is missing, return structured `skipped` results instead of exploding.

---

## 10. Worker adapters

Implement worker adapters so the orchestrator can normalize drift between existing and retrofit-era result shapes.

At minimum, normalize:
- PatternScout outputs from older `best_fit_pattern` / `alternative_pattern` style results
- Builder outputs that may be patch text, code blocks, or single draft strings
- Arbiter outputs that may provide corrected code under different field names
- DeepDebug outputs that may use older root-cause field names

Adapters must preserve raw output for debugging.

---

## 11. Wiring into the live runtime

Codex must find the actual runtime entrypoint used by Clawdia and integrate the orchestrator there.

### 11.1 Requirements
- direct non-FRC chat still works
- substantive FRC flows use orchestrator results
- final answers reflect answer mode honestly
- Telegram or chat output includes a concise status marker where appropriate

Reasonable badge mapping:
- reviewed -> `[reviewed]`
- escalated -> `[escalated]`
- guarded -> `[⚠️ unreviewed]`

If the repo already has a better UI convention, keep it.

### 11.2 Final synthesis rules
Clawdia remains the public narrator.
She may synthesize worker results into one answer, but must not claim:
- review if Arbiter did not review
- validation if Checker did not run or failed to run
- certainty when the dossier is guarded

---

## 12. Config and ops docs

Create or update:
- provider failover map
- outage playbook
- telemetry format doc
- `openclaw.template.json`

### 12.1 Config template requirements
Document:
- providers and circuit breakers
- retry section
- agent list
- model assignments with fallback
- session scope
- policies and tool access
- Telegram binding shape

Important:
- preserve whatever model identifiers the repo actually supports
- if example model names in older plans do not match live config, prefer live supported names

---

## 13. Local docs memory

Seed local docs memory so Librarian has something useful before web/remote retrieval.

Create:
- `INDEX.md`
- at least a few starter docs for WPILib/vendors

At minimum include one meaningful vendor doc such as CTRE Phoenix 6 constructor/config notes.

Do not pretend the docs are exhaustive.
Make them clearly structured and source-aware.

---

## 14. Skills / policy docs

Update Clawdia skill docs **after** runtime wiring is stable.

Requirements to include in skill docs:
- current intent-to-worker routing table
- answer mode definitions
- stage tags or lifecycle steps
- guarded fallback behavior
- PatternScout retrieval order
- Builder/Arbiter/Checker flow for code requests

Respect repo path casing and naming conventions.

---

## 15. Tests Codex must add or update

### 15.1 Unit tests
Add tests for:
- classifier parsing valid/invalid JSON
- safety/review/follow-up hint detection
- execution plan resolution
- answer mode priority resolution
- parent dossier linkage and retry increment
- worker adapter normalization
- guarded mode behavior

### 15.2 Orchestrator tests with fake runtime
Add deterministic tests that verify:
- `general_or_non_frc` returns `direct_answer`
- `sensor_or_can_fault` can route through Arbiter
- follow-up failure after reviewed answer routes toward Arbiter and DeepDebug
- PatternScout/Checker may skip gracefully
- Arbiter unavailable on substantive flow yields guarded mode
- Arbiter `escalate` adds DeepDebug once
- Builder error yields guarded result

### 15.3 Integration / smoke tests
Create a smoke test runner that exercises representative prompts such as:
1. simple intake subsystem request
2. docs lookup
3. joke / non-FRC chat
4. deploy error
5. hard autonomous debugging question

Validate:
- answer mode is valid
- worker traces make sense
- guarded mode appears when expected

### 15.4 Checker tests
Where practical, add tests using a tiny fixture workspace so Checker can prove:
- missing path -> structured error
- missing `gradlew` -> structured skipped tests
- happy-path command execution -> structured pass/fail capture

### 15.5 PatternScout tests
Where practical, test:
- local docs hit
- fallback to remote cache helper
- coverage/confidence behavior when sources are sparse

---

## 16. Validation commands

Codex must run relevant validation commands that actually exist after implementation.
Do not reference nonexistent scripts.

At minimum run the ones applicable to the repo:

### 16.1 Syntax / format
- `node -c` on JS files created or modified
- `bash -n` on shell scripts created or modified
- `python3 -m json.tool` on JSON files created or modified

### 16.2 Tests
Run the new test suites and smoke tests.
Use the repo’s existing test runner if present; otherwise use a lightweight Node test setup or existing conventions.

### 16.3 Report results
In the final patch report, show:
- commands run
- which passed
- which failed
- whether failures are blockers or known deferred items

---

## 17. Suggested implementation order

Use this order unless the repo strongly suggests another.

1. inspect runtime wiring and existing files
2. add/update contracts and docs skeletons
3. land runtime core patches: dossier helpers, classifier, adapters, orchestrator
4. wire orchestrator into the active Clawdia runtime entrypoint
5. implement PatternScout retrieval lanes and cache helper
6. implement Checker lifecycle and allowlisted runner
7. seed local docs memory
8. update skills/policy docs
9. add telemetry doc/config template
10. add tests
11. run validation
12. produce final patch report

---

## 18. Acceptance criteria

The implementation is acceptable only when all of the following are true:

- a student can still message Clawdia and get a coherent answer
- non-FRC chat still returns `direct_answer`
- substantive code flows route through Builder and Arbiter
- follow-ups attach to prior dossier context most of the time
- PatternScout and Checker are actually callable lanes
- Arbiter is not silently skipped on review-worthy code flows
- provider or worker failures degrade to `guarded_answer`, not dead air
- worker outputs are traceable in dossier state
- smoke tests pass
- validation output is recorded in the final patch report

---

## 19. Final output format required from Codex

At the end, output a concise implementation report with these sections:

1. `Summary`
2. `Files changed`
3. `Behavior changes`
4. `Validation run`
5. `Remaining risks / deferred items`

Keep the report factual. No vague “done” claims without test evidence.

