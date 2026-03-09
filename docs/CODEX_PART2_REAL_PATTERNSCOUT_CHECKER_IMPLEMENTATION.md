# Codex Brief — Part 2: Real PatternScout + Checker Implementation

This file is the **single source of truth** for Part 2.

Codex should use this document to implement the real `patternscout` and `checker` workers in the live Clawdia repo. Do **not** depend on any uploaded chat files, “copy verbatim” instructions, or undocumented local snippets. Patch the repo that exists on disk.

The repo may already contain stronger Phase 1 runtime work. **Preserve stronger existing behavior** and merge these requirements into the active runtime entrypoint instead of replacing working code with weaker boilerplate.

---

## 0. Goal

Implement the **real retrieval and validation lanes** behind the existing Phase 1 orchestration:

- `patternscout` becomes a real hybrid retrieval worker with local mirrors, local docs memory, and optional GitHub fallback
- `checker` becomes a real validation worker with repo discovery, mirror refresh/reuse, temp worktree lifecycle, safe patch application, allowlisted commands, and structured results
- Clawdia’s orchestration continues using the Phase 1 interfaces and answer-mode rules
- tests prove the control plane and the new worker implementations behave correctly
- the rollout remains safe for the live bot

---

## 1. Hard rules

### 1.1 Preserve Phase 1 runtime interfaces if they already exist
Keep these stable if present:

- `createInitialDossier({ peerId, route, userMessage })`
- `quickClassify(prompt)`
- `loadLikelyParentDossier({ peerId, route, userMessage, conversationContext, intent })`
- `callWorker(worker, payload)`
- `isWorkerAvailable(worker)`
- `writeHumanDossierNote(requestId, note)`

### 1.2 Preserve these dossier fields if present
Do not break or rename:

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

### 1.3 Do not patch dead code
Before editing anything, inspect the actual import graph and patch the worker-routing code path Clawdia really uses. Do **not** assume a path just because it appeared in a planning document.

### 1.4 Keep file casing correct
If the repo uses `skill.md`, do not create `SKILL.md`. If the repo uses `patternscout.js`, do not create a second near-duplicate with different casing. No accidental Linux goblins.

### 1.5 No unsafe shelling
All subprocesses must use `spawn`/`execFile`/equivalent argument arrays. No interpolated shell strings containing user text.

### 1.6 No silent capability inflation
Do not mark code as reviewed, safe, or implementation-ready unless Arbiter actually reviewed it. Builder and Checker cannot set `reviewed: true` on final user-facing code.

---

## 2. Scope of this phase

This phase must cover:

1. real PatternScout implementation
2. real Checker implementation
3. runtime glue so `callWorker('patternscout', ...)` and `callWorker('checker', ...)` invoke the new code
4. config additions needed to run both workers
5. tests for both workers and their integration with the Phase 1 orchestrator
6. a short patch report at the end

This phase does **not** need to finish:

- Telegram trusted-room/topic policy
- provider circuit-breaker expansion beyond what the repo already has
- full Arbiter/Builder prompt rewrites
- full production telemetry backend
- broad docs seeding beyond enough data to exercise local retrieval

---

## 3. Existing behavior that must remain true

Keep these behaviors if Phase 1 already implemented them:

- `general_or_non_frc` resolves to `direct_answer`
- dossiers have two layers:
  - machine dossier
  - human-readable dossier note
- follow-up linkage carries `parent_request_id`, incremented retry count, and prior evidence
- `guarded_answer` outranks all other answer modes
- a follow-up failure after a reviewed answer routes toward Arbiter re-check and then DeepDebug
- `sensor_or_can_fault` and other safety/hardware flows can route through Arbiter
- PatternScout and Checker can be skipped gracefully when unavailable, but Arbiter cannot be skipped silently on substantive advice

---

## 4. Files Codex should create or update

Use existing repo conventions when possible. If the repo already has equivalent worker folders, patch them instead of creating parallel structures.

### 4.1 PatternScout
Recommended paths if no equivalent already exists:

