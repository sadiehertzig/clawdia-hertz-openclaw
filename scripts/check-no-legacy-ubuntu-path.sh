#!/usr/bin/env bash
set -euo pipefail

OLD_BASE="/home/ubuntu"
OLD_PATH="$OLD_BASE/clawdia-hertz-openclaw"
REPOS=()

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--repo /path/to/repo]...

Fails if OLD_PATH appears in tracked files.
Defaults to:
  - /home/openclaw/clawdia-hertz-openclaw
  - /home/openclaw/copylobsta
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --repo" >&2
        exit 2
      fi
      REPOS+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ${#REPOS[@]} -eq 0 ]]; then
  REPOS=(
    "/home/openclaw/clawdia-hertz-openclaw"
    "/home/openclaw/copylobsta"
  )
fi

found=0

for repo in "${REPOS[@]}"; do
  if [[ ! -d "$repo/.git" ]]; then
    echo "Skip (not git repo): $repo"
    continue
  fi

  matches="$(git -c safe.directory="$repo" -C "$repo" grep -n --fixed-strings "$OLD_PATH" -- . || true)"
  if [[ -n "$matches" ]]; then
    found=1
    echo "[FAIL] Legacy path found in $repo"
    echo "$matches"
  else
    echo "[OK] No legacy path in $repo"
  fi
done

if [[ "$found" -ne 0 ]]; then
  exit 1
fi
