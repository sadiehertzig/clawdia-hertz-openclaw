#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# OpenClaw Daily Prompt Injection Scan
# Schedule: 3 AM ET daily via cron
# Action: report only — never modifies or deletes files
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── LOAD ENV ────────────────────────────────────────────────────
if [ -f /home/openclaw/.openclaw/.env ]; then
  set -a
  source /home/openclaw/.openclaw/.env
  set +a
fi

# ─── CONFIGURATION (edit these three values) ─────────────────────
TELEGRAM_TOKEN="${OPENCLAW_TELEGRAM_BOT_TOKEN:-YOUR_DEFAULT_BOT_TOKEN}"  # <-- REPLACE with bot token from config.json
CHAT_IDS=("${OPENCLAW_TELEGRAM_CHAT_ID:-YOUR_CHAT_ID}")                 # <-- REPLACE with chat ID(s), e.g. ("123456" "789012")
BASE_DIR="/home/openclaw/clawdia-hertz-openclaw"                        # <-- REPLACE if your install path differs

# ─── DERIVED PATHS (don't edit) ─────────────────────────────────
AGENT_DIRS=(
  "${BASE_DIR}/agents/clawdia"
  "${BASE_DIR}/agents/arbiter"
  "${BASE_DIR}/agents/librarian"
)

SCAN_DATE=$(date +"%Y-%m-%d")
SCAN_TIME=$(date +"%Y-%m-%d %H:%M:%S %Z")
YESTERDAY=$(date -d "yesterday" +"%Y-%m-%d" 2>/dev/null || date -v-1d +"%Y-%m-%d")

# ─── STATE ───────────────────────────────────────────────────────
ALERTS=""
ALERT_COUNT=0

