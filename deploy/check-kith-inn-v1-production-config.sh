#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_SSH_KNOWN_HOSTS ECS_HOST ECS_USER PAYLOAD_DATABASE_URL
  KITH_INN_V1_PAYLOAD_SECRET KITH_INN_V1_JWT_SECRET KITH_INN_V1_INTERNAL_TOKEN
  KITH_INN_V1_OPERATOR_OPENID KITH_INN_V1_WX_APPID KITH_INN_V1_WX_SECRET
  KITH_INN_V1_BE_BASE_URL
)
missing=()
invalid=()
for name in "${required[@]}"; do
  value="${!name:-}"
  [[ -n "${value//[[:space:]]/}" ]] || missing+=("$name")
done
for name in KITH_INN_V1_PAYLOAD_SECRET KITH_INN_V1_JWT_SECRET KITH_INN_V1_INTERNAL_TOKEN KITH_INN_V1_OPERATOR_OPENID KITH_INN_V1_WX_APPID KITH_INN_V1_WX_SECRET; do
  value="${!name:-}"
  [[ ! "$value" =~ (change[-_]?(me)|replace[-_]?(me)|placeholder|example|test[-_]secret|dev[-_]secret) ]] || invalid+=("$name")
done
[[ "${KITH_INN_V1_BE_BASE_URL:-}" =~ ^https://[^/]+$ ]] || invalid+=(KITH_INN_V1_BE_BASE_URL)

if (( ${#missing[@]} == 0 && ${#invalid[@]} == 0 )); then
  echo "configured=true" >>"$GITHUB_OUTPUT"
  echo "kith-inn-v1 production deployment is configured."
else
  echo "configured=false" >>"$GITHUB_OUTPUT"
  echo "::error::kith-inn-v1 deployment is blocked; missing names: ${missing[*]:-none}; invalid names: ${invalid[*]:-none}"
  exit 1
fi
