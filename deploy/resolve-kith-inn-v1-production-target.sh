#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
repo="${REPOSITORY_DIR:-$(pwd)}"
cd "$repo"

write_target() {
  printf 'deploy=%s\n' "$1" >>"$GITHUB_OUTPUT"
  printf 'kith-inn-v1 production affected=%s\n' "$1"
}

[[ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]] || { write_target true; exit 0; }
[[ "${GITHUB_EVENT_NAME:-}" == push ]] || {
  echo "kith-inn-v1 production deploy only supports push or workflow_dispatch" >&2; exit 1;
}

base="${DEPLOY_BASE:-}"
head="${GITHUB_SHA:-}"
if [[ -z "$base" || "$base" == 0000000000000000000000000000000000000000 ]] ||
  ! git cat-file -e "$base^{commit}" 2>/dev/null ||
  ! git cat-file -e "$head^{commit}" 2>/dev/null; then
  write_target true
  exit 0
fi

changed_files="$(git diff --name-only "$base" "$head")"
printf '%s\n' "$changed_files"
if grep -Eq '^(\.github/workflows/deploy-kith-inn-v1-production\.yml|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|deploy/create-rds-backup\.sh|deploy/resolve-kith-inn-v1-production-target\.sh)$' <<<"$changed_files" ||
  grep -Eq '^deploy/.*kith-inn-v1.*$' <<<"$changed_files"; then
  write_target true
  exit 0
fi

if [[ -n "${TURBO_BIN:-}" ]]; then turbo=("$TURBO_BIN"); else turbo=(pnpm dlx turbo@2.9.18); fi

output="$("${turbo[@]}" run build \
  --filter="@cfp/cms...[$base]" \
  --filter="@cfp/kith-inn-v1-be...[$base]" \
  --dry-run=json)"
affected="$(printf '%s' "$output" | node -e '
  const text = require("node:fs").readFileSync(0, "utf8"), start = text.indexOf("{");
  if (start < 0) throw new Error("Turbo dry run did not emit JSON.");
  process.stdout.write(JSON.parse(text.slice(start)).tasks.length > 0 ? "true" : "false");
')"
write_target "$affected"
