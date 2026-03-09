'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTRACT_VERSION = '1.0';

const LEGACY_ALLOWLIST = [
  ['./gradlew', 'build'],
  ['./gradlew', 'test'],
  ['./gradlew', 'spotlessCheck'],
  ['./gradlew', 'check']
];

const DEFAULT_CONFIG = {
  enabled: true,
  workspaceRepos: [],
  allowedCommands: {
    'gradle-java': [
      ['./gradlew', 'build'],
      ['./gradlew', 'test']
    ],
    'gradle-java-fast': [
      ['./gradlew', 'build', '-x', 'test']
    ]
  },
  defaultProfile: 'gradle-java-fast',
  commandTimeoutMs: 240000,
  keepFailedWorktrees: false,
  tempRoot: '/tmp/clawdia/checker'
};

function nowSafeId() {
  return Date.now().toString(36);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function tailLines(text, maxLines) {
  const lines = String(text || '').split('\n').filter(Boolean);
  return lines.slice(-Math.max(1, maxLines || 30));
}

function copyWorkspace(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (src) => {
      const rel = path.relative(sourceDir, src);
      if (!rel) return true;
      if (rel.startsWith('.git')) return false;
      if (rel.startsWith('node_modules')) return false;
      if (rel.startsWith('runtime_state')) return false;
      return true;
    }
  });
}

function hasCommand(cmd) {
  const out = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  return out.status === 0;
}

function sanitizeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'request';
}

function resolveCheckerConfig(payload) {
  const payloadCfg = payload?.checker_config || payload?.config?.checker || {};

  const merged = {
    ...DEFAULT_CONFIG,
    ...payloadCfg,
    allowedCommands: {
      ...DEFAULT_CONFIG.allowedCommands,
      ...(payloadCfg.allowedCommands || {})
    }
  };

  merged.tempRoot = path.resolve(String(merged.tempRoot || DEFAULT_CONFIG.tempRoot));
  return merged;
}

function resolveRepoConfig(payload, config) {
  const requestedRepoId = payload?.repo_id || payload?.context?.repo_id || null;
  const repos = Array.isArray(config.workspaceRepos) ? config.workspaceRepos : [];

  if (requestedRepoId) {
    const matched = repos.find((repo) => repo.id === requestedRepoId);
    if (matched) {
      return {
        id: matched.id,
        localPath: path.resolve(matched.localPath),
        mirrorPath: matched.mirrorPath ? path.resolve(matched.mirrorPath) : null,
        defaultRef: matched.defaultRef || 'HEAD',
        buildProfile: matched.buildProfile || config.defaultProfile
      };
    }
  }

  if (repos.length > 0) {
    const first = repos[0];
    return {
      id: first.id || 'workspace-default',
      localPath: path.resolve(first.localPath),
      mirrorPath: first.mirrorPath ? path.resolve(first.mirrorPath) : null,
      defaultRef: first.defaultRef || 'HEAD',
      buildProfile: first.buildProfile || config.defaultProfile
    };
  }

  if (payload?.source_repo) {
    return {
      id: 'payload-source',
      localPath: path.resolve(payload.source_repo),
      mirrorPath: null,
      defaultRef: 'HEAD',
      buildProfile: config.defaultProfile
    };
  }

  return null;
}

function isGitRepo(repoPath) {
  return fs.existsSync(path.join(repoPath, '.git')) || fs.existsSync(path.join(repoPath, 'HEAD'));
}

function runGit(args, options) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    ...options
  });
}

