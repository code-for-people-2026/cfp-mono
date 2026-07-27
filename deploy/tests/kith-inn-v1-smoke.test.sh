#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
printf "KITH_INN_V1_INTERNAL_TOKEN='internal-value'\nKITH_INN_V1_BE_BASE_URL='https://v1.codeforpeople.cn'\n" >"$tmp/env"
run_smoke() {
  KITH_INN_V1_ENV_FILE="$tmp/env" RELEASE_SHA="$sha" \
    CURL_BIN="$root/deploy/tests/fake-kith-v1-ready.sh" SLEEP_BIN=true \
    FAKE_CURL_LOG="$tmp/curl.log" FAKE_DEPLOY_MODE="$1" bash "$root/deploy/smoke-kith-inn-v1.sh"
}
run_smoke success | jq -e --arg sha "$sha" \
  '.status == "passed" and .releaseSha == $sha and .writeCount == 0 and (.checks | index("be_cms_readiness"))' >/dev/null
grep -qx 'http://127.0.0.1:3311/ready' "$tmp/curl.log"
grep -qx 'https://v1.codeforpeople.cn/ready' "$tmp/curl.log"
if run_smoke be-ready-fail >"$tmp/fail.out" 2>"$tmp/fail.err"; then exit 1; fi
! grep -q 'internal-value' "$tmp/fail.out" "$tmp/fail.err"
echo 'kith-inn-v1 smoke tests passed'
