#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${KITH_INN_RELEASE_DIR:-$HOME/cfp-kith/deploy}"
compose_file="${KITH_INN_COMPOSE_FILE:-$release_dir/docker-compose.kith-inn.prod.yml}"
current="$release_dir/.env.kith-inn"
candidate="$release_dir/.env.kith-inn.next"
previous="$release_dir/.env.kith-inn.previous"
smoke_script="${KITH_INN_SMOKE_SCRIPT:-$release_dir/smoke-test.sh}"
runtime=(kith-inn-cms kith-inn-be kith-inn-h5)
state_changed=false
: "${RELEASE_SHA:?RELEASE_SHA is required}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ && -f "$compose_file" && -f "$candidate" && -f "$smoke_script" ]] || {
  echo '{"status":"failed","error":"invalid_rollout_configuration"}' >&2; exit 2;
}
for command in docker jq; do command -v "$command" >/dev/null || { echo "missing command: $command" >&2; exit 2; }; done

compose_for() { docker compose -f "$compose_file" --env-file "$1" "${@:2}"; }
prune_stale_kith_images() {
  local work env_file images image repository image_id containers container rows
  work="$(mktemp -d)"
  : > "$work/repositories"
  : > "$work/protected-image-ids"

  for env_file in "$current" "$previous"; do
    [[ -f "$env_file" ]] || continue
    images="$(compose_for "$env_file" config --images)" || { rm -rf "$work"; return 1; }
    while IFS= read -r image; do
      [[ -n "$image" ]] || continue
      repository="${image%%@*}"
      printf '%s\n' "$repository" >> "$work/repositories"
      if image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)"; then
        printf '%s\n' "$image_id" >> "$work/protected-image-ids"
      fi
    done <<< "$images"
  done

  containers="$(docker ps -aq)" || { rm -rf "$work"; return 1; }
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    docker inspect --format '{{.Image}}' "$container" >> "$work/protected-image-ids"
  done <<< "$containers"
  sort -u -o "$work/repositories" "$work/repositories"
  sort -u -o "$work/protected-image-ids" "$work/protected-image-ids"

  rows="$(docker image ls --no-trunc --format '{{.Repository}} {{.ID}}')" || { rm -rf "$work"; return 1; }
  while read -r repository image_id; do
    [[ -n "$repository" && -n "$image_id" ]] || continue
    grep -Fxq "$repository" "$work/repositories" || continue
    grep -Fxq "$image_id" "$work/protected-image-ids" && continue
    docker image rm "$image_id"
  done <<< "$rows"
  rm -rf "$work"
}
rollback_runtime() {
  if [[ ! -f "$previous" ]]; then
    compose_for "$current" stop "${runtime[@]}" >/dev/null 2>&1 || true
    echo '{"status":"manual_recovery_required","error":"previous_release_unavailable"}' >&2
    return 70
  fi
  install -m 600 "$previous" "$current"
  if ! compose_for "$current" up -d --no-deps --wait --wait-timeout 120 "${runtime[@]}"; then
    if [[ "$state_changed" == true ]]; then
      compose_for "$current" stop "${runtime[@]}" >/dev/null 2>&1 || true
      error=schema_incompatible_or_rollback_unhealthy
    else
      error=pre_migration_rollback_verification_failed
    fi
    printf '{"status":"manual_recovery_required","error":"%s"}\n' "$error" >&2
    return 71
  fi
  echo '{"status":"rolled_back","scope":"application_runtime_only"}' >&2
}
on_error() {
  local original=$?
  trap - ERR
  set +e
  rollback_runtime
  local rollback_status=$?
  (( rollback_status == 0 )) && exit "$original"
  exit "$rollback_status"
}

[[ -f "$current" ]] && install -m 600 "$current" "$previous"
install -m 600 "$candidate" "$current"
rm -f "$candidate"
trap on_error ERR
compose_for "$current" pull
state_changed=true
compose_for "$current" up --no-deps --abort-on-container-exit \
  --exit-code-from kith-inn-cms-migrate kith-inn-cms-migrate
compose_for "$current" up --no-deps --abort-on-container-exit \
  --exit-code-from kith-inn-cms-provision kith-inn-cms-provision
seller_id="$(compose_for "$current" logs --no-color --no-log-prefix kith-inn-cms-provision | tail -n 1 | \
  jq -er 'select(.project == "kith-inn") | .sellerId | tostring | select(length > 0)')"
compose_for "$current" up -d --no-deps --wait --wait-timeout 120 kith-inn-cms
compose_for "$current" up -d --no-deps --wait --wait-timeout 120 kith-inn-be
compose_for "$current" up -d --no-deps --wait --wait-timeout 120 kith-inn-h5
openid="$(compose_for "$current" config --format json | \
  jq -er '.services["kith-inn-cms-provision"].environment.KITH_INN_TRIAL_OPENID | select(length > 0)')"
RELEASE_SHA="$RELEASE_SHA" KITH_INN_COMPOSE_FILE="$compose_file" KITH_INN_ENV_FILE="$current" \
  KITH_INN_PROVISIONED_SELLER_ID="$seller_id" KITH_INN_TRIAL_OPENID="$openid" \
  bash "$smoke_script" kith-inn
trap - ERR
prune_stale_kith_images
