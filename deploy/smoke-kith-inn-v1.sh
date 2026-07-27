#!/usr/bin/env bash
set -euo pipefail

env_file="${KITH_INN_V1_ENV_FILE:?KITH_INN_V1_ENV_FILE is required}"
value() {
  local raw
  raw="$(sed -n "s/^$2=//p" "$1" | head -n 1)"
  raw="${raw#\'}"
  raw="${raw%\'}"
  printf "%s" "${raw//\\\'/\'}"
}
token="$(value "$env_file" KITH_INN_V1_INTERNAL_TOKEN)"
public_base="$(value "$env_file" KITH_INN_V1_BE_BASE_URL)"
release_sha="${RELEASE_SHA:?RELEASE_SHA is required}"
curl_bin="${CURL_BIN:-curl}"
sleep_bin="${SLEEP_BIN:-sleep}"
[[ "$public_base" =~ ^https://[^/]+$ ]] || { echo "invalid public HTTPS BE origin" >&2; exit 1; }

assert_be_health() {
  local url="$1"
  for _ in $(seq 1 30); do
    if "$curl_bin" -fsS --max-time 15 "$url" 2>/dev/null |
      jq -e --arg sha "$release_sha" '.status == "ok" and .releaseSha == $sha' >/dev/null; then return 0; fi
    "$sleep_bin" 2
  done
  return 1
}

for _ in $(seq 1 30); do
  if "$curl_bin" -fsS --max-time 10 http://127.0.0.1:3304/api/health >/dev/null 2>&1 &&
    "$curl_bin" -fsS --max-time 10 -H "x-internal-token: $token" http://127.0.0.1:3304/api/ready >/dev/null 2>&1; then break; fi
  "$sleep_bin" 2
done
"$curl_bin" -fsS --max-time 10 http://127.0.0.1:3304/api/health >/dev/null
"$curl_bin" -fsS --max-time 10 -H "x-internal-token: $token" http://127.0.0.1:3304/api/ready >/dev/null
assert_be_health http://127.0.0.1:3311/health
assert_be_health http://127.0.0.1:3311/ready
assert_be_health "$public_base/health"
assert_be_health "$public_base/ready"
status="$("$curl_bin" -sS -o /dev/null -w '%{http_code}' --max-time 15 "$public_base/merchant/offerings")"
[[ "$status" == "401" ]] || { echo "merchant auth boundary returned $status" >&2; exit 1; }

jq -cn --arg releaseSha "$release_sha" '{releaseSha:$releaseSha,status:"passed",writeCount:0,checks:["cms_liveness","cms_readiness","be_liveness","be_cms_readiness","be_https","be_https_cms_readiness","merchant_auth_boundary"]}'