# ─── FUNCTIONS ───────────────────────────────────────────────────
flag() {
  local file="$1" line="$2" reason="$3" content="$4"
  ALERT_COUNT=$((ALERT_COUNT + 1))
  content="$(redact_sensitive "$content")"
  # Truncate content to 200 chars to keep Telegram messages manageable
  if [ ${#content} -gt 200 ]; then
    content="${content:0:200}..."
  fi
  ALERTS="${ALERTS}
⚠ #${ALERT_COUNT}
File: ${file}
Line: ${line}
Reason: ${reason}
Content: ${content}
"
}

redact_sensitive() {
  local text="$1"

  # Mask common secret patterns before they can leave the machine.
  text="$(printf '%s' "$text" | sed -E 's/([?&](key|api_key|token)=)[^&[:space:]]+/\1[REDACTED]/Ig')"
  text="$(printf '%s' "$text" | sed -E 's/(Bearer[[:space:]]+)[A-Za-z0-9._-]+/\1[REDACTED]/Ig')"
  text="$(printf '%s' "$text" | sed -E 's/((api[_-]?key|token|secret|password)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+/\1[REDACTED]/Ig')"

  printf '%s' "$text"
}

send_telegram() {
  local msg="$1"
  if [ "${INJECTION_SCAN_NO_TELEGRAM:-0}" = "1" ]; then
    echo "[info] INJECTION_SCAN_NO_TELEGRAM=1; skipping outbound telegram message"
    return 0
  fi
  if [ -z "${TELEGRAM_TOKEN}" ] || [ "${TELEGRAM_TOKEN}" = "YOUR_DEFAULT_BOT_TOKEN" ]; then
    echo "[warn] TELEGRAM_TOKEN not configured; skipping outbound telegram message"
    return 0
  fi
  msg="$(redact_sensitive "$msg")"
  # Telegram limit is 4096 chars; truncate if needed
  if [ ${#msg} -gt 4000 ]; then
    msg="${msg:0:3990}
... [truncated — ${ALERT_COUNT} total findings]"
  fi
  for cid in "${CHAT_IDS[@]}"; do
    [ -n "${cid}" ] || continue
    [ "${cid}" = "YOUR_CHAT_ID" ] && continue
    curl -s --max-time 8 -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d chat_id="${cid}" \
      -d text="${msg}" \
      -d parse_mode="Markdown" > /dev/null 2>&1 || \
    # Fallback without markdown if formatting breaks the message
    curl -s --max-time 8 -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d chat_id="${cid}" \
      -d text="${msg}" > /dev/null 2>&1
  done
}

collect_prompt_files() {
  local dir="$1"
  find "$dir" \
    \( -type d \( \
      -name ".git" -o \
      -name "node_modules" -o \
      -name "dist" -o \
      -name "build" -o \
      -name ".venv" -o \
      -name "__pycache__" -o \
      -name ".mypy_cache" -o \
      -name ".pytest_cache" \
    \) -prune \) -o \
    \( -type f \( \
      -name "AGENTS.md" -o \
      -name "SOUL.md" -o \
      -name "USER.md" -o \
      -name "MEMORY.md" -o \
      -name "HEARTBEAT.md" -o \
      -name "TOOLS.md" -o \
      -name "SKILL.md" -o \
      -path "*/memory/*.md" \
    \) -print \)
}

collect_trusted_context_md_files() {
  local dir="$1"
  find "$dir" \
    \( -type d \( \
      -name ".git" -o \
      -name "node_modules" -o \
      -name "dist" -o \
      -name "build" -o \
      -name ".venv" -o \
      -name "__pycache__" -o \
      -name ".mypy_cache" -o \
      -name ".pytest_cache" \
    \) -prune \) -o \
    \( -type f \( \
      -name "AGENTS.md" -o \
      -name "SOUL.md" -o \
      -name "USER.md" -o \
      -name "MEMORY.md" -o \
      -name "HEARTBEAT.md" -o \
      -name "TOOLS.md" -o \
      -path "*/memory/*.md" \
    \) -print \)
}

collect_url_scan_files() {
  local dir="$1"
  find "$dir" \
    \( -type d \( \
      -name ".git" -o \
      -name "node_modules" -o \
      -name "dist" -o \
      -name "build" -o \
      -name ".venv" -o \
      -name "__pycache__" -o \
      -name ".mypy_cache" -o \
      -name ".pytest_cache" \
    \) -prune \) -o \
    \( -type f \( \
      -name "AGENTS.md" -o \
      -name "SOUL.md" -o \
      -name "USER.md" -o \
      -name "MEMORY.md" -o \
      -name "HEARTBEAT.md" -o \
      -name "TOOLS.md" \
    \) -print \)
}

# ═══════════════════════════════════════════════════════════════════
# SCAN 1: Injection keywords (case-insensitive)
# ═══════════════════════════════════════════════════════════════════
KEYWORDS=(
  "ignore previous"
  "ignore all instructions"
  "disregard.*instructions"
  "jailbreak"
  "override instructions"
  "new instructions"
  "forget your"
  "you are now"
  "WORKFLOW_AUTO"
  "pretend you are"
  "roleplay as"
  "bypass safety"
  "ignore all previous"
  "reveal.*system prompt"
  "show.*system prompt"
  "reveal your instructions"
  "act as if"
  "do not follow"
  "do anything now"
)

for dir in "${AGENT_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  mapfile -t prompt_files < <(collect_prompt_files "$dir")
  [ "${#prompt_files[@]}" -gt 0 ] || continue
  for kw in "${KEYWORDS[@]}"; do
    while IFS=: read -r file lineno content; do
      # Skip this scan script itself
      [[ "$file" == *"injection_scan"* ]] && continue
      flag "$file" "$lineno" "Injection keyword: '${kw}'" "$content"
    done < <(grep -ni "${kw}" "${prompt_files[@]}" 2>/dev/null || true)
  done
done

# ═══════════════════════════════════════════════════════════════════
# SCAN 2: Hidden unicode / zero-width characters
# ═══════════════════════════════════════════════════════════════════
# U+200B zero-width space, U+200C ZW non-joiner, U+200D ZW joiner,
# U+200E/F directional marks, U+FEFF BOM (mid-file), U+00AD soft
# hyphen, U+2060-2064 invisible operators
for dir in "${AGENT_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  mapfile -t prompt_files < <(collect_prompt_files "$dir")
  [ "${#prompt_files[@]}" -gt 0 ] || continue
  while IFS=: read -r file lineno content; do
    [[ "$file" == *"injection_scan"* ]] && continue
    flag "$file" "$lineno" "Hidden unicode / zero-width character" "$content"
  done < <(grep -nP '[\x{200B}\x{200C}\x{200D}\x{200E}\x{200F}\x{FEFF}\x{00AD}\x{2060}\x{2061}\x{2062}\x{2063}\x{2064}]' "${prompt_files[@]}" 2>/dev/null || true)
done

# ═══════════════════════════════════════════════════════════════════
# SCAN 3: Embedded JWT tokens (skip TOOLS.md — HA token expected)
# ═══════════════════════════════════════════════════════════════════
for dir in "${AGENT_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  mapfile -t prompt_files < <(collect_prompt_files "$dir")
  [ "${#prompt_files[@]}" -gt 0 ] || continue
  while IFS=: read -r file lineno content; do
    [[ "$file" == *"injection_scan"* ]] && continue
    basename_file=$(basename "$file")
    if [ "$basename_file" != "TOOLS.md" ]; then
      flag "$file" "$lineno" "Possible JWT token" "$content"
    fi
  done < <(grep -nP 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' "${prompt_files[@]}" 2>/dev/null || true)
done

# ═══════════════════════════════════════════════════════════════════
# SCAN 4: URLs not on the allowlist
# ═══════════════════════════════════════════════════════════════════
ALLOWED='(192\.168\.[0-9]+\.[0-9]+|localhost|127\.0\.0\.1|openclaw\.ai|github\.com|clawhub\.com|wpilib\.org|revrobotics\.com|ctr-electronics\.com|pathplanner\.dev|first\.org|firstinspires\.org|thebluealliance\.com|statbotics\.io|frc-events\.firstinspires\.org|example\.com|cgc\.umn\.edu)'

for dir in "${AGENT_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  mapfile -t context_files < <(collect_url_scan_files "$dir")
  [ "${#context_files[@]}" -gt 0 ] || continue
  while IFS=: read -r file lineno content; do
    [[ "$file" == *"injection_scan"* ]] && continue
    # Extract each URL from the line
    urls=$(echo "$content" | grep -oP 'https?://[^\s"'"'"'<>\)]+' || true)
    for url in $urls; do
      if ! echo "$url" | grep -qiP "$ALLOWED"; then
        flag "$file" "$lineno" "URL not on allowlist" "$url"
      fi
    done
  done < <(grep -nP 'https?://' "${context_files[@]}" 2>/dev/null || true)
done

# ═══════════════════════════════════════════════════════════════════
# SCAN 5: Unexpected .md files modified in last 24 hours
# ═══════════════════════════════════════════════════════════════════
EXPECTED_TOP_LEVEL="MEMORY.md TOOLS.md HEARTBEAT.md"

for dir in "${AGENT_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  agent_name=$(basename "$dir")

  while IFS= read -r md_file; do
    relative="${md_file#${dir}/}"
    is_expected=false

    # Known top-level files
    for exp in $EXPECTED_TOP_LEVEL; do
      [ "$relative" = "$exp" ] && is_expected=true && break
    done

    # memory/YYYY-MM-DD.md for today or yesterday
    [ "$relative" = "memory/${SCAN_DATE}.md" ] && is_expected=true
    [ "$relative" = "memory/${YESTERDAY}.md" ] && is_expected=true

    if [ "$is_expected" = false ]; then
      mod_time=$(stat -c '%y' "$md_file" 2>/dev/null || stat -f '%Sm' "$md_file" 2>/dev/null || echo "unknown")
      flag "$md_file" "N/A" "Unexpected .md modified (agent: ${agent_name})" "Last modified: ${mod_time}"
    fi
  done < <(collect_trusted_context_md_files "${dir}" | xargs -r -I{} find "{}" -mtime -1 2>/dev/null || true)
done

# ═══════════════════════════════════════════════════════════════════
# REPORT
# ═══════════════════════════════════════════════════════════════════
if [ "$ALERT_COUNT" -eq 0 ]; then
  send_telegram "🟢 Daily injection scan: all clear — ${SCAN_DATE}"
  echo "[${SCAN_TIME}] Scan complete: clean"
else
  HEADER="🔴 *OpenClaw Injection Scan — ${SCAN_DATE}*
Found *${ALERT_COUNT}* suspicious item(s):
"
  send_telegram "${HEADER}${ALERTS}"
  echo "[${SCAN_TIME}] Scan complete: ${ALERT_COUNT} finding(s) reported"
fi

exit 0
