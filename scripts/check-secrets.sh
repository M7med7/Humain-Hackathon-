#!/bin/sh
# Blocks a commit when staged content looks like a credential.
# Install once per clone:  ln -sf ../../scripts/check-secrets.sh .git/hooks/pre-commit
# Scan everything tracked:  scripts/check-secrets.sh --all
set -eu

PATTERNS='sb_secret_[A-Za-z0-9_-]{8,}
sb_publishable_[A-Za-z0-9_-]{16,}
AIza[0-9A-Za-z_-]{30,}
AQ\.[0-9A-Za-z_-]{20,}
eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.
gh[pousr]_[A-Za-z0-9]{30,}
github_pat_[A-Za-z0-9_]{30,}
xox[abpr]-[A-Za-z0-9-]{10,}
hooks\.slack\.com/services/T[A-Z0-9]+
-----BEGIN [A-Z ]*PRIVATE KEY-----
[a-z0-9]{20}\.supabase\.co'

if [ "${1:-}" = "--all" ]; then
  files=$(git ls-files)
  show() { cat "$1"; }
else
  files=$(git diff --cached --name-only --diff-filter=ACMR)
  show() { git show ":$1"; }
fi

found=0
for file in $files; do
  case "$file" in
    .env.example) ;;
    .env|.env.*|*/.env|*/.env.*)
      echo "refusing to commit environment file: $file"
      found=1
      continue
      ;;
  esac
  [ -f "$file" ] || continue
  matches=$(show "$file" | grep -I -n -E "$(printf '%s' "$PATTERNS" | paste -sd'|' -)" || true)
  if [ -n "$matches" ]; then
    echo "possible secret in $file:"
    printf '%s\n' "$matches" | cut -d: -f1 | sed 's/^/  line /'
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo "commit blocked: move secrets to an ignored .env file"
  exit 1
fi
