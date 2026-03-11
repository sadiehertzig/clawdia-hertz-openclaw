#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="$ROOT_DIR/agents/clawdia/skills/three-body-council"
VALIDATOR="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py"

echo "[1/5] validate runtime regression coverage"
node "$ROOT_DIR/scripts/validate-three-body-council.js"
node "$ROOT_DIR/scripts/validate-helpdesk-runtime.js"
node "$ROOT_DIR/scripts/validate-patternscout-improvements.js"

echo "[2/5] compile python skill module"
python3 -m py_compile "$SKILL_DIR/three_body_council.py"

echo "[3/5] validate skill frontmatter/schema"
python3 "$VALIDATOR" "$SKILL_DIR"

echo "[4/5] verify expected skill files"
test -f "$SKILL_DIR/SKILL.md"
test -f "$SKILL_DIR/three_body_council.py"

echo "[5/5] release preflight complete"
cat <<'EOF'
All local checks passed.

Suggested next steps:
1) Ensure your ClawHub auth/session is active.
2) Publish from the skill directory with your normal ClawHub CLI publish command.
3) Record the published version and owner/slug metadata.
EOF