function ensureMirror(repoConfig, config) {
  const started = Date.now();
  if (!hasCommand('git')) {
    return {
      ok: false,
      error: {
        error_code: 'git_missing',
        message: 'git is required for checker mirror/worktree flow'
      }
    };
  }

  const mirrorRoot = path.join(config.tempRoot, 'mirrors');
  ensureDir(mirrorRoot);

  const mirrorPath = repoConfig.mirrorPath || path.join(mirrorRoot, `${sanitizeId(repoConfig.id)}.git`);

  if (!fs.existsSync(mirrorPath)) {
    const clone = runGit(['clone', '--mirror', repoConfig.localPath, mirrorPath]);
    if (clone.status !== 0) {
      return {
        ok: false,
        error: {
          error_code: 'mirror_clone_failed',
          message: tailLines(clone.stderr, 15).join('\n') || 'failed to clone mirror'
        }
      };
    }
  } else {
    const fetch = runGit(['--git-dir', mirrorPath, 'fetch', '--all', '--prune']);
    if (fetch.status !== 0) {
      return {
        ok: false,
        error: {
          error_code: 'mirror_refresh_failed',
          message: tailLines(fetch.stderr, 15).join('\n') || 'failed to refresh mirror'
        }
      };
    }
  }

  return {
    ok: true,
    mirrorPath,
    mirror_refresh_ms: Date.now() - started
  };
}

function createWorktreeFromMirror(mirrorPath, ref, config, requestId) {
  const started = Date.now();
  const requestRoot = path.join(config.tempRoot, sanitizeId(requestId));
  const worktreePath = path.join(requestRoot, 'worktree');
  ensureDir(requestRoot);

  const add = runGit(['--git-dir', mirrorPath, 'worktree', 'add', '--detach', worktreePath, ref || 'HEAD']);
  if (add.status !== 0) {
    return {
      ok: false,
      error: {
        error_code: 'worktree_add_failed',
        message: tailLines(add.stderr, 15).join('\n') || 'failed to create worktree'
      }
    };
  }

  return {
    ok: true,
    requestRoot,
    worktreePath,
    worktree_setup_ms: Date.now() - started,
    cleanup: () => {
      runGit(['--git-dir', mirrorPath, 'worktree', 'remove', '--force', worktreePath]);
      if (requestRoot.startsWith(config.tempRoot)) {
        fs.rmSync(requestRoot, { recursive: true, force: true });
      }
    }
  };
}

function createCopyWorktree(localPath, config, requestId) {
  const started = Date.now();
  const requestRoot = path.join(config.tempRoot, sanitizeId(requestId));
  const worktreePath = path.join(requestRoot, 'worktree');
  ensureDir(requestRoot);
  copyWorkspace(localPath, worktreePath);

  return {
    ok: true,
    requestRoot,
    worktreePath,
    worktree_setup_ms: Date.now() - started,
    warning: 'no_git_repo_fallback_copy',
    cleanup: () => {
      if (requestRoot.startsWith(config.tempRoot)) {
        fs.rmSync(requestRoot, { recursive: true, force: true });
      }
    }
  };
}

function isSafeRelativePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  if (path.isAbsolute(filePath)) return false;

  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('\0')) return false;
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') return false;
  if (normalized.startsWith('.git/') || normalized.includes('/.git/')) return false;

  const clean = path.posix.normalize(normalized);
  if (clean.startsWith('../') || clean === '..') return false;
  if (clean.startsWith('/')) return false;
  return true;
}

function safeJoin(worktreePath, relativePath) {
  const joined = path.resolve(worktreePath, relativePath);
  const root = path.resolve(worktreePath);
  if (!joined.startsWith(root)) return null;
  return joined;
}

function looksLikeUnifiedDiff(text) {
  const diff = String(text || '');
  return /^diff --git /m.test(diff) || (/^--- /m.test(diff) && /^\+\+\+ /m.test(diff));
}

function extractPatchString(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'string' && looksLikeUnifiedDiff(candidate)) return candidate;

  const fields = ['patch', 'diff', 'unified_diff'];
  for (const key of fields) {
    const value = candidate[key];
    if (typeof value === 'string' && looksLikeUnifiedDiff(value)) {
      return value;
    }
  }

  return null;
}

