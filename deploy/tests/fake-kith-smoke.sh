#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s|%s\n' "${KITH_INN_ENV_FILE:-}" "${KITH_INN_TRIAL_OPENID:-}" "${RELEASE_SHA:-}" >>"$FAKE_SMOKE_LOG"
if [[ "${FAKE_DEPLOY_MODE:-success}" == smoke && "${KITH_INN_ENV_FILE:-}" == *.next ]]; then exit 1; fi
if [[ "${FAKE_DEPLOY_MODE:-success}" == incompatible ]]; then exit 1; fi
echo '{"status":"passed","writeCount":0}'