- `agents/patternscout/index.js`
- `agents/patternscout/lib/query_normalizer.js`
- `agents/patternscout/lib/search_local_memory.js`
- `agents/patternscout/lib/search_repo_mirror.js`
- `agents/patternscout/lib/search_github_fallback.js`
- `agents/patternscout/lib/score_matches.js`
- `agents/patternscout/lib/cache.js`
- `scripts/patternscout/refresh-mirrors.js`

### 4.2 Checker
Recommended paths if no equivalent already exists:

- `agents/checker/index.js`
- `agents/checker/lib/repo_locator.js`
- `agents/checker/lib/mirror_manager.js`
- `agents/checker/lib/worktree_manager.js`
- `agents/checker/lib/safe_patch.js`
- `agents/checker/lib/allowlisted_runner.js`

### 4.3 Runtime glue
Patch the active runtime entrypoint and supporting files as needed, likely under something like:

- `agents/clawdia/runtime/helpdesk_orchestrator.js`
- `agents/clawdia/runtime/worker_adapters.js`
- the file that actually implements `callWorker(...)`
- `docs/runtime/openclaw.template.json`

### 4.4 Tests and fixtures
Current repository state:

- Legacy `scripts/tests/*` and `tests/*` harness paths were removed during cleanup.
- Validation is run via direct runtime smoke checks against `agents/clawdia/runtime/helpdesk_orchestrator.js`.
- Temporary fixtures can be created under `tmp/` when needed, but should not be treated as permanent test harness paths.

---

## 5. Shared contract requirements

### 5.1 PatternScout response
PatternScout must return at minimum:

- `request_id`
- `contract_version`
- `status`
- `kind: "retrieval"`
- `summary`
- `matches`
- `retrieval_summary`
- `coverage_note`
- `retrieval_latency_ms`
- `source_tiers_used`
- `confidence`
- `warnings`
- `contract_flags`
- `telemetry_hints`
- `error`

#### `matches` item shape
Each match should be a structured object with at least:

- `tier` — one of `gatorbots`, `official_examples`, `approved_internal`, `docs_memory`, `public_frc`
- `repo` or `source_id`
- `path`
- `line_start`
- `line_end`
- `symbol` nullable
- `snippet`
- `score`
- `why_matched`

PatternScout may also include `sources` as a compatibility alias, but `matches` is the canonical field.

### 5.2 Checker response
Checker must return at minimum:

- `request_id`
- `contract_version`
- `status`
- `kind: "validation"`
- `summary`
- `tests`
- `overall_status`
- `worktree_path`
- `warnings`
- `contract_flags`
- `telemetry_hints`
- `error`

#### `tests` item shape
Each test entry should include at least:

- `name`
- `result` — `passed`, `failed`, `skipped`, or `error`
- `exit_code`
- `duration_ms`
- `stdout_tail`
- `stderr_tail`

### 5.3 Contract flags defaults
Unless another worker upgrades them later:

```json
{
  "reviewed": false,
  "escalated": false,
  "implementation_safe": false,
  "pattern_only": false
}
```

---

## 6. PatternScout — required behavior

PatternScout is a **hybrid retrieval worker**. It should not be “just a cache script” or “just grep.” It must search multiple sources, merge results, score them, and return a clean contract.

### 6.1 Inputs
PatternScout receives the Phase 1 payload shape from the orchestrator, including:

- `request_id`
- `intent`
- `user_message`
- `query`
- `context.source_priority`
- retry context fields if present

### 6.2 Retrieval lanes
Implement these lanes in order, with best-effort graceful degradation:

#### Lane A — local repo mirrors
Search configured local mirrors for code examples and matching symbols.

Use a config section like this in runtime config or template:

```json
{
  "patternScout": {
    "repoMirrors": [
      {
        "id": "gatorbots-2026",
        "tier": "gatorbots",
        "localPath": "/opt/clawdia/mirrors/gatorbots-2026",
        "remoteUrl": "git@github.com:ORG/REPO.git",
        "defaultRef": "main",
        "includeGlobs": ["src/main/java/**", "src/main/kotlin/**"]
      }
    ]
  }
}
```

