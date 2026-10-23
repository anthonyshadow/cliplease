#!/usr/bin/env bash
# The local test runs (AGENTS.md §2, Test commands; owner answer Q-88): `full` runs every check and records a green run
# in .data/last-green (git-ignored, this machine only); `step0 [specs]` runs the fast checks, then integration and e2e
# only when the code differs from that green run.
#
# The fingerprint covers every tracked or new, non-ignored file except Markdown (notes like PROGRESS.md change after a
# run without changing what it proved), by path and content, in byte order whatever the shell's locale. Env files are
# ignored by git, so a .env.test change isn't seen: run check:full after editing one.
set -euo pipefail
cd "$(dirname "$0")/.."

MARK=.data/last-green

fingerprint() {
  git ls-files -co --exclude-standard -z -- ':!*.md' |
    while IFS= read -r -d '' file; do
      if [ -f "$file" ]; then printf '%s\0' "$file"; fi
    done |
    LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1
}

recorded() { [ -f "$MARK" ] && sed -n "s/^$1=//p" "$MARK"; }

fast() {
  bun run typecheck
  bun run lint
  bun run lint:tokens
  bun run test
}

full() {
  local print commit
  print=$(fingerprint)
  commit=$(git rev-parse HEAD)
  fast
  bun run test:int
  bun run test:e2e
  if [ "$(fingerprint)" != "$print" ]; then
    echo "check:full: the code changed during the run, so it isn't recorded as green. Run it again." >&2
    exit 1
  fi
  mkdir -p .data
  printf 'fingerprint=%s\ncommit=%s\nat=%s\n' "$print" "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$MARK"
  echo "check:full: green, recorded in $MARK (commit ${commit:0:7})."
}

step0() {
  local base
  base=$(recorded commit || true)
  fast
  if [ "$(recorded fingerprint)" = "$(fingerprint)" ]; then
    echo "check:step0: the code is the code of the last green full run (commit ${base:0:7}, $(recorded at)): integration and e2e not run again."
    return
  fi
  if [ -n "$base" ] && git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "check:step0: the code changed since the last green full run (commit ${base:0:7}): the integration tests it reaches, then e2e."
    bun run test:int:changed "$base"
  else
    echo "check:step0: no green full run recorded on this machine: every integration test, then e2e."
    bun run test:int
  fi
  bun run test:e2e "$@"
}

case "${1:-}" in
  full) full ;;
  step0) shift && step0 "$@" ;;
  *)
    echo "usage: scripts/check.sh full | step0 [e2e spec …]" >&2
    exit 2
    ;;
esac
