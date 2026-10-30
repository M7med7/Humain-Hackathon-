#!/bin/sh
# Runs the full evaluation in order of importance and records every model response,
# so `--cache replay` can reproduce the numbers later without an API key.
# Usage: scripts/run-evaluation.sh            (from the repository root)
set -eu

cd "$(dirname "$0")/../backend"
run() {
  echo "=== $*"
  npm run -s "$@" 2>&1 | grep -v "injected env" || true
}

# 1. Routing on held-out tasks: keyword baseline, batched router, one call per task.
run eval:routing -- --split heldout --variant keywords
run eval:routing -- --split heldout --variant batched --cache record
run eval:routing -- --split heldout --variant per-task --cache record
run eval:routing -- --split dev --variant per-task --cache record

# 2. End-to-end on held-out objectives, two trials each (pass^2).
run eval:objectives -- --split heldout --repeat 2 --cache record

# 3. Ablations on dev objectives: full system, then one optimization switched off at a time.
run eval:objectives -- --split dev --cache record
for optimization in eventDrivenSupervision tieredReview scopedContext modelCascade; do
  run eval:objectives -- --split dev --disable "$optimization" --cache record
done

echo "=== done"