Search method:
- prefer `rg` if available
- fall back to Node filesystem traversal if `rg` is unavailable
- search only allowlisted source file extensions: `.java`, `.kt`, `.json`, `.md`
- do not read massive binaries or `.git`

#### Lane B — local docs memory
Search local docs memory under something like:

- `agents/clawdia/memory/docs/`
- `agents/arbiter/memory/docs/` if useful and already present

This lane is for WPILib docs, vendor docs, team notes, and short examples.

#### Lane C — official examples mirror
If configured, search local mirrors of official example repos or example caches.

This can share the same code path as repo mirrors; the important part is the output tier is `official_examples`.

#### Lane D — GitHub fallback
If local retrieval is weak or empty and GitHub CLI auth is available, do a constrained fallback search against allowlisted remotes.

Rules:
- this is optional but should exist if `gh` is installed and configured
- do not spray wide open internet queries
- use allowlisted repos from config
- cap results tightly
- return warnings if GitHub search was unavailable or rate-limited

### 6.3 Query normalization
Create a normalizer that extracts likely search terms from the message.

The normalizer should derive:
- raw query
- lowercase tokens
- quoted phrases
- probable class names like `TalonFX`, `SubsystemBase`, `SwerveDrivePoseEstimator`
- probable subsystem nouns like `intake`, `swerve`, `shooter`, `beam break`
- probable vendor markers like `phoenix`, `rev`, `limelight`, `navx`, `pigeon`

Return a normalized structure that downstream search functions can reuse.

### 6.4 Result scoring
Score results using a deterministic function, not vibes.

Suggested scoring factors:
- exact symbol/class match
- filename/path relevance
- query-token coverage
- tier priority
- shorter distance between matched terms
- file location bonus for likely subsystem paths
- slight penalty for markdown-only results when code results exist

Example tier weights:
- `gatorbots`: +40
- `official_examples`: +28
- `approved_internal`: +24
- `docs_memory`: +18
- `public_frc`: +10

PatternScout should return at most:
- top 8 matches total
- no more than 4 from the same source repo
- deduplicated by `(repo, path, line_start, line_end)` or equivalent

### 6.5 Coverage note
Set `coverage_note` based on what was actually found.

Examples:
- `"Strong local match from gatorbots intake subsystem and one official example."`
- `"Only docs-memory hits found; no close code match in configured mirrors."`
- `"No strong match; retrieval degraded to public_frc fallback."`

### 6.6 Confidence
Set confidence with deterministic logic, for example:
- `high` when there is at least one strong `gatorbots` or `official_examples` code match plus reasonable token coverage
- `medium` when results exist but are mostly docs or weak code matches
- `low` when retrieval is sparse or fallback-only

### 6.7 Cache
Add a small cache layer to avoid repeated expensive scans.

Requirements:
- cache key derived from normalized query + configured source set
- cache value contains normalized query, matches, timestamp, and summary fields
- TTL configurable, default 10 minutes
- store in a temp/cache directory already used by the repo or under a sane new path
- safe to delete without harming correctness

Cache misses must never break retrieval.

### 6.8 Mirror refresh helper
Add `scripts/patternscout/refresh-mirrors.js`.

Behavior:
- refresh each configured mirror with `git fetch --all --prune`
- clone missing mirrors into the configured local path
- never delete a mirror automatically
- print a concise report

This helper is **supporting infrastructure**, not the whole worker.

### 6.9 PatternScout failure behavior
PatternScout should:
- return `status: "success"` with empty matches if retrieval found nothing
- return `status: "error"` only for real internal failures, and include `error.partial_result` when some lanes succeeded
- never throw raw shell spew back into the orchestrator

### 6.10 PatternScout reference implementation shape
Use something roughly like this:

```js
// agents/patternscout/index.js
async function runPatternScout(payload, deps = {}) {
  // 1. normalize query
  // 2. consult cache
  // 3. search local repo mirrors
  // 4. search local docs memory
  // 5. search official examples
  // 6. fallback to gh search if needed and allowed
  // 7. score and merge results
  // 8. build contract response
}
module.exports = { runPatternScout };
```