function normalizeTargetFiles(candidate) {
  if (!candidate || typeof candidate !== 'object') return [];

  const out = [];

  if (Array.isArray(candidate.target_files)) {
    for (const entry of candidate.target_files) {
      if (!entry || typeof entry !== 'object') continue;
      const filePath = entry.path || entry.file || entry.target || null;
      const content = entry.content ?? entry.code ?? null;
      if (typeof filePath === 'string' && typeof content === 'string') {
        out.push({ path: filePath, content });
      }
    }
  }

  const codeBlocks = Array.isArray(candidate.code_blocks) ? candidate.code_blocks : [];
  for (const block of codeBlocks) {
    if (!block || typeof block !== 'object') continue;
    if (typeof block.path === 'string' && typeof block.code === 'string') {
      out.push({ path: block.path, content: block.code });
    }
  }

  if (candidate.revised_output) {
    if (Array.isArray(candidate.revised_output)) {
      for (const block of candidate.revised_output) {
        if (block && typeof block.path === 'string' && typeof block.code === 'string') {
          out.push({ path: block.path, content: block.code });
        }
      }
    } else if (typeof candidate.revised_output === 'object') {
      out.push(...normalizeTargetFiles(candidate.revised_output));
    }
  }

  if (typeof candidate.draft === 'string' && typeof candidate.target_file === 'string') {
    out.push({ path: candidate.target_file, content: candidate.draft });
  }

  if (candidate.raw && typeof candidate.raw === 'object') {
    out.push(...normalizeTargetFiles(candidate.raw));
  }

  const dedup = new Map();
  for (const entry of out) {
    dedup.set(entry.path, entry);
  }

  return Array.from(dedup.values());
}

function applyUnifiedDiff(worktreePath, patchText) {
  const patchFile = path.join(worktreePath, `.clawdia_checker_patch_${nowSafeId()}.diff`);
  let normalizedPatch = String(patchText || '');
  if (!normalizedPatch.endsWith('\n')) normalizedPatch += '\n';
  fs.writeFileSync(patchFile, normalizedPatch, 'utf8');

  try {
    const check = runGit(['apply', '--check', '--whitespace=nowarn', patchFile], {
      cwd: worktreePath
    });

    if (check.status !== 0) {
      return {
        ok: false,
        reason: 'patch_check_failed',
        details: tailLines(check.stderr, 20).join('\n') || 'git apply --check failed'
      };
    }

    const apply = runGit(['apply', '--whitespace=nowarn', patchFile], {
      cwd: worktreePath
    });

    if (apply.status !== 0) {
      return {
        ok: false,
        reason: 'patch_apply_failed',
        details: tailLines(apply.stderr, 20).join('\n') || 'git apply failed'
      };
    }

    return { ok: true, mode: 'unified_diff', files_written: [] };
  } finally {
    if (fs.existsSync(patchFile)) {
      fs.unlinkSync(patchFile);
    }
  }
}

function applyTargetFiles(worktreePath, files) {
  const written = [];

  for (const entry of files) {
    if (!isSafeRelativePath(entry.path)) {
      return {
        ok: false,
        reason: 'unsafe_path',
        details: `unsafe file path rejected: ${entry.path}`
      };
    }

    const target = safeJoin(worktreePath, entry.path);
    if (!target) {
      return {
        ok: false,
        reason: 'path_escape',
        details: `path escapes worktree: ${entry.path}`
      };
    }

    ensureDir(path.dirname(target));
    fs.writeFileSync(target, String(entry.content), 'utf8');
    written.push(entry.path);
  }

  return {
    ok: true,
    mode: 'explicit_write',
    files_written: written
  };
}

function resolveCandidatePayload(payload) {
  const context = payload?.context || {};
  const dossierOutputs = payload?.dossier?.worker_outputs || {};

  return (
    context.builder_output ||
    payload?.builder_output ||
    dossierOutputs?.arbiter?.revised_output ||
    dossierOutputs?.arbiter?.raw?.revised_output ||
    dossierOutputs?.builder ||
    dossierOutputs?.builder?.raw ||
    null
  );
}

