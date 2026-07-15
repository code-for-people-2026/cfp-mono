#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/write-kith-inn-compose-env.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
keys=(KITH_INN_RELEASE_SHA KITH_INN_CMS_IMAGE KITH_INN_CMS_OPS_IMAGE KITH_INN_BE_IMAGE KITH_INN_H5_IMAGE PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET KITH_INN_JWT_SECRET KITH_INN_CMS_INTERNAL_TOKEN KITH_INN_TRIAL_OPENID KITH_INN_WX_APPID KITH_INN_WX_SECRET KITH_INN_DEEPSEEK_API_KEY KITH_INN_BE_BASE_URL)
values=(); for key in "${keys[@]}"; do values+=("$key=value-$key"); done
tricky='literal${UNEXPANDED}'"'"'slash\end'
printf '%s\n' 'services:' '  test:' '    image: busybox' '    environment:' '      VALUE: ${KITH_INN_JWT_SECRET}' >"$tmp/compose.yml"
env "${values[@]}" KITH_INN_JWT_SECRET="$tricky" COMPOSE_ENV_OUTPUT="$tmp/env" bash "$script"
[[ "$(stat -f '%Lp' "$tmp/env" 2>/dev/null || stat -c '%a' "$tmp/env")" == 600 ]]
docker compose -f "$tmp/compose.yml" --env-file "$tmp/env" config --format json |
  jq -e --arg value "$tricky" '(.services.test.environment.VALUE | gsub("\\$\\$"; "$")) == $value' >/dev/null
rm "$tmp/env"
if env "${values[@]}" KITH_INN_JWT_SECRET=$'bad\nvalue' COMPOSE_ENV_OUTPUT="$tmp/env" bash "$script" 2>/dev/null; then exit 1; fi
[[ ! -e "$tmp/env" ]]
echo 'compose env writer tests passed'
