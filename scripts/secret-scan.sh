#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCAN_HISTORY=true
SCAN_ARCHIVES=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-history)
      SCAN_HISTORY=false
      shift
      ;;
    --no-archives)
      SCAN_ARCHIVES=false
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/secret-scan.sh [--no-history] [--no-archives]

Scans for exposed secrets in:
1) Current working tree (tracked + untracked files, excluding .git internals)
2) Backup archives inside the repository (tar/tgz/zip if tools available)
3) Git history (all commits)

Exit code:
- 0 if no suspicious secret patterns are found
- 1 if any suspicious patterns are found
- 2 if required dependencies are missing
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if ! command -v rg >/dev/null 2>&1; then
  echo "secret-scan: ripgrep (rg) is required" >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo "secret-scan: git is required" >&2
  exit 2
fi

HIGH_RISK_PCRE='(?<![A-Za-z0-9])(ocw_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----|[0-9]{8,10}:[A-Za-z0-9_-]{35})'
NAMED_ASSIGN_PCRE='(?i)\b(OPENCLAW_GATEWAY_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|OPENCLAW_TELEGRAM_BOT_TOKEN|OPENCLAW_TELEGRAM_CHAT_ID)\b\s*=\s*["'"'"']?[A-Za-z0-9._:/+\-]{12,}'
ALLOWLIST_PCRE='YOUR_DEFAULT_BOT_TOKEN|YOUR_CHAT_ID|EXAMPLE_TOKEN|\[REDACTED\]|os\.environ\.get|\.env\.example|\.\.\.'

TMP_DIR="$(mktemp -d /tmp/secret-scan-XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

WORKTREE_RAW="$TMP_DIR/worktree.raw"
WORKTREE_HITS="$TMP_DIR/worktree.hits"
ARCHIVE_HITS="$TMP_DIR/archive.hits"
HISTORY_RAW="$TMP_DIR/history.raw"
HISTORY_HITS="$TMP_DIR/history.hits"

scan_text_tree() {
  local target="$1"
  local outfile="$2"
  rg -uu --hidden -n -P \
    -g '!.git' \
    -g '!node_modules' \
    -e "$HIGH_RISK_PCRE" \
    -e "$NAMED_ASSIGN_PCRE" \
    "$target" > "$outfile" || true
}

filter_allowlist() {
  local infile="$1"
  local outfile="$2"
  if [[ ! -s "$infile" ]]; then
    : > "$outfile"
    return
  fi
  rg -n -v -P "$ALLOWLIST_PCRE" "$infile" > "$outfile" || true
}

echo "secret-scan: scanning working tree"
scan_text_tree "." "$WORKTREE_RAW"
filter_allowlist "$WORKTREE_RAW" "$WORKTREE_HITS"

if [[ "$SCAN_ARCHIVES" == "true" ]]; then
  echo "secret-scan: scanning backup archives"
  : > "$ARCHIVE_HITS"
  while IFS= read -r archive; do
    [[ -n "$archive" ]] || continue
    extract_dir="$TMP_DIR/archive_extract"
    rm -rf "$extract_dir"
    mkdir -p "$extract_dir"

    if [[ "$archive" == *.zip ]]; then
      if ! command -v unzip >/dev/null 2>&1; then
        echo "secret-scan: skipping $archive (unzip not installed)" >&2
        continue
      fi
      unzip -q "$archive" -d "$extract_dir" || continue
    else
      tar -xf "$archive" -C "$extract_dir" || continue
    fi

    scan_text_tree "$extract_dir" "$TMP_DIR/archive.raw"
    filter_allowlist "$TMP_DIR/archive.raw" "$TMP_DIR/archive.filtered"
    if [[ -s "$TMP_DIR/archive.filtered" ]]; then
      while IFS= read -r line; do
        file_path="$(printf '%s\n' "$line" | awk -F: '{print $1}')"
        line_no="$(printf '%s\n' "$line" | awk -F: '{print $2}')"
        inner="${file_path#"$extract_dir"/}"
        printf '%s::%s:%s\n' "$archive" "$inner" "$line_no" >> "$ARCHIVE_HITS"
      done < "$TMP_DIR/archive.filtered"
    fi
  done < <(find . -type f \( -name '*.tar' -o -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' \) -not -path './.git/*' | sort)
else
  : > "$ARCHIVE_HITS"
fi

if [[ "$SCAN_HISTORY" == "true" ]]; then
  echo "secret-scan: scanning git history"
  HISTORY_REGEX='(ocw_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----|[0-9]{8,10}:[A-Za-z0-9_-]{35}|(OPENCLAW_GATEWAY_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|OPENCLAW_TELEGRAM_BOT_TOKEN|OPENCLAW_TELEGRAM_CHAT_ID)[[:space:]]*=)'
  : > "$HISTORY_RAW"
  while IFS= read -r rev; do
    git grep -nI -E "$HISTORY_REGEX" "$rev" -- . >> "$HISTORY_RAW" || true
  done < <(git rev-list --all)
  filter_allowlist "$HISTORY_RAW" "$TMP_DIR/history.filtered"
  if [[ -s "$TMP_DIR/history.filtered" ]]; then
    awk -F: '{print $1":"$2":"$3}' "$TMP_DIR/history.filtered" | sort -u > "$HISTORY_HITS"
  else
    : > "$HISTORY_HITS"
  fi
else
  : > "$HISTORY_HITS"
fi

WORKTREE_COUNT="$(wc -l < "$WORKTREE_HITS" | tr -d ' ')"
ARCHIVE_COUNT="$(wc -l < "$ARCHIVE_HITS" | tr -d ' ')"
HISTORY_COUNT="$(wc -l < "$HISTORY_HITS" | tr -d ' ')"
TOTAL_COUNT=$((WORKTREE_COUNT + ARCHIVE_COUNT + HISTORY_COUNT))

if [[ "$TOTAL_COUNT" -eq 0 ]]; then
  echo "secret-scan: clean (no suspicious secret patterns found)"
  exit 0
fi

echo "secret-scan: FOUND suspicious patterns"
echo "- worktree hits: $WORKTREE_COUNT"
echo "- archive hits: $ARCHIVE_COUNT"
echo "- history hits: $HISTORY_COUNT"

if [[ "$WORKTREE_COUNT" -gt 0 ]]; then
  echo
  echo "Worktree hit locations:"
  awk -F: '{print $1 ":" $2}' "$WORKTREE_HITS" | sort -u
fi

if [[ "$ARCHIVE_COUNT" -gt 0 ]]; then
  echo
  echo "Archive hit locations:"
  sort -u "$ARCHIVE_HITS"
fi

if [[ "$HISTORY_COUNT" -gt 0 ]]; then
  echo
  echo "History hit locations:"
  cat "$HISTORY_HITS"
fi

exit 1
