#!/usr/bin/env bash
set -euo pipefail
printf "%s\n" "$*" >>"$FAKE_COMPOSE_LOG"
joined=" $* "
if [[ "$joined" == *" image ls --digests "* ]]; then
  repo="${*: -1}"
  printf '%s\n' "$repo@sha256:current" "$repo@sha256:next" "$repo@sha256:old"
elif [[ "$joined" == *" network inspect kith-inn-shared "* && "${FAKE_DEPLOY_MODE:-success}" == shared-network ]]; then
  exit 1
elif [[ "$joined" == *" network create kith-inn-shared "* && "${FAKE_DEPLOY_MODE:-success}" == shared-network ]]; then
  exit 1
elif [[ "$joined" == *" stop kith-inn-v1-cms kith-inn-v1-be "* && "${FAKE_DEPLOY_MODE:-success}" == gate-fail ]]; then
  exit 1
elif [[ "$joined" == *" run --rm --no-deps kith-inn-v1-cms-migrate "* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != migration ]] || exit 1
elif [[ "$joined" == *" run --rm --no-deps kith-inn-v1-cms-provision "* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != provision ]] || exit 1
  echo '{"project":"kiv1","status":"reconciled","sellerId":1}'
fi
