#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_SSH_KNOWN_HOSTS ECS_HOST ECS_USER DATABASE_URL PAYLOAD_SECRET
  NEXT_PUBLIC_SITE_URL DEEPSEEK_API_KEY
)
missing=()
for name in "${required[@]}"; do
  value="${!name:-}"
  [[ -n "${value//[[:space:]]/}" ]] || missing+=("$name")
done

if (( ${#missing[@]} > 0 )); then
  printf 'website production configuration is missing: %s\n' "${missing[*]}" >&2
  exit 1
fi
if [[ "$NEXT_PUBLIC_SITE_URL" != 'https://www.codeforpeople.cn' ]]; then
  echo 'website production configuration is invalid: NEXT_PUBLIC_SITE_URL must use the canonical production URL' >&2
  exit 1
fi
echo 'configured=true' >> "$GITHUB_OUTPUT"
echo 'website production deployment is configured.'
