#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_HOST ECS_USER PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET
  KITH_INN_JWT_SECRET KITH_INN_CMS_INTERNAL_TOKEN KITH_INN_TRIAL_OPENID
  KITH_INN_WX_APPID KITH_INN_WX_SECRET KITH_INN_DEEPSEEK_API_KEY KITH_INN_BE_BASE_URL
)
missing=()
for name in "${required[@]}"; do
  value="${!name:-}"
  [[ -n "${value//[[:space:]]/}" ]] || missing+=("$name")
done

if (( ${#missing[@]} == 0 )); then
  echo 'configured=true' >> "$GITHUB_OUTPUT"
  echo 'kith-inn production deployment is configured.'
else
  echo 'configured=false' >> "$GITHUB_OUTPUT"
  echo "::notice::kith-inn production deployment is disabled; missing configuration names: ${missing[*]}"
fi