---

## 7. Checker — required behavior

Checker is the **validation worker**. It must own the worktree lifecycle and allowlisted command execution. It is not enough to run a shell script and hope the universe is kind.

### 7.1 Inputs
Checker receives the Phase 1 payload shape, including a builder output in `context.builder_output`.

Support at least these builder shapes:
- a unified diff / patch string
- explicit `target_files` plus per-file content
- a plain `draft` string with one target file

If the builder output is too vague to validate, Checker should return `status: "success"` with `overall_status: "skipped"` and a warning explaining why validation did not run.

### 7.2 Repo discovery
Checker must locate the target robot repo using config, not magic.

Add config support like:

```json
{
  "checker": {
    "workspaceRepos": [
      {
        "id": "gatorbots-main",
        "localPath": "/home/ubuntu/gatorbots-robot",
        "mirrorPath": "/opt/clawdia/mirrors/gatorbots-main.git",
        "defaultRef": "main",
        "buildProfile": "gradle-java"
      }
    ]
  }
}
```

Repo selection rules:
- if payload explicitly names a repo and it is allowlisted, use it
- else use the default configured workspace repo
- else return structured `overall_status: "skipped"` with warning `"no configured workspace repo"`

### 7.3 Mirror lifecycle
Implement a mirror manager:

- create missing mirror with `git clone --mirror`
- refresh existing mirror with `git fetch --all --prune`
- record refresh timing in telemetry
- do not mutate the user’s real working repo during validation

### 7.4 Worktree lifecycle
For each request:

1. create a temp directory unique to the request
2. create a detached worktree from the mirror at the chosen ref
3. apply the candidate change
4. run allowlisted commands
5. capture structured results
6. clean up the worktree unless config says keep failed worktrees for debugging

Recommended temp path:
- `/tmp/clawdia/checker/<request_id>/`

### 7.5 Safe patch application
Implement a safety layer before writing anything.

Reject:
- absolute paths
- paths containing `..`
- `.git/`
- writes outside the worktree root
- binary patches
- deletion of critical repo files outside an allowlist
- arbitrary chmod or shell directives

Support these application modes:

#### Mode A — unified diff
If builder output contains a patch/diff:
- validate file paths
- apply with `git apply --check`
- then `git apply`
- if `git apply --check` fails, return structured failure and include a concise reason

#### Mode B — explicit file write
If builder output provides `target_files` and file contents:
- validate each path
- create parent directories inside the worktree as needed
- write files with UTF-8
- optionally stage them for diff generation

#### Mode C — single draft fallback
If builder output includes one likely target file and one `draft`, allow a single-file write path if the repo conventions make the target file unambiguous. Otherwise skip with warning.

### 7.6 Allowlisted runner
Implement a runner that executes only allowlisted commands.

Config example:

```json
{
  "checker": {
    "allowedCommands": {
      "gradle-java": [
        ["./gradlew", "build"],
        ["./gradlew", "test"]
      ],
      "gradle-java-fast": [
        ["./gradlew", "build", "-x", "test"]
      ]
    },
    "defaultProfile": "gradle-java-fast",
    "commandTimeoutMs": 240000,
    "keepFailedWorktrees": false
  }
}
```

Rules:
- commands must come only from config or code allowlist, never from the user message
- run in the request worktree
- stream or buffer output internally, but return only concise tails in the contract
- capture duration and exit code
- stop after the first hard failure unless config says continue
- `stdout_tail` and `stderr_tail` should be capped to a sane number of lines

### 7.7 Overall status
Set `overall_status` based on executed tests:

- `passed` — all executed commands passed
- `failed` — at least one command failed
- `skipped` — no validation was run for a legitimate reason
- `error` — internal checker failure

### 7.8 Checker failure behavior
Checker should never crash the orchestrator with raw exceptions. Convert internal failures into the contract shape.

