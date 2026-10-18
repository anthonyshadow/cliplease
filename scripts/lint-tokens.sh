#!/usr/bin/env bash
# Token lint (docs/04-design-system.md §3.4). Exit 0: clean, prints nothing. Exit 1: violations printed.
# Exit 2: rg is missing or failed. Lines carrying a `// design-ok: <reason>` comment are the allowed §3.4 exceptions.
set -u
cd "$(dirname "$0")/.."

if ! command -v rg >/dev/null 2>&1; then
  echo "lint-tokens: ripgrep (rg) not found on PATH" >&2
  exit 2
fi

matches=$(rg -n --glob '!src/app/globals.css' --glob '!**/*.test.ts' \
  -e '#[0-9A-Fa-f]{3,8}\b' -e 'rgba?\(' -e '\bdark:' -e 'font-(medium|bold|light)' \
  -e '\b(bg|text|border|ring)-(primary|secondary|muted|accent|destructive|background|foreground|popover|card|input)\b' \
  -e '\b(zinc|slate|gray|neutral|stone|red|green|blue|sky|amber)-[0-9]{2,3}\b' -e 'shadow-(xs|sm|md|lg|xl)\b' \
  -e '\b(max-)?(sm|xl):[a-z0-9!\[(-]' -e '\b(min|max)-\[' -e '@container' \
  -e '\b100vw\b' -e '\bw-screen\b' -e 'overflow-x-hidden' \
  src/components src/app)
status=$?

case "$status" in
  0) ;;
  1) exit 0 ;;
  *)
    echo "lint-tokens: rg failed (exit $status)" >&2
    exit 2
    ;;
esac

violations=$(printf '%s\n' "$matches" | grep -v -F '// design-ok:')
if [ -n "$violations" ]; then
  printf '%s\n' "$violations"
  exit 1
fi
exit 0
