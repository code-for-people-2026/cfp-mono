#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/verify-website-cutover.sh"
fake="$root/deploy/tests/fake-website-cutover-curl.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sha=0123456789abcdef0123456789abcdef01234567

run() {
  local cname_suffix="${2:-kunlunsl}"
  WEBSITE_ORIGIN_IP=192.0.2.10 WEBSITE_CDN_CNAME="www.example.w.$cname_suffix.com" \
    EXPECTED_RELEASE_SHA="$sha" CURL_BIN="$fake" FAKE_RELEASE_SHA="$sha" \
    FAKE_CUTOVER_MODE="$1" bash "$script"
}

run success >"$tmp/success"
jq -e --arg sha "$sha" '.status == "passed" and .releaseSha == $sha' "$tmp/success" >/dev/null
run success kunlunaq >"$tmp/success-kunlunaq"
jq -e --arg sha "$sha" '.status == "passed" and .releaseSha == $sha' "$tmp/success-kunlunaq" >/dev/null
run edge-301 kunlunaq >"$tmp/edge-301"
jq -e --arg sha "$sha" '.status == "passed" and .releaseSha == $sha' "$tmp/edge-301" >/dev/null
for invalid_cname in 192.0.2.10 origin.example.com; do
  if WEBSITE_ORIGIN_IP=192.0.2.10 WEBSITE_CDN_CNAME="$invalid_cname" \
    EXPECTED_RELEASE_SHA="$sha" CURL_BIN="$fake" FAKE_RELEASE_SHA="$sha" \
    bash "$script" >"$tmp/invalid-cname.out" 2>"$tmp/invalid-cname.err"; then
    printf 'expected invalid CDN CNAME %s to fail\n' "$invalid_cname" >&2
    exit 1
  fi
  grep -q 'must be an Alibaba Cloud CDN CNAME' "$tmp/invalid-cname.err"
done
for mode in release-mismatch bad-redirect edge-failure exposed; do
  if run "$mode" >"$tmp/$mode.out" 2>"$tmp/$mode.err"; then
    printf 'expected %s cutover verification to fail\n' "$mode" >&2
    exit 1
  fi
  grep -q 'website cutover verification failed:' "$tmp/$mode.err"
done
printf 'website cutover tests passed\n'
