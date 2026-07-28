#!/usr/bin/env bash
set -euo pipefail
printf "%s\n" "$*" >>"$FAKE_COMPOSE_LOG"
joined=" $* "
if [[ "$joined" == *" config --services "* ]]; then
  if [[ "$joined" == *".release.legacy/compose.yml"* ]]; then
    printf 'kith-inn-v1-be\n'
  else
    printf 'kith-inn-v1-cms\nkith-inn-v1-be\n'
  fi
elif [[ "$joined" == *" ps --filter "* && "${FAKE_DEPLOY_MODE:-success}" == legacy-query-fail ]]; then
  exit 1
elif [[ "$joined" == *" ps --filter label=com.docker.compose.service=kith-inn-cms "* && "${FAKE_DEPLOY_MODE:-success}" =~ ^legacy-(v1|recovery-fail)$ ]]; then
  printf 'aaaaaaaaaaaa\n'
elif [[ "$joined" == *" ps --filter label=com.docker.compose.service=kith-inn-be "* && "${FAKE_DEPLOY_MODE:-success}" =~ ^legacy-(v1|recovery-fail)$ ]]; then
  printf 'bbbbbbbbbbbb\n'
elif [[ "$joined" == *" ps --filter label=com.docker.compose.service=kith-inn-h5 "* && "${FAKE_DEPLOY_MODE:-success}" =~ ^legacy-(v1|recovery-fail)$ ]]; then
  printf 'cccccccccccc\n'
elif [[ "$joined" == *" ps --filter label=com.docker.compose.service=kith-inn-v1-cms "* && "${FAKE_DEPLOY_MODE:-success}" == orphan-v1 ]]; then
  printf 'dddddddddddd\n'
elif [[ "$joined" == *" ps --filter label=com.docker.compose.service=kith-inn-v1-be "* && "${FAKE_DEPLOY_MODE:-success}" == orphan-v1 ]]; then
  printf 'eeeeeeeeeeee\n'
elif [[ "$joined" == *" inspect --format "* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != legacy-recovery-fail ]] && printf 'healthy\n' || printf 'starting\n'
elif [[ "$joined" == *" image ls --digests "* ]]; then
  repo="${*: -1}"
  printf '%s\n' "$repo@sha256:current" "$repo@sha256:next" "$repo@sha256:old"
elif [[ "$joined" == *" network inspect kith-inn-shared "* && "${FAKE_DEPLOY_MODE:-success}" == shared-network ]]; then
  exit 1
elif [[ "$joined" == *" network create kith-inn-shared "* && "${FAKE_DEPLOY_MODE:-success}" == shared-network ]]; then
  exit 1
elif [[ "$joined" == *" stop kith-inn-v1-cms kith-inn-v1-be "* && "${FAKE_DEPLOY_MODE:-success}" == gate-fail ]]; then
  exit 1
elif [[ "$joined" == *" run --rm --no-deps kith-inn-v1-cms-migrate "* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != migration && "${FAKE_DEPLOY_MODE:-success}" != legacy-recovery-fail ]] || exit 1
elif [[ "$joined" == *" run --rm --no-deps kith-inn-v1-cms-provision "* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != provision ]] || exit 1
  echo '{"project":"kiv1","status":"reconciled","sellerId":1}'
fi
