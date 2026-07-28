#!/usr/bin/env bash
set -euo pipefail

output="${COMPOSE_ENV_OUTPUT:-}"
required_keys=(
  KITH_INN_V1_RELEASE_SHA KITH_INN_V1_CMS_IMAGE KITH_INN_V1_CMS_OPS_IMAGE KITH_INN_V1_BE_IMAGE
  PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET KITH_INN_V1_JWT_SECRET KITH_INN_V1_INTERNAL_TOKEN
  KITH_INN_V1_OPERATOR_OPENID KITH_INN_V1_WX_APPID KITH_INN_V1_WX_SECRET KITH_INN_V1_BE_BASE_URL
)
optional_keys=(KITH_INN_V1_PREVIOUS_JWT_SECRET KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN)
[[ -n "$output" ]] || { echo "compose env output is required" >&2; exit 1; }
content=""
for key in "${required_keys[@]}"; do
  value="${!key:-}"
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
    echo "compose env value is invalid: $key" >&2
    exit 1
  }
  value=${value//\'/\\\'}
  content+="$key='$value'"$'\n'
done
for key in "${optional_keys[@]}"; do
  value="${!key:-}"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
    echo "compose env value is invalid: $key" >&2
    exit 1
  }
  value=${value//\'/\\\'}
  content+="$key='$value'"$'\n'
done
umask 077
printf "%s" "$content" >"$output"
