#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$FAKE_COMPOSE_LOG"
env_file=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[$i]}" == --env-file ]] && env_file="${args[$((i + 1))]}"
done
image="$(sed -n 's/^WEBSITE_IMAGE=//p' "$env_file" 2>/dev/null | head -n 1)"
joined=" $* "
if [[ "$joined" == *" pull website " && "$image" == *":${CANDIDATE_SHA}" &&
  "${FAKE_DEPLOY_MODE:-success}" == pull ]]; then
  exit 1
fi
if [[ "$joined" == *" up -d --no-deps website " && "$image" == *":${CANDIDATE_SHA}" &&
  "${FAKE_DEPLOY_MODE:-success}" == rollout ]]; then
  exit 1
fi
