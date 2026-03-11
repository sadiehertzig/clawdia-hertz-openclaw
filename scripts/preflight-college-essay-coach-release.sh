#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="$ROOT_DIR/agents/clawdia/skills/college-app-essay-coach"
VALIDATOR="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py"

echo "[1/3] run college-essay-coach content validation"
node "$ROOT_DIR/scripts/validate-college-essay-coach.js"

echo "[2/3] run skill schema/frontmatter validation"
python3 "$VALIDATOR" "$SKILL_DIR"

echo "[3/3] verify release files"
test -f "$SKILL_DIR/SKILL.md"
test -f "$SKILL_DIR/README.md"

cat <<'EOF'
College essay coach preflight checks passed.

Suggested release flow:
1) Run this script from a clean working tree.
2) Publish from agents/clawdia/skills/college-app-essay-coach with your ClawHub CLI command.
3) Commit publish metadata (_meta.json / .clawhub/origin.json) if generated.
EOF
