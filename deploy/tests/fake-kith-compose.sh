#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_COMPOSE_LOG"
env_file=""; args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  [[ "${args[$i]}" == --env-file ]] && env_file="${args[$((i+1))]}"
done
joined=" $* "
if [[ "$joined" == *" run --rm --no-deps kith-inn-cms-migrate "* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != migration ]] || exit 1
  echo '✓ cms migration head 20260714_105116_initial_cms_schema'
elif [[ "$joined" == *" run --rm --no-deps kith-inn-cms-provision "* ]]; then
  [[ "${FAKE_DEPLOY_MODE:-success}" != provision ]] || exit 1
  echo '{"project":"kith-inn","status":"reconciled","sellerId":1,"offeringCount":21}'
elif [[ "$joined" == *" up -d --no-deps "* && "$env_file" == *.next && "${FAKE_DEPLOY_MODE:-success}" == rollout ]]; then
  exit 1
elif [[ "$joined" == *" stop kith-inn-cms kith-inn-be kith-inn-h5 "* && "${FAKE_DEPLOY_MODE:-success}" == gate-fail ]]; then
  exit 1
elif [[ "$joined" == *" pull kith-inn-cms-migrate kith-inn-cms kith-inn-be kith-inn-h5 "* && "${FAKE_DEPLOY_MODE:-success}" == pull-fail ]]; then
  exit 1
fi
