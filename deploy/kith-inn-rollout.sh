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
action="${1:-rollout}"

compose_for() { docker compose -f "$compose_file" --env-file "$1" "${@:2}"; }
if [[ "$action" == gate-writes || "$action" == restore-runtime ]]; then
  command -v docker >/dev/null || { echo "missing command: docker" >&2; exit 2; }
  [[ -f "$compose_file" ]] || { echo "missing compose file" >&2; exit 2; }
  if [[ ! -f "$current" ]]; then
    echo '{"status":"skipped","reason":"active_runtime_unavailable"}'
    exit 0
  fi
  if [[ "$action" == gate-writes ]]; then
    if ! compose_for "$current" stop "${runtime[@]}"; then
      if ! compose_for "$current" up -d --no-deps --wait --wait-timeout 120 "${runtime[@]}"; then
        compose_for "$current" stop "${runtime[@]}" >/dev/null 2>&1 || true
        echo '{"status":"manual_recovery_required","error":"write_gate_recovery_failed"}' >&2
        exit 71
      fi
      echo '{"status":"failed","error":"write_gate_failed"}' >&2
      exit 72
    fi
    echo '{"status":"writes_gated"}'
    exit 0
  fi
  if ! compose_for "$current" up -d --no-deps --wait --wait-timeout 120 "${runtime[@]}"; then
    compose_for "$current" stop "${runtime[@]}" >/dev/null 2>&1 || true
    echo '{"status":"manual_recovery_required","error":"last_good_runtime_unhealthy"}' >&2
    exit 71
  fi
  echo '{"status":"last_good_runtime_restored"}'
  exit 0
fi
[[ "$action" == rollout ]] || { echo "unsupported rollout action" >&2; exit 2; }
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${KITH_INN_BE_BASE_URL:?KITH_INN_BE_BASE_URL is required}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ && -f "$compose_file" && -f "$candidate" && -f "$smoke_script" ]] || {
  echo '{"status":"failed","error":"invalid_rollout_configuration"}' >&2; exit 2;
}
chmod 600 "$candidate"
for command in docker jq; do command -v "$command" >/dev/null || { echo "missing command: $command" >&2; exit 2; }; done
prune_stale_kith_images() {
  local work env_file images image repository image_id containers container rows cleanup_failed=false
  work="$(mktemp -d)" || return 1
  if ! : > "$work/repositories" || ! : > "$work/protected-image-ids"; then
    rm -rf "$work"
    return 1
  fi

  for env_file in "$current" "$previous" "$candidate"; do
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
    if ! docker inspect --format '{{.Image}}' "$container" >> "$work/protected-image-ids"; then
      rm -rf "$work"
      return 1
    fi
  done <<< "$containers"
  if ! sort -u -o "$work/repositories" "$work/repositories" ||
     ! sort -u -o "$work/protected-image-ids" "$work/protected-image-ids"; then
    rm -rf "$work"
    return 1
  fi

  rows="$(docker image ls --no-trunc --format '{{.Repository}} {{.ID}}')" || { rm -rf "$work"; return 1; }
  while read -r repository image_id; do
    [[ -n "$repository" && -n "$image_id" ]] || continue
    grep -Fxq "$repository" "$work/repositories" || continue
    grep -Fxq "$image_id" "$work/protected-image-ids" && continue
    if ! docker image rm "$image_id"; then
      cleanup_failed=true
      printf 'stale kith image could not be removed: %s\n' "$image_id" >&2
    fi
  done <<< "$rows"
  rm -rf "$work"
  [[ "$cleanup_failed" == false ]]
}
rollback_runtime() {
  if [[ ! -f "$current" ]]; then
    compose_for "$candidate" stop "${runtime[@]}" >/dev/null 2>&1 || true
    echo '{"status":"manual_recovery_required","error":"last_good_release_unavailable"}' >&2
    return 70
  fi
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

trap on_error ERR
if ! prune_stale_kith_images; then
  echo '{"status":"warning","warning":"stale_image_cleanup_failed","phase":"pre_pull"}' >&2
fi
compose_for "$candidate" pull
state_changed=true
compose_for "$candidate" up --no-deps --abort-on-container-exit \
  --exit-code-from kith-inn-cms-migrate kith-inn-cms-migrate
compose_for "$candidate" up --no-deps --abort-on-container-exit \
  --exit-code-from kith-inn-cms-provision kith-inn-cms-provision
seller_id="$(compose_for "$candidate" logs --no-color --no-log-prefix kith-inn-cms-provision | tail -n 1 | \
  jq -er 'select(.project == "kith-inn") | .sellerId | tostring | select(length > 0)')"
compose_for "$candidate" up -d --no-deps --wait --wait-timeout 120 kith-inn-cms
compose_for "$candidate" up -d --no-deps --wait --wait-timeout 120 kith-inn-be
compose_for "$candidate" up -d --no-deps --wait --wait-timeout 120 kith-inn-h5
openid="$(compose_for "$candidate" config --format json | \
  jq -er '.services["kith-inn-cms-provision"].environment.KITH_INN_TRIAL_OPENID | select(length > 0)')"
RELEASE_SHA="$RELEASE_SHA" KITH_INN_BE_BASE_URL="$KITH_INN_BE_BASE_URL" \
  KITH_INN_COMPOSE_FILE="$compose_file" KITH_INN_ENV_FILE="$candidate" \
  KITH_INN_PROVISIONED_SELLER_ID="$seller_id" KITH_INN_TRIAL_OPENID="$openid" \
  bash "$smoke_script" kith-inn
trap - ERR
[[ -f "$current" ]] && install -m 600 "$current" "$previous"
mv -f "$candidate" "$current"
if ! prune_stale_kith_images; then
  echo '{"status":"warning","warning":"stale_image_cleanup_failed"}' >&2
fi
