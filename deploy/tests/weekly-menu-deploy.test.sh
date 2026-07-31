#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp "$root/deploy/tests/fake-weekly-menu-ingress.sh" "$tmp/curl"
chmod +x "$tmp/curl"
: >"$tmp/requests.log"
: >"$tmp/args.log"

PATH="$tmp:$PATH" FAKE_WEEKLY_LOG="$tmp/requests.log" \
  FAKE_WEEKLY_ARGS_LOG="$tmp/args.log" FAKE_WEEKLY_RELEASE="${sha:0:12}" \
  RELEASE_SHA="$sha" WEEKLY_MENU_URL=https://weekly-menu-api.codeforpeople.cn \
  WEEKLY_MENU_CONNECT_TO=weekly-menu-api.codeforpeople.cn:443:192.0.2.10:443 \
  SMOKE_RETRIES=1 SMOKE_SLEEP=0 \
  bash "$root/deploy/smoke-test.sh" weekly-menu >"$tmp/success.out"

grep -q 'Smoke tests passed' "$tmp/success.out"
grep -qx 'https://weekly-menu-api.codeforpeople.cn/api/health' "$tmp/requests.log"
grep -qx 'https://weekly-menu-api.codeforpeople.cn/api/ready' "$tmp/requests.log"
grep -qx 'https://weekly-menu-api.codeforpeople.cn/api/v1/weekly-menu/bootstrap' \
  "$tmp/requests.log"
[[ "$(grep -c -- '--connect-to weekly-menu-api.codeforpeople.cn:443:192.0.2.10:443' "$tmp/args.log")" == 3 ]]

if PATH="$tmp:$PATH" FAKE_WEEKLY_LOG="$tmp/requests.log" FAKE_WEEKLY_RELEASE=wrong \
  RELEASE_SHA="$sha" SMOKE_RETRIES=1 SMOKE_SLEEP=0 \
  bash "$root/deploy/smoke-test.sh" weekly-menu >/dev/null 2>"$tmp/release.err"; then
  exit 1
fi
grep -q 'weekly_menu_health_unavailable' "$tmp/release.err"

cat >"$tmp/runtime.env" <<'EOF'
WEEKLY_MENU_DATABASE_URL=postgresql://user:password@example.invalid:5432/weekly_menu
WEEKLY_MENU_RECIPES_BASE_URL=https://www.example.invalid
WEEKLY_MENU_WECHAT_APP_ID=example
WEEKLY_MENU_WECHAT_APP_SECRET=example
EOF
WEEKLY_MENU_IMAGE="example.invalid/cfp-weekly-menu-be:$sha" RELEASE_SHA="$sha" \
  WEEKLY_MENU_ENV_FILE="$tmp/runtime.env" \
  docker compose -f "$root/deploy/docker-compose.weekly-menu.yml" \
  config --format json >"$tmp/compose.json"
jq -e '
  .name == "cfp-weekly-menu" and
  .services["weekly-menu-be"].ports == [{
    mode: "ingress", target: 3304, published: "3304", protocol: "tcp", host_ip: "127.0.0.1"
  }] and
  (.services["weekly-menu-be"].environment.RELEASE_SHA == null) and
  (.services | has("website") | not)
' "$tmp/compose.json" >/dev/null
grep -q 'cfp-weekly-menu-be' "$tmp/compose.json"

grep -Fq 'proxy_pass http://127.0.0.1:3304;' \
  "$root/deploy/nginx.weekly-menu.example.conf"
grep -Fq 'server_name weekly-menu-api.codeforpeople.cn;' \
  "$root/deploy/nginx.weekly-menu.example.conf"
grep -Fq 'HEALTHCHECK' "$root/apps/weekly-menu-be/Dockerfile"
grep -Fq '/api/health' "$root/apps/weekly-menu-be/Dockerfile"
grep -Fq 'test -z "$(git status --porcelain)"' "$root/deploy/WEEKLY_MENU_RUNBOOK.md"
grep -Fq 'test "$release_sha" = "$(git rev-parse origin/main)"' \
  "$root/deploy/WEEKLY_MENU_RUNBOOK.md"
grep -Fq 'test "$actual_database" = study_weekly_menu' \
  "$root/deploy/WEEKLY_MENU_RUNBOOK.md"
grep -Fq 'SELECT current_database(), current_user' "$root/deploy/WEEKLY_MENU_RUNBOOK.md"
grep -Fq -- '--user "$(id -u):$(id -g)"' "$root/deploy/WEEKLY_MENU_RUNBOOK.md"
[[ "$(grep -c '^set -euo pipefail$' "$root/deploy/WEEKLY_MENU_RUNBOOK.md")" -ge 4 ]]

echo 'weekly menu deploy tests passed'
