#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat >"$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_GH_LOG"
case "${1:-} ${2:-}" in
  'run list')
    count="$(cat "$FAKE_GH_LIST_COUNT" 2>/dev/null || printf 0)"
    count=$((count + 1))
    printf '%s' "$count" >"$FAKE_GH_LIST_COUNT"
    if (( count == 1 )); then
      printf '%s\n' '[{"databaseId":98,"status":"completed"},{"databaseId":99,"status":"in_progress"},{"databaseId":101,"status":"queued"}]'
    else
      printf '%s\n' '[{"databaseId":99,"status":"completed"},{"databaseId":101,"status":"queued"}]'
    fi
    ;;
  'run view')
    count="$(cat "$FAKE_GH_VIEW_COUNT" 2>/dev/null || printf 0)"
    count=$((count + 1))
    printf '%s' "$count" >"$FAKE_GH_VIEW_COUNT"
    if (( count == 1 )); then printf '%s\n' in_progress; else printf '%s\n' completed; fi
    ;;
  *)
    echo "unexpected gh invocation: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$tmp/bin/gh"

export FAKE_GH_LOG="$tmp/gh.log"
export FAKE_GH_LIST_COUNT="$tmp/list-count"
export FAKE_GH_VIEW_COUNT="$tmp/view-count"
PATH="$tmp/bin:$PATH" GH_TOKEN=test-token GITHUB_REPOSITORY=example/repo GITHUB_RUN_ID=100 \
  PRODUCTION_RUN_POLL_SECONDS=0 PRODUCTION_RUN_SETTLE_SECONDS=0 \
  bash "$root/deploy/wait-for-older-production-run.sh" deploy-production.yml >"$tmp/output"

grep -q 'run list .*--workflow deploy-production.yml' "$FAKE_GH_LOG"
grep -q '^run view 99 ' "$FAKE_GH_LOG"
! grep -q '^run view 98 ' "$FAKE_GH_LOG"
! grep -q '^run view 101 ' "$FAKE_GH_LOG"
[[ "$(cat "$FAKE_GH_VIEW_COUNT")" == 2 ]]
grep -q 'No older active deploy-production.yml run' "$tmp/output"

if PATH="$tmp/bin:$PATH" GH_TOKEN=test-token GITHUB_REPOSITORY=example/repo GITHUB_RUN_ID=invalid \
  bash "$root/deploy/wait-for-older-production-run.sh" deploy-production.yml >/dev/null 2>&1; then
  echo "非数字 run ID 应当阻止部署" >&2
  exit 1
fi
