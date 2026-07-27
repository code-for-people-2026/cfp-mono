#!/usr/bin/env bash
set -euo pipefail
printf "%s\n" "$KITH_INN_V1_ENV_FILE" >>"$FAKE_SMOKE_LOG"
[[ "${FAKE_DEPLOY_MODE:-success}" != smoke || "$KITH_INN_V1_ENV_FILE" != *.next ]] || exit 1
echo '{"releaseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"passed","writeCount":0,"checks":[]}'
