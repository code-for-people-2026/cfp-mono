#!/usr/bin/env bash
set -euo pipefail

event="${1:?event is required}"
target="${2:-website}"
base="${3:-}"
head="${4:-HEAD}"
output="${GITHUB_OUTPUT:-/dev/stdout}"
emit() {
  printf 'website=%s\nkith_inn=%s\n' "$1" "$2" >> "$output"
  printf 'website affected: %s; kith-inn affected: %s\n' "$1" "$2"
}

if [[ "$event" != push ]]; then
  case "$target" in
    website) emit true false ;;
    kith-inn) emit false true ;;
    all) emit true true ;;
    *) echo "invalid production target: $target" >&2; exit 2 ;;
  esac
  exit 0
fi

if [[ ! "$base" =~ ^[0-9a-f]{40}$ || "$base" == 0000000000000000000000000000000000000000 ]] ||
   ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  emit true true
  exit 0
fi
changed="$(git diff --name-only "$base" "$head")"
printf '%s\n' "$changed"
if grep -Eq '^(\.github/workflows/deploy-production\.yml|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$' <<<"$changed"; then
  emit true true
  exit 0
fi

website=false
kith=false
grep -Eq '^deploy/(docker-compose\.prod\.yml|\.env\.website\.verify\.example)$' <<<"$changed" && website=true
grep -Eq '^deploy/(docker-compose\.kith-inn\.prod\.yml|\.env\.verify\.example|kith-inn-.*|create-rds-backup\.sh|write-smoke-marker\.sh|verify-kith-inn-.*)$' <<<"$changed" && kith=true
if grep -Eq '^deploy/(smoke-test\.sh|nginx\.example\.conf|production-targets\.sh)$' <<<"$changed"; then website=true; kith=true; fi

turbo_affected() {
  local json args=() filter
  json="$(mktemp)"
  for filter in "$@"; do args+=("--filter=$filter...[$base]"); done
  pnpm dlx turbo@2.6.3 run build "${args[@]}" --dry-run=json --no-daemon > "$json"
  node - "$json" <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync(process.argv[2], "utf8");
const start = text.indexOf("{");
if (start < 0) throw new Error("Turbo dry run did not emit JSON");
process.stdout.write(JSON.parse(text.slice(start)).tasks.length ? "true" : "false");
NODE
  rm -f "$json"
}
[[ "$website" == true ]] || website="$(turbo_affected @cfp/website)"
[[ "$kith" == true ]] || kith="$(turbo_affected @cfp/cms @cfp/kith-inn-be @cfp/kith-inn-fe)"
emit "$website" "$kith"
