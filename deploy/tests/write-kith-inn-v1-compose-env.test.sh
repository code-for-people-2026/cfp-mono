#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/write-kith-inn-v1-compose-env.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
keys=(KITH_INN_V1_RELEASE_SHA KITH_INN_V1_CMS_IMAGE KITH_INN_V1_CMS_OPS_IMAGE KITH_INN_V1_BE_IMAGE PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET KITH_INN_V1_JWT_SECRET KITH_INN_V1_INTERNAL_TOKEN KITH_INN_V1_OPERATOR_OPENID KITH_INN_V1_WX_APPID KITH_INN_V1_WX_SECRET KITH_INN_V1_BE_BASE_URL)
values=(); for key in "${keys[@]}"; do values+=("$key=value-$key"); done

env "${values[@]}" COMPOSE_ENV_OUTPUT="$tmp/env" bash "$script"
[[ "$(stat -c '%a' "$tmp/env" 2>/dev/null || stat -f '%Lp' "$tmp/env")" == 600 ]]
grep -qx "KITH_INN_V1_PREVIOUS_JWT_SECRET=''" "$tmp/env"
grep -qx "KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN=''" "$tmp/env"

rm "$tmp/env"
if env "${values[@]}" KITH_INN_V1_PREVIOUS_JWT_SECRET=$'bad\nvalue' \
  COMPOSE_ENV_OUTPUT="$tmp/env" bash "$script" 2>/dev/null; then exit 1; fi
[[ ! -e "$tmp/env" ]]

missing=(); for entry in "${values[@]}"; do [[ "$entry" == KITH_INN_V1_WX_SECRET=* ]] || missing+=("$entry"); done
if env "${missing[@]}" COMPOSE_ENV_OUTPUT="$tmp/env" bash "$script" 2>/dev/null; then exit 1; fi
[[ ! -e "$tmp/env" ]]
echo 'kith-inn-v1 compose env writer tests passed'
