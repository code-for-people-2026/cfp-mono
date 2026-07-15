#!/usr/bin/env bash
set -euo pipefail
output="${COMPOSE_ENV_OUTPUT:-}"
keys=(
  KITH_INN_RELEASE_SHA KITH_INN_CMS_IMAGE KITH_INN_CMS_OPS_IMAGE KITH_INN_BE_IMAGE KITH_INN_H5_IMAGE
  PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET KITH_INN_JWT_SECRET KITH_INN_CMS_INTERNAL_TOKEN
  KITH_INN_TRIAL_OPENID KITH_INN_WX_APPID KITH_INN_WX_SECRET KITH_INN_DEEPSEEK_API_KEY KITH_INN_BE_BASE_URL
)
[[ -n "$output" ]] || { echo 'compose env output is required' >&2; exit 1; }
content=""
for key in "${keys[@]}"; do
  value="${!key:-}"
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
    echo "compose env value is invalid: $key" >&2; exit 1;
  }
  value=${value//\'/\\\'}
  content+="$key='$value'"$'\n'
done
umask 077
printf '%s' "$content" >"$output"
