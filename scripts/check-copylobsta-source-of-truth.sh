#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINK_PATH="$ROOT_DIR/agents/clawdia/skills/copylobsta"
TARGET_PATH="${COPYLOBSTA_REPO_DIR:-/home/openclaw/copylobsta}/agents/main/skills/copylobsta"

if [ ! -L "$LINK_PATH" ]; then
  echo "Expected $LINK_PATH to be a symlink into the copylobsta repo." >&2
  exit 1
fi

resolved_link="$(readlink -f "$LINK_PATH")"
resolved_target="$(readlink -f "$TARGET_PATH")"
if [ "$resolved_link" != "$resolved_target" ]; then
  echo "copylobsta symlink mismatch: $resolved_link != $resolved_target" >&2
  exit 1
fi

echo "[copylobsta-source] ok"
