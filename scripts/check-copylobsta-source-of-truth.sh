#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINK_PATH="${COPYLOBSTA_LINK_PATH:-$ROOT_DIR/agents/clawdia/skills/copylobsta}"

detect_copylobsta_repo_dir() {
  local candidate
  for candidate in \
    "$ROOT_DIR/../copylobsta" \
    "$HOME/copylobsta"
  do
    if [[ -d "$candidate/.git" ]]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ -n "${COPYLOBSTA_REPO_DIR:-}" ]]; then
  COPYLOBSTA_DIR="$COPYLOBSTA_REPO_DIR"
elif COPYLOBSTA_DIR="$(detect_copylobsta_repo_dir)"; then
  :
else
  echo "Unable to locate copylobsta repo. Set COPYLOBSTA_REPO_DIR and retry." >&2
  exit 1
fi

TARGET_PATH="$COPYLOBSTA_DIR/agents/main/skills/copylobsta"

if [ ! -L "$LINK_PATH" ]; then
  echo "Expected $LINK_PATH to be a symlink into the copylobsta repo." >&2
  exit 1
fi

if [ ! -e "$TARGET_PATH" ]; then
  echo "Expected target path does not exist: $TARGET_PATH" >&2
  exit 1
fi

resolved_link="$(readlink -f "$LINK_PATH")"
resolved_target="$(readlink -f "$TARGET_PATH")"
if [ "$resolved_link" != "$resolved_target" ]; then
  echo "copylobsta symlink mismatch: $resolved_link != $resolved_target" >&2
  exit 1
fi

echo "[copylobsta-source] ok"
