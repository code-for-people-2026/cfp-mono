#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$repo/deploy/tests/fake-website-ingress.sh" "$tmp/curl"
chmod +x "$tmp/curl"

: >"$tmp/ingress.log"
: >"$tmp/args.log"
PATH="$tmp:$PATH" FAKE_INGRESS_LOG="$tmp/ingress.log" FAKE_INGRESS_ARGS_LOG="$tmp/args.log" \
  FAKE_INGRESS_SHA="$sha" RELEASE_SHA="$sha" SITE_URL=https://www.codeforpeople.cn \
  SITE_CONNECT_TO=www.codeforpeople.cn:443:47.107.114.112:443 SMOKE_RETRIES=1 SMOKE_SLEEP=0 \
  bash "$repo/deploy/smoke-test.sh" website >"$tmp/success.out"
grep -q 'Smoke tests passed' "$tmp/success.out"
grep -qx 'https://www.codeforpeople.cn/' "$tmp/ingress.log"
grep -qx 'https://www.codeforpeople.cn/api/health' "$tmp/ingress.log"
grep -qx 'https://www.codeforpeople.cn/api/ready' "$tmp/ingress.log"
if [[ "$(grep -c -- '--connect-to www.codeforpeople.cn:443:47.107.114.112:443' "$tmp/args.log")" != 3 ]]; then
  echo 'website smoke must connect directly to the ECS origin' >&2
  exit 1
fi

if PATH="$tmp:$PATH" FAKE_INGRESS_LOG="$tmp/ingress.log" FAKE_INGRESS_SHA="$(printf 'b%.0s' {1..40})" \
  RELEASE_SHA="$sha" SITE_URL=https://www.codeforpeople.cn \
  SITE_CONNECT_TO=www.codeforpeople.cn:443:47.107.114.112:443 SMOKE_RETRIES=1 SMOKE_SLEEP=0 \
  bash "$repo/deploy/smoke-test.sh" website >/dev/null 2>"$tmp/mismatch.err"; then exit 1; fi
grep -q 'website_health_unavailable' "$tmp/mismatch.err"

if PATH="$tmp:$PATH" FAKE_INGRESS_LOG="$tmp/ingress.log" FAKE_INGRESS_SHA="$sha" \
  RELEASE_SHA=short SITE_URL=https://www.codeforpeople.cn \
  SITE_CONNECT_TO=www.codeforpeople.cn:443:47.107.114.112:443 SMOKE_RETRIES=1 SMOKE_SLEEP=0 \
  bash "$repo/deploy/smoke-test.sh" website >/dev/null 2>"$tmp/invalid.err"; then exit 1; fi
grep -q 'invalid_configuration' "$tmp/invalid.err"
echo "website smoke tests passed"