function materializeCandidateChange(worktreePath, payload) {
  const candidate = resolveCandidatePayload(payload);
  if (!candidate) {
    return {
      status: 'skipped',
      reason: 'no_builder_output',
      warning: 'no builder output available to validate'
    };
  }

  const patch = extractPatchString(candidate);
  if (patch) {
    const applied = applyUnifiedDiff(worktreePath, patch);
    if (!applied.ok) {
      return {
        status: 'error',
        reason: applied.reason,
        warning: applied.details
      };
    }

    return {
      status: 'applied',
      mode: 'unified_diff',
      files_written: []
    };
  }

  const writes = normalizeTargetFiles(candidate);
  if (writes.length > 0) {
    const applied = applyTargetFiles(worktreePath, writes);
    if (!applied.ok) {
      return {
        status: 'error',
        reason: applied.reason,
        warning: applied.details
      };
    }

    return {
      status: 'applied',
      mode: 'explicit_write',
      files_written: applied.files_written
    };
  }

  return {
    status: 'skipped',
    reason: 'builder_output_unusable',
    warning: 'builder output did not contain patch or writable file targets'
  };
}

function flattenAllowlist(config) {
  const set = [];
  const allowed = config.allowedCommands || {};
  for (const value of Object.values(allowed)) {
    if (Array.isArray(value)) {
      for (const tuple of value) {
        if (Array.isArray(tuple)) set.push(tuple);
      }
    }
  }
  for (const tuple of LEGACY_ALLOWLIST) {
    set.push(tuple);
  }
  return set;
}

function resolveCommandExecutable(worktreePath, command0) {
  if (typeof command0 !== 'string' || !command0.trim()) return null;
  if (path.isAbsolute(command0)) return command0;
  if (command0.includes('/')) return path.resolve(worktreePath, command0);
  return null;
}

function hasExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runAllowlistedChecks(worktreePath, commands, options) {
  const opts = options || {};
  const config = opts.config || DEFAULT_CONFIG;
  const timeout = Number(config.commandTimeoutMs || DEFAULT_CONFIG.commandTimeoutMs);
  const allowlist = flattenAllowlist(config);
  const tests = [];

  const requested = Array.isArray(commands) && commands.length
    ? commands
    : (config.allowedCommands?.[opts.profile || config.defaultProfile] || []);

  const runCommands = requested.length ? requested : LEGACY_ALLOWLIST;

  for (const cmdTuple of runCommands) {
    const command = Array.isArray(cmdTuple) ? cmdTuple : [];
    const key = command.join(' ');

    const allowed = allowlist.some((a) => a.length === command.length && a.every((v, i) => v === command[i]));
    if (!allowed) {
      tests.push({
        name: key || 'unknown',
        result: 'skipped',
        exit_code: null,
        duration_ms: 0,
        stdout_tail: [],
        stderr_tail: ['command not in allowlist'],
        reason: 'not_allowlisted'
      });
      continue;
    }

    const executable = resolveCommandExecutable(worktreePath, command[0]);
    if (executable && !fs.existsSync(executable)) {
      tests.push({
        name: key || 'unknown',
        result: 'skipped',
        exit_code: null,
        duration_ms: 0,
        stdout_tail: [],
        stderr_tail: [`missing command: ${command[0]}`],
        reason: 'command_missing'
      });
      continue;
    }
    if (executable && !hasExecutable(executable)) {
      tests.push({
        name: key || 'unknown',
        result: 'skipped',
        exit_code: null,
        duration_ms: 0,
        stdout_tail: [],
        stderr_tail: [`command is not executable: ${command[0]}`],
        reason: 'command_not_executable'
      });
      continue;
    }

    const started = Date.now();
    const proc = spawnSync(command[0], command.slice(1), {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout
    });
    const duration = Date.now() - started;

    let result = 'passed';
    let reason = undefined;
    if (proc.error) {
      if (proc.error.code === 'ENOENT') {
        result = 'skipped';
        reason = 'command_unavailable';
      } else if (typeof proc.status === 'number') {
        result = proc.status === 0 ? 'passed' : 'failed';
      } else {
        result = 'error';
      }
    } else if (proc.status !== 0) {
      result = 'failed';
    }

    tests.push({
      name: key,
      result,
      exit_code: proc.status,
      duration_ms: duration,
      stdout_tail: tailLines(proc.stdout, 30),
      stderr_tail: tailLines(proc.stderr || (proc.error ? proc.error.message : ''), 30),
      reason
    });

    if (result === 'failed' || result === 'error') {
      break;
    }
  }

  return tests;
}