If the mirror or worktree step fails internally:
- `status: "error"`
- `overall_status: "error"`
- include a concise `error.error_code` and message
- add a warning if there was a partial setup

### 7.9 Checker reference implementation shape
Use something roughly like this:

```js
// agents/checker/index.js
async function runChecker(payload, deps = {}) {
  // 1. locate repo
  // 2. ensure/refresh mirror
  // 3. create request worktree
  // 4. apply safe patch or file writes
  // 5. run allowlisted commands
  // 6. build structured response
  // 7. cleanup worktree as configured
}
module.exports = { runChecker };
```

---

## 8. Runtime glue requirements

### 8.1 Wire the workers into the active runtime
Find the actual runtime implementation of `callWorker(worker, payload)` and patch it so:

- `patternscout` calls the real PatternScout implementation
- `checker` calls the real Checker implementation

Do not just create these workers and leave the runtime still pointing at stubs.

### 8.2 Availability checks
If the repo already uses `isWorkerAvailable(worker)`, make it meaningful:

PatternScout should be unavailable when:
- no configured mirrors/docs exist **and**
- GitHub fallback is disabled or unavailable

Checker should be unavailable when:
- no configured workspace repo exists
- required executables (`git` and configured build tools) are missing

### 8.3 Human dossier notes
If Phase 1 already writes human notes, append concise but useful worker outcomes such as:

- `PatternScout: 4 matches, strong local gatorbots hit`
- `Check Runner: passed ./gradlew build`
- `Check Runner: skipped (no target repo configured)`

### 8.4 Retrieval sources propagation
When PatternScout succeeds, propagate its structured match list into dossier retrieval fields the way the existing orchestrator expects.

### 8.5 Answer-mode interaction
Do not let Checker mark the final answer as reviewed. Checker only contributes validation evidence. Arbiter still decides whether a code response is approved/revised/escalated.

---

## 9. Config additions

Update `docs/runtime/openclaw.template.json` or the repo’s equivalent runtime template to include sane defaults for both workers.

Minimum config sections to document:

```json
{
  "patternScout": {
    "enabled": true,
    "cacheDir": "/tmp/clawdia/patternscout-cache",
    "cacheTtlMs": 600000,
    "maxMatches": 8,
    "repoMirrors": [],
    "docsRoots": [
      "agents/clawdia/memory/docs"
    ],
    "githubFallback": {
      "enabled": true,
      "repos": [],
      "maxResults": 6
    }
  },
  "checker": {
    "enabled": true,
    "workspaceRepos": [],
    "allowedCommands": {
      "gradle-java-fast": [
        ["./gradlew", "build", "-x", "test"]
      ]
    },
    "defaultProfile": "gradle-java-fast",
    "commandTimeoutMs": 240000,
    "keepFailedWorktrees": false,
    "tempRoot": "/tmp/clawdia/checker"
  }
}
```

If the repo already uses a different config style, map these semantics into that style instead of forcing a new incompatible format.

---

## 10. Tests Codex must add and run

Use the repo’s existing test style if one already exists. If there is no test framework, a Node-based runner using `assert` is acceptable and consistent with the earlier Phase 1 test harness.

### 10.1 PatternScout unit tests
Add tests for:

1. **normalizer extracts useful tokens**
   - input: `"Write an intake subsystem with TalonFX and beam break"`
   - expect tokens including `intake`, `TalonFX`, `beam break`

2. **local docs memory search returns structured matches**
   - use fixture docs
   - expect `tier: "docs_memory"`

3. **repo mirror search returns code matches**
   - use small fixture repo mirror with Java files
   - expect path/snippet/score fields

4. **result scoring prioritizes gatorbots over docs-only**
   - same query, mixed candidate set
   - expect gatorbots match to rank higher

5. **cache hit avoids repeated search work**
   - same normalized query twice
   - second run should indicate cache usage or avoid re-search via spies

6. **empty retrieval is success with low confidence**
   - expect `status: "success"`, `matches: []`, `confidence: "low"`

