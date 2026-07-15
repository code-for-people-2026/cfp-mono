#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
repo="${REPOSITORY_DIR:-$(pwd)}"
cd "$repo"

write_targets() {
  local website="$1" kith_inn="$2"
  printf 'website=%s\nkith_inn=%s\n' "$website" "$kith_inn" >> "$GITHUB_OUTPUT"
  printf 'affected targets: website=%s kith-inn=%s\n' "$website" "$kith_inn"
}

if [[ "${GITHUB_EVENT_NAME:-}" != push ]]; then
  case "${DEPLOY_TARGET:-}" in
    website) write_targets true false ;;
    kith-inn) write_targets false true ;;
    *) echo "unsupported production deploy target" >&2; exit 1 ;;
  esac
  exit 0
fi

base="${DEPLOY_BASE:-}"
head="${GITHUB_SHA:-}"
if [[ -z "$base" || "$base" == 0000000000000000000000000000000000000000 ]] ||
  ! git cat-file -e "$base^{commit}" 2>/dev/null ||
  ! git cat-file -e "$head^{commit}" 2>/dev/null; then
  write_targets true true
  exit 0
fi

changed_files="$(git diff --name-only "$base" "$head")"
printf '%s\n' "$changed_files"
if grep -Eq '^(\.dockerignore|\.github/workflows/deploy-production\.yml|deploy/.*|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$' <<< "$changed_files"; then
  write_targets true true
  exit 0
fi

if [[ -n "${TURBO_BIN:-}" ]]; then
  turbo=("$TURBO_BIN")
else
  turbo=(pnpm dlx turbo@2.9.18)
fi

turbo_has_tasks() {
  local filters=() filter output
  for filter in "$@"; do filters+=("--filter=$filter"); done
  output="$("${turbo[@]}" run build "${filters[@]}" --dry-run=json)"
  printf '%s' "$output" | node -e '
    let text = "";
    process.stdin.on("data", chunk => text += chunk).on("end", () => {
      const start = text.indexOf("{");
      if (start < 0) throw new Error("Turbo dry run did not emit JSON.");
      process.stdout.write(JSON.parse(text.slice(start)).tasks.length > 0 ? "true" : "false");
    });
  '
}

website="$(turbo_has_tasks "@cfp/website...[$base]")"
kith_inn="$(turbo_has_tasks \
  "@cfp/cms...[$base]" \
  "@cfp/kith-inn-be...[$base]" \
  "@cfp/kith-inn-fe...[$base]")"
write_targets "$website" "$kith_inn"
