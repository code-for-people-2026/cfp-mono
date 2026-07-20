#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$FAKE_COMPOSE_LOG"
env_file=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[$i]}" == --env-file ]] && env_file="${args[$((i + 1))]}"
done
image="$(sed -n 's/^WEBSITE_IMAGE=//p' "$env_file" 2>/dev/null | head -n 1)"
candidate_image=false
[[ "$image" =~ :${CANDIDATE_SHA}(@sha256:[0-9a-f]{64})?$ ]] && candidate_image=true
joined=" $* "
if [[ "$joined" == *" pull website " && "$candidate_image" == true &&
  "${FAKE_DEPLOY_MODE:-success}" == pull ]]; then
  exit 1
fi
if [[ "$joined" == *" pull website " && "$candidate_image" == false &&
  "${FAKE_DEPLOY_MODE:-success}" == rollback-pull ]]; then
  exit 1
fi
if [[ "$joined" == *" up -d --no-deps website " && "$candidate_image" == true &&
  "${FAKE_DEPLOY_MODE:-success}" == rollout ]]; then
  exit 1
fi