7. **GitHub fallback failure degrades gracefully**
   - mock `gh` unavailable/rate-limited
   - expect warning, not crash

### 10.2 Checker unit tests
Add tests for:

1. **repo locator returns configured default repo**
2. **safe patch rejects path traversal**
   - patch touching `../../etc/passwd`
   - expect structured failure
3. **safe patch rejects `.git/` writes**
4. **unified diff applies in a temp worktree**
   - use a small fixture repo
5. **explicit file write mode succeeds for safe paths**
6. **allowlisted runner refuses unknown commands**
7. **failing build returns `overall_status: "failed"` with test result details**
8. **no configured repo returns skipped instead of crash**
9. **cleanup removes worktree when configured**
10. **keepFailedWorktrees preserves worktree on failed validation when configured**

### 10.3 Integration tests
Add at least these integration/smoke tests:

1. **subsystem draft flow uses real PatternScout and Checker contracts**
   - fake builder output
   - real PatternScout fixture search
   - real Checker fixture repo/worktree
   - expect worker trace includes `patternscout`, `checker`, then `arbiter` in orchestrator-level test if available

2. **PatternScout unavailable is skipped gracefully**
   - config with no mirrors/docs/gh disabled
   - expect orchestrator fallback event, not crash

3. **Checker unavailable is skipped gracefully**
   - no workspace repo configured
   - expect structured skip and dossier note

4. **Checker failure does not masquerade as reviewed answer**
   - checker fails build
   - arbiter/test harness should see validation failure evidence, not `reviewed: true`

5. **follow-up flow preserves parent evidence while re-running PatternScout**
   - use a parent dossier fixture
   - expect parent linkage intact

### 10.4 Validation runner
Current repository state:

- No dedicated `scripts/tests` runner is retained.
- Use direct smoke checks that invoke the runtime entrypoint and verify dossier + trace behavior.
- Keep command output machine-parseable and exit nonzero on failure.

---

## 11. Suggested implementation details

These are not rigid file names, but they are the intended behavior.

### 11.1 Query normalizer
Implement a reusable normalizer object like:

```js
{
  raw: "Write an intake subsystem with TalonFX and beam break",
  phrases: ["beam break"],
  tokens: ["write", "intake", "subsystem", "with", "talonfx", "beam", "break"],
  symbols: ["TalonFX"],
  vendorHints: ["phoenix"],
  subsystemHints: ["intake"],
  docsHints: ["subsystem"]
}
```

### 11.2 Search result extraction
For `rg`-based search, collect:
- file path
- line number
- nearby context lines
- a clipped snippet

Do not return megabytes of file content. Keep snippets concise.

### 11.3 Snippet clipping
Use a helper that returns something like 3–8 relevant lines around the match and redacts giant blocks.

### 11.4 Safe tails
For command outputs, keep only the last ~20–40 lines in `stdout_tail` and `stderr_tail`.

### 11.5 Worktree cleanup
Use `git worktree remove --force` where possible, then delete the temp directory if needed. Guard against deleting anything outside the configured temp root.

---

## 12. Example success payloads

### 12.1 PatternScout success
```json
{
  "request_id": "RQ-123",
  "contract_version": "1.0",
  "status": "success",
  "kind": "retrieval",
  "summary": "Found two strong subsystem matches and one relevant vendor-doc note.",
  "matches": [
    {
      "tier": "gatorbots",
      "repo": "gatorbots-2026",
      "path": "src/main/java/frc/robot/subsystems/Intake.java",
      "line_start": 12,
      "line_end": 28,
      "symbol": "Intake",
      "snippet": "public class Intake extends SubsystemBase { ... }",
      "score": 91,
      "why_matched": "Exact intake subsystem + TalonFX usage"
    }
  ],
  "retrieval_summary": "Strong local gatorbots intake match plus one official example.",
  "coverage_note": "Strong for subsystem layout; weaker for sensor debounce logic.",
  "retrieval_latency_ms": 182,
  "source_tiers_used": ["gatorbots", "official_examples"],
  "confidence": "high",
  "warnings": [],
  "contract_flags": {
    "reviewed": false,
    "escalated": false,
    "implementation_safe": false,
    "pattern_only": true
  },
  "telemetry_hints": {
    "cache_hit": false
  },
  "error": null
}
```