function computeOverallStatus(tests) {
  if (!tests.length) return 'skipped';
  if (tests.some((t) => t.result === 'error')) return 'error';
  if (tests.some((t) => t.result === 'failed')) return 'failed';
  if (tests.every((t) => t.result === 'skipped')) return 'skipped';
  return 'passed';
}

function checkerWorker(payload) {
  const requestId = payload?.request_id || `chk_${nowSafeId()}`;
  const config = resolveCheckerConfig(payload);
  const warnings = [];
  let output = null;

  function finalize(result) {
    output = result;
    return output;
  }

  const repoConfig = resolveRepoConfig(payload, config);
  if (!repoConfig) {
    return finalize({
      request_id: requestId,
      contract_version: CONTRACT_VERSION,
      status: 'success',
      kind: 'validation',
      summary: 'Validation skipped because no configured workspace repo matched the request.',
      tests: [],
      overall_status: 'skipped',
      worktree_path: null,
      warnings: ['no configured workspace repo'],
      contract_flags: {
        reviewed: false,
        escalated: false,
        implementation_safe: false,
        pattern_only: false
      },
      telemetry_hints: {},
      error: null
    });
  }

  if (!fs.existsSync(repoConfig.localPath)) {
    return finalize({
      request_id: requestId,
      contract_version: CONTRACT_VERSION,
      status: 'error',
      kind: 'validation',
      summary: 'source workspace does not exist',
      overall_status: 'error',
      worktree_path: null,
      tests: [
        {
          name: 'workspace_check',
          result: 'failed',
          exit_code: null,
          duration_ms: 0,
          stdout_tail: [],
          stderr_tail: ['source workspace does not exist'],
          reason: 'source_repo_missing'
        }
      ],
      warnings,
      contract_flags: {
        reviewed: false,
        escalated: false,
        implementation_safe: false,
        pattern_only: false
      },
      telemetry_hints: {},
      error: {
        error_code: 'source_repo_missing',
        message: repoConfig.localPath
      }
    });
  }

  ensureDir(config.tempRoot);

  let worktree = null;
  const telemetry = {};

  try {
    if (isGitRepo(repoConfig.localPath)) {
      const mirror = ensureMirror(repoConfig, config);
      if (!mirror.ok) {
        return finalize({
          request_id: requestId,
          contract_version: CONTRACT_VERSION,
          status: 'error',
          kind: 'validation',
          summary: 'Checker mirror setup failed',
          overall_status: 'error',
          worktree_path: null,
          tests: [],
          warnings,
          contract_flags: {
            reviewed: false,
            escalated: false,
            implementation_safe: false,
            pattern_only: false
          },
          telemetry_hints: {},
          error: mirror.error
        });
      }

      telemetry.mirror_refresh_ms = mirror.mirror_refresh_ms;
      worktree = createWorktreeFromMirror(mirror.mirrorPath, repoConfig.defaultRef, config, requestId);
    } else {
      worktree = createCopyWorktree(repoConfig.localPath, config, requestId);
      warnings.push('source repo is not a git repository; using copy-based worktree fallback');
    }

    if (!worktree.ok) {
      return finalize({
        request_id: requestId,
        contract_version: CONTRACT_VERSION,
        status: 'error',
        kind: 'validation',
        summary: 'Checker worktree setup failed',
        overall_status: 'error',
        worktree_path: null,
        tests: [],
        warnings,
        contract_flags: {
          reviewed: false,
          escalated: false,
          implementation_safe: false,
          pattern_only: false
        },
        telemetry_hints: telemetry,
        error: worktree.error
      });
    }

    if (worktree.warning) warnings.push(worktree.warning);
    telemetry.worktree_setup_ms = worktree.worktree_setup_ms;

    const patchStart = Date.now();
    const materialize = materializeCandidateChange(worktree.worktreePath, payload);
    telemetry.patch_apply_ms = Date.now() - patchStart;

    if (materialize.status === 'error') {
      return finalize({
        request_id: requestId,
        contract_version: CONTRACT_VERSION,
        status: 'success',
        kind: 'validation',
        summary: `Validation skipped: ${materialize.warning}`,
        overall_status: 'skipped',
        worktree_path: worktree.worktreePath,
        tests: [],
        warnings: warnings.concat([materialize.warning]),
        contract_flags: {
          reviewed: false,
          escalated: false,
          implementation_safe: false,
          pattern_only: false
        },
        telemetry_hints: telemetry,
        error: null
      });
    }

    if (materialize.status === 'skipped') {
      return finalize({
        request_id: requestId,
        contract_version: CONTRACT_VERSION,
        status: 'success',
        kind: 'validation',
        summary: `Validation skipped: ${materialize.warning}`,
        overall_status: 'skipped',
        worktree_path: worktree.worktreePath,
        tests: [],
        warnings: warnings.concat([materialize.warning]),
        contract_flags: {
          reviewed: false,
          escalated: false,
          implementation_safe: false,
          pattern_only: false
        },
        telemetry_hints: telemetry,
        error: null
      });
    }

    const profile = payload?.check_profile || repoConfig.buildProfile || config.defaultProfile;
    const tests = runAllowlistedChecks(worktree.worktreePath, payload?.commands, {
      config,
      profile
    });

    const overallStatus = computeOverallStatus(tests);
    const status = overallStatus === 'error' ? 'error' : 'success';

    return finalize({
      request_id: requestId,
      contract_version: CONTRACT_VERSION,
      status,
      kind: 'validation',
      summary: `checker completed with overall status ${overallStatus}`,
      overall_status: overallStatus,
      worktree_path: worktree.worktreePath,
      tests,
      warnings,
      contract_flags: {
        reviewed: false,
        escalated: false,
        implementation_safe: overallStatus === 'passed',
        pattern_only: false
      },
      telemetry_hints: telemetry,
      error: null
    });
  } catch (err) {
    return finalize({
      request_id: requestId,
      contract_version: CONTRACT_VERSION,
      status: 'error',
      kind: 'validation',
      summary: 'Checker internal failure',
      overall_status: 'error',
      worktree_path: worktree?.worktreePath || null,
      tests: [],
      warnings: warnings.concat(['checker raised an internal exception']),
      contract_flags: {
        reviewed: false,
        escalated: false,
        implementation_safe: false,
        pattern_only: false
      },
      telemetry_hints: telemetry,
      error: {
        error_code: 'checker_internal_error',
        message: err instanceof Error ? err.message : String(err)
      }
    });
  } finally {
    const shouldKeepFailed = Boolean(config.keepFailedWorktrees);
    const keepRequested = Boolean(payload?.keep_worktree);
    if (worktree && typeof worktree.cleanup === 'function' && !keepRequested && !shouldKeepFailed) {
      try {
        worktree.cleanup();
        if (output && typeof output === 'object' && typeof output.worktree_path === 'string' && !output.worktree_path.includes('(cleaned)')) {
          output.worktree_path = `${output.worktree_path} (cleaned)`;
        }
      } catch {
        // cleanup best-effort
      }
    }
  }
}

module.exports = {
  ALLOWLIST: LEGACY_ALLOWLIST,
  DEFAULT_CONFIG,
  checkerWorker,
  computeOverallStatus,
  runAllowlistedChecks,
  resolveCheckerConfig,
  resolveRepoConfig,
  isSafeRelativePath,
  materializeCandidateChange,
  normalizeTargetFiles,
  extractPatchString,
  looksLikeUnifiedDiff
};
