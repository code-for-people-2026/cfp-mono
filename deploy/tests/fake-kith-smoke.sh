#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s|%s\n' "${KITH_INN_ENV_FILE:-}" "${KITH_INN_TRIAL_OPENID:-}" "${RELEASE_SHA:-}" >>"$FAKE_SMOKE_LOG"
if [[ "${FAKE_DEPLOY_MODE:-success}" == smoke && "${KITH_INN_ENV_FILE:-}" == *.next ]]; then exit 1; fi
if [[ "${FAKE_DEPLOY_MODE:-success}" == incompatible ]]; then exit 1; fi
if [[ "${FAKE_DEPLOY_MODE:-success}" == invalid-smoke ]]; then
  echo '{"status":"passed","writeCount":1,"redactionPassed":true}'
else
  echo '{"status":"passed","writeCount":0,"redactionPassed":true,"durationMs":123,"checks":["cms_liveness","cms_readiness","be_liveness","be_readiness","h5","be_ingress_liveness","be_ingress_readiness","be_ingress_auth_boundary","operator","jwt","offerings"]}'
fi
