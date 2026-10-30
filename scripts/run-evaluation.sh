#!/bin/sh
# Runs the full evaluation in order of importance and records every model response,
# so `--cache replay` can reproduce the numbers later without an API key.
# Usage: scripts/run-evaluation.sh [routing|objectives|ablations ...]   (default: all stages)
set -eu

stages="${*:-routing objectives ablations}"
wants() { case " $stages " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

cd "$(dirname "$0")/../backend"
run() {
  echo "=== $*"
  npm run -s "$@" 2>&1 | grep -v "injected env" || true
}

# 1. Routing on held-out tasks: keyword baseline, batched router, one call per task.
if wants routing; then
run eval:routing -- --split heldout --variant keywords
run eval:routing -- --split heldout --variant batched --cache record
run eval:routing -- --split heldout --variant per-task --cache record
run eval:routing -- --split dev --variant per-task --cache record
fi

# 2. End-to-end on held-out objectives, two trials each (pass^2).
if wants objectives; then
  run eval:objectives -- --split heldout --repeat 2 --cache record
fi

# 3. Ablations on dev objectives: full system, then one optimization switched off at a time.
if wants ablations; then
  run eval:objectives -- --split dev --cache record
  for optimization in eventDrivenSupervision tieredReview scopedContext modelCascade; do
    run eval:objectives -- --split dev --disable "$optimization" --cache record
  done
fi

echo "=== done"
