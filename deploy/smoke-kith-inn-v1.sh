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
[[ "$public_base" =~ ^https://[^/]+$ ]] || { echo "invalid public HTTPS BE origin" >&2; exit 1; }

curl -fsS --max-time 10 http://127.0.0.1:3312/api/health >/dev/null
curl -fsS --max-time 10 -H "x-internal-token: $token" http://127.0.0.1:3312/api/ready >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:3311/health >/dev/null
curl -fsS --max-time 15 "$public_base/health" >/dev/null
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$public_base/merchant/offerings")"
[[ "$status" == "401" ]] || { echo "merchant auth boundary returned $status" >&2; exit 1; }

jq -cn --arg releaseSha "${RELEASE_SHA:?RELEASE_SHA is required}" '{releaseSha:$releaseSha,status:"passed",writeCount:0,checks:["cms_liveness","cms_readiness","be_liveness","be_https","merchant_auth_boundary"]}'
