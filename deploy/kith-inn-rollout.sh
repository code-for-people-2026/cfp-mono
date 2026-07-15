#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${KITH_INN_RELEASE_DIR:-$HOME/cfp-kith/deploy}"
compose_file="${KITH_INN_COMPOSE_FILE:-$release_dir/docker-compose.kith-inn.prod.yml}"
current="$release_dir/.env.kith-inn"
candidate="$release_dir/.env.kith-inn.next"
previous="$release_dir/.env.kith-inn.previous"
smoke_script="${KITH_INN_SMOKE_SCRIPT:-$release_dir/smoke-test.sh}"
runtime=(kith-inn-cms kith-inn-be kith-inn-h5)
: "${RELEASE_SHA:?RELEASE_SHA is required}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ && -f "$compose_file" && -f "$candidate" && -f "$smoke_script" ]] || {
  echo '{"status":"failed","error":"invalid_rollout_configuration"}' >&2; exit 2;
}
for command in docker jq; do command -v "$command" >/dev/null || { echo "missing command: $command" >&2; exit 2; }; done

compose_for() { docker compose -f "$compose_file" --env-file "$1" "${@:2}"; }
rollback_runtime() {
  if [[ ! -f "$previous" ]]; then
    compose_for "$current" stop "${runtime[@]}" >/dev/null 2>&1 || true
    echo '{"status":"manual_recovery_required","error":"previous_release_unavailable"}' >&2
    return 70
  fi
  install -m 600 "$previous" "$current"
  if ! compose_for "$current" pull "${runtime[@]}" ||
     ! compose_for "$current" up -d --no-deps --wait --wait-timeout 120 "${runtime[@]}"; then
    compose_for "$current" stop "${runtime[@]}" >/dev/null 2>&1 || true
    echo '{"status":"manual_recovery_required","error":"schema_incompatible_or_rollback_unhealthy"}' >&2
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
