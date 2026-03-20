#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ROOT="${CLAWDIA_SKILLS_SRC:-$ROOT_DIR/agents/clawdia/skills}"
DST_ROOT="${OPENCLAW_SKILLS_DIR:-$HOME/.openclaw/skills}"
SERVICE_NAME="${OPENCLAW_GATEWAY_SERVICE:-openclaw-gateway.service}"

CHECK_ONLY=false
RESTART_SERVICE=true
SKILLS=()

usage() {
  cat <<'EOF'
Usage: ./scripts/sync-clawdia-skills.sh [options]

Sync selected Clawdia skills from repository source into OpenClaw runtime.

Options:
  --check           Do not copy files; print drift and exit non-zero if drift exists
  --no-restart      Skip gateway restart after successful sync
  --skill NAME      Sync/check one skill (repeatable). Default:
                    autoimprove-tbc, three-body-council
  -h, --help        Show this message

Env overrides:
  CLAWDIA_SKILLS_SRC      Source root (default: ./agents/clawdia/skills)
  OPENCLAW_SKILLS_DIR     Destination root (default: ~/.openclaw/skills)
  OPENCLAW_GATEWAY_SERVICE Systemd user service name (default: openclaw-gateway.service)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=true
      shift
      ;;
    --no-restart)
      RESTART_SERVICE=false
      shift
      ;;
    --skill)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --skill" >&2
        exit 2
      fi
      SKILLS+=("$2")
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

if ! command -v rsync >/dev/null 2>&1; then
  echo "sync-clawdia-skills: rsync is required" >&2
  exit 2
fi

if [[ ${#SKILLS[@]} -eq 0 ]]; then
  SKILLS=("autoimprove-tbc" "three-body-council")
fi

if [[ ! -d "$SRC_ROOT" ]]; then
  echo "Source root not found: $SRC_ROOT" >&2
  exit 1
fi

mkdir -p "$DST_ROOT"

RSYNC_EXCLUDES=(
  --exclude=".git/"
  --exclude="__pycache__/"
  --exclude="*.pyc"
  --exclude=".DS_Store"
  --exclude="targets/"
  --exclude="_tg_offset"
)

DRIFT_FOUND=0

for skill in "${SKILLS[@]}"; do
  src="$SRC_ROOT/$skill/"
  dst="$DST_ROOT/$skill/"
  if [[ ! -d "$src" ]]; then
    echo "Missing source skill directory: $src" >&2
    exit 1
  fi
  mkdir -p "$dst"

  if [[ "$CHECK_ONLY" == "true" ]]; then
    output="$(rsync -ani --delete "${RSYNC_EXCLUDES[@]}" "$src" "$dst")"
    if [[ -n "$output" ]]; then
      DRIFT_FOUND=1
      echo "[drift] $skill"
      echo "$output"
    else
      echo "[ok] $skill in sync"
    fi
  else
    echo "[sync] $skill"
    rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$src" "$dst"
  fi
done

if [[ "$CHECK_ONLY" == "true" ]]; then
  if [[ "$DRIFT_FOUND" -ne 0 ]]; then
    echo "Drift detected between source and runtime skill directories." >&2
    exit 1
  fi
  echo "No drift detected."
  exit 0
fi

if [[ "$RESTART_SERVICE" == "true" ]]; then
  echo "[restart] $SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"
  echo "[status] $SERVICE_NAME"
  systemctl --user status "$SERVICE_NAME" --no-pager -l | sed -n '1,20p'
fi

echo "Skill sync complete."
