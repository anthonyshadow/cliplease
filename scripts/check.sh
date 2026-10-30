#!/usr/bin/env bash
# The local test runs (AGENTS.md §2, Test commands; owner answer Q-88): `full` runs every check and records a green run
# in .data/last-green (git-ignored, this machine only); `step0 [specs]` runs the fast checks, then integration and e2e
# only when the code differs from that green run.
#
# The fingerprint covers every tracked or new, non-ignored file except Markdown (notes like PROGRESS.md change after a
# run without changing what it proved), by path and content, in byte order whatever the shell's locale; then the
# environment, what git ignores but a run depends on: .env.test and .env.test.local (by content, never printed) and the
# Node and Bun versions. Every test can depend on the environment, so step0 runs them all when it changed.
set -euo pipefail
cd "$(dirname "$0")/.."

MARK=.data/last-green
SCHEMA_COPY=.data/schema-drift

environment() {
  {
    for file in .env.test .env.test.local; do
      if [ -f "$file" ]; then shasum -a 256 "$file"; fi
    done
    node -v
    bun -v
  } | shasum -a 256 | cut -d' ' -f1
}

# `$1`: the environment's hash, read once by the caller.
fingerprint() {
  {
    git ls-files -co --exclude-standard -z -- ':!*.md' |
      while IFS= read -r -d '' file; do
        if [ -f "$file" ]; then printf '%s\0' "$file"; fi
      done |
      LC_ALL=C sort -z | xargs -0 shasum -a 256
    printf '%s\n' "$1"
  } | shasum -a 256 | cut -d' ' -f1
}

recorded() { [ -f "$MARK" ] && sed -n "s/^$1=//p" "$MARK"; }

# A schema edit with no migration: drizzle-kit generate, run on a copy of drizzle/ (it takes only an out path inside the
# project, so the copy lives in the ignored .data), must report no schema changes. Without a terminal it can't ask
# whether a change is a rename, so it writes nothing and still exits 0: only that line proves the schema matches.
schema_matches_migrations() {
  local out
  rm -rf "$SCHEMA_COPY" && mkdir -p "$SCHEMA_COPY" && cp -R drizzle "$SCHEMA_COPY/drizzle"
  printf 'import base from "../../drizzle.config";\nexport default { ...base, out: "./%s/drizzle" };\n' \
    "$SCHEMA_COPY" >"$SCHEMA_COPY/drizzle.config.ts"
  if ! out=$(NODE_ENV=test bun run db:generate --config "$SCHEMA_COPY/drizzle.config.ts" 2>&1) ||
    [[ $out != *"No schema changes"* ]]; then
    printf '%s\n' "$out" >&2
    echo "check: src/db/schema has changes that no migration in drizzle/ holds: run bun run db:generate in a terminal (a rename needs your answer)." >&2
    return 1
  fi
  rm -rf "$SCHEMA_COPY"
}

fast() {
  bun run typecheck
  bun run lint
  bun run lint:tokens
  bun run lint:invariants
  schema_matches_migrations
  bun run test
}

full() {
  local setup print commit
  setup=$(environment)
  print=$(fingerprint "$setup")
  commit=$(git rev-parse HEAD)
  fast
  bun run test:int
  bun run test:e2e
  if [ "$(fingerprint "$(environment)")" != "$print" ]; then
    echo "check:full: the code changed during the run, so it isn't recorded as green. Run it again." >&2
    exit 1
  fi
  mkdir -p .data
  printf 'fingerprint=%s\nenvironment=%s\ncommit=%s\nat=%s\n' "$print" "$setup" "$commit" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$MARK"
  echo "check:full: green, recorded in $MARK (commit ${commit:0:7})."
}

step0() {
  local base setup
  base=$(recorded commit || true)
  fast
  setup=$(environment)
  if [ "$(recorded fingerprint)" = "$(fingerprint "$setup")" ]; then
    echo "check:step0: the code is the code of the last green full run (commit ${base:0:7}, $(recorded at)): integration and e2e not run again."
    return
  fi
  if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "check:step0: no green full run recorded on this machine: every integration test, then e2e."
    bun run test:int
  elif [ "$(recorded environment)" != "$setup" ]; then
    echo "check:step0: the test env files or the Node or Bun version changed since the last green full run: every integration test, then e2e."
    bun run test:int
  else
    echo "check:step0: the code changed since the last green full run (commit ${base:0:7}): the integration tests it reaches, then e2e."
    bun run test:int:changed "$base"
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
