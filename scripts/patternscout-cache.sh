#!/usr/bin/env bash
set -euo pipefail

QUERY="${1:-}"
if [ -z "$QUERY" ]; then
  echo "Usage: patternscout-cache.sh <query>"
  exit 1
fi

CACHE_DIR="tmp/patternscout-cache"
CACHE_FILE="$CACHE_DIR/cache.json"
TTL_SECONDS=$((24*60*60))

mkdir -p "$CACHE_DIR"

if [ ! -f "$CACHE_FILE" ]; then
  echo '{}' > "$CACHE_FILE"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo '{"status":"error","summary":"gh not found"}'
  exit 0
fi

KEY="$(printf '%s' "$QUERY" | sha1sum | awk '{print $1}')"
NOW="$(date -u +%s)"

RESULT="$(node - <<'NODE' "$CACHE_FILE" "$KEY" "$NOW" "$TTL_SECONDS"
const fs = require('fs');
const file = process.argv[2];
const key = process.argv[3];
const now = Number(process.argv[4]);
const ttl = Number(process.argv[5]);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
const hit = cache[key];
if (hit && typeof hit.ts === 'number' && (now - hit.ts) <= ttl) {
  process.stdout.write(JSON.stringify({ hit: true, payload: hit.payload }));
} else {
  process.stdout.write(JSON.stringify({ hit: false }));
}
NODE
)"

if [ "$(printf '%s' "$RESULT" | node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(o.hit?"1":"0")')" = "1" ]; then
  printf '%s\n' "$RESULT" | node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(JSON.stringify(o.payload));'
  exit 0
fi

PAYLOAD="$(gh search code "$QUERY" --language Java --limit 20 --json path,repository,url || true)"

node - <<'NODE' "$CACHE_FILE" "$KEY" "$NOW" "$PAYLOAD"
const fs = require('fs');
const file = process.argv[2];
const key = process.argv[3];
const now = Number(process.argv[4]);
const payloadRaw = process.argv[5] || '[]';
let cache = {};
try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
let payload;
try { payload = JSON.parse(payloadRaw); } catch { payload = []; }
cache[key] = { ts: now, payload };
fs.writeFileSync(file, JSON.stringify(cache, null, 2));
NODE

printf '%s\n' "$PAYLOAD"
