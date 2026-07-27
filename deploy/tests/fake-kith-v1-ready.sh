#!/usr/bin/env bash
set -euo pipefail
[[ "${FAKE_DEPLOY_MODE:-success}" != shared-cms ]] || exit 1
url="${*: -1}"
[[ -z "${FAKE_CURL_LOG:-}" ]] || printf '%s\n' "$url" >>"$FAKE_CURL_LOG"
if [[ "$url" == */merchant/offerings ]]; then
  printf '401'
elif [[ "$url" == */health || "$url" == */ready && "$url" != *:3304/* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != be-ready-fail || "$url" != */ready ]] || exit 1
  jq -cn --arg sha "${RELEASE_SHA:-development}" '{status:"ok",releaseSha:$sha}'
else
  printf '{"ok":true,"service":"cms"}\n'
fi