### 12.2 Checker success
```json
{
  "request_id": "RQ-123",
  "contract_version": "1.0",
  "status": "success",
  "kind": "validation",
  "summary": "Validation passed in temp worktree.",
  "tests": [
    {
      "name": "./gradlew build -x test",
      "result": "passed",
      "exit_code": 0,
      "duration_ms": 42105,
      "stdout_tail": ["BUILD SUCCESSFUL in 39s"],
      "stderr_tail": []
    }
  ],
  "overall_status": "passed",
  "worktree_path": "/tmp/clawdia/checker/RQ-123/worktree",
  "warnings": [],
  "contract_flags": {
    "reviewed": false,
    "escalated": false,
    "implementation_safe": false,
    "pattern_only": false
  },
  "telemetry_hints": {
    "mirror_refresh_ms": 190,
    "worktree_setup_ms": 142
  },
  "error": null
}
```

### 12.3 Checker skipped
```json
{
  "request_id": "RQ-123",
  "contract_version": "1.0",
  "status": "success",
  "kind": "validation",
  "summary": "Validation skipped because no configured workspace repo matched the request.",
  "tests": [],
  "overall_status": "skipped",
  "worktree_path": null,
  "warnings": ["no configured workspace repo"],
  "contract_flags": {
    "reviewed": false,
    "escalated": false,
    "implementation_safe": false,
    "pattern_only": false
  },
  "telemetry_hints": {},
  "error": null
}
```

---

## 13. Acceptance criteria

Part 2 is done only when all of these are true:

1. `patternscout` is called through the live runtime and returns structured contract data from real retrieval lanes
2. `checker` is called through the live runtime and performs real worktree-based validation when given a safe builder payload
3. both workers degrade gracefully on missing config or tool outages
4. existing Phase 1 answer-mode and dossier behavior still pass
5. current runtime smoke validations pass
6. no duplicate path/casing mistakes were introduced
7. no user-controlled shell execution exists in the new code

---

## 14. Validation commands Codex must run

Use the repo’s real package/test commands if they already exist. In this cleaned repo, run at minimum:

```bash
node -e "require('./agents/clawdia/runtime/helpdesk_orchestrator')"
bash -n scripts/codex-plan.sh
bash -n scripts/codex-implement.sh
```

If the repo later restores a higher-level test command, run it too.

Also run lightweight syntax checks on any new Node files if the repo does not already do that:

```bash
node --check agents/patternscout/index.js
node --check agents/checker/index.js
```

If fixture repos include Gradle wrapper validation, use the Checker test harness rather than running arbitrary commands manually.

---

## 15. Final patch report format

At the end, Codex should print a concise report with:

- changed files
- active runtime entrypoint that was patched
- PatternScout retrieval lanes implemented
- Checker validation modes implemented
- config fields added
- validation commands run
- pass/fail counts
- anything intentionally deferred

Format example:

```markdown
# Part 2 Patch Report

## Changed files
- ...

## Runtime wiring
- patched: ...

## PatternScout
- implemented lanes: ...
- cache: ...

## Checker
- implemented modes: ...
- allowlisted profiles: ...

## Validation
- `node -e "require('./agents/clawdia/runtime/helpdesk_orchestrator')"` ✅
- `bash -n scripts/codex-plan.sh` ✅
- `bash -n scripts/codex-implement.sh` ✅

## Deferred
- ...
```

---

## 16. Handoff output for Part 3

After implementation, Codex should leave a short machine-readable handoff note in the repo, for example:

- `docs/handoffs/PART_2_HANDOFF.md`

It should contain:
- actual worker file paths
- actual runtime entrypoint path
- final config keys in use
- fixture/test entrypoints
- remaining risks for rollout

This keeps the next phase from developing amnesia and reinventing the same wrench twice.
