#!/usr/bin/env bash
set -euo pipefail

echo "Building repository index..."

OUTPUT="docs/repo_index.md"

echo "# Repository Index" > $OUTPUT
echo "" >> $OUTPUT

echo "## Files" >> $OUTPUT
echo "" >> $OUTPUT

find . \
  -type f \
  -not -path "./.git/*" \
  -not -path "./node_modules/*" \
  | sort >> $OUTPUT

echo "" >> $OUTPUT
echo "Index generated at $(date -u)" >> $OUTPUT

echo "Repo index written to $OUTPUT"
