#!/usr/bin/env bash
set -euo pipefail

missing=()
for name in ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD \
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID KITH_INN_RDS_INSTANCE_ID \
  ECS_SSH_KEY ECS_HOST ECS_USER KITH_INN_DATABASE_URL KITH_INN_PAYLOAD_SECRET \
  KITH_INN_JWT_SECRET KITH_INN_CMS_INTERNAL_TOKEN KITH_INN_TRIAL_OPENID KITH_INN_WX_APPID \
  KITH_INN_WX_SECRET KITH_INN_DEEPSEEK_API_KEY KITH_INN_BE_BASE_URL; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if (( ${#missing[@]} )); then
  echo "configured=false" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "::notice::kith-inn deployment remains unconfigured; missing names: ${missing[*]}"
else
  echo "configured=true" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "Dedicated kith-inn configuration is present."
fi
