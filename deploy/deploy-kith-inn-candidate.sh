#!/usr/bin/env bash
set -euo pipefail

root="${KITH_INN_REMOTE_ROOT:-$HOME/cfp-mono}"
compose_file="$root/deploy/docker-compose.kith-inn.prod.yml"
next_env="$root/.env.kith-inn.next"
current_env="$root/.env.kith-inn"
previous_env="$root/.env.kith-inn.previous"
compose_bin="${COMPOSE_BIN:-docker}"
smoke_bin="${SMOKE_BIN:-$root/deploy/smoke-test.sh}"
release_sha="${RELEASE_SHA:-}"
runtime=(kith-inn-cms kith-inn-be kith-inn-h5)
rollback_images=(kith-inn-cms-migrate "${runtime[@]}")
all_services=(kith-inn-cms-migrate kith-inn-cms-provision "${runtime[@]}")
fail() { printf '{"status":"failed","stage":"%s","recovery":"%s"}\n' "$1" "$2" >&2; exit 1; }
value() {
  local raw
  raw="$(sed -n "s/^$2=//p" "$1" | head -n 1)"
  if [[ "$raw" == \'*\' ]]; then
    raw="${raw:1:${#raw}-2}"
    sed "s/\\\\'/'/g" <<<"$raw"
  else printf '%s\n' "$raw"; fi
}
compose() { "$compose_bin" compose -f "$compose_file" --env-file "$1" "${@:2}"; }
smoke() {
  local result
  result="$(KITH_INN_ENV_FILE="$1" RELEASE_SHA="$2" KITH_INN_PROVISIONED_SELLER_ID="$3" \
    KITH_INN_TRIAL_OPENID="$(value "$1" KITH_INN_TRIAL_OPENID)" \
    KITH_INN_BE_BASE_URL="$(value "$1" KITH_INN_BE_BASE_URL)" "$smoke_bin" kith-inn)" || return
  jq -ce '
    select(.durationMs | type == "number" and . >= 0 and floor == .) |
    select(.checks == ["cms_liveness","cms_readiness","be_liveness","be_readiness","h5",
      "be_ingress_liveness","be_ingress_readiness","be_ingress_auth_boundary","operator","jwt","offerings"]) |
    select(.status == "passed" and .writeCount == 0 and .redactionPassed == true)
  ' <<<"$result"
}
recover() {
  local stage="$1" old_sha old_seller
  if [[ ! -f "$current_env" ]]; then
    compose "$next_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
    fail "$stage" candidate_stopped
  fi
  old_sha="$(value "$current_env" KITH_INN_RELEASE_SHA)"
  old_seller="$(value "$current_env" KITH_INN_PROVISIONED_SELLER_ID)"
  if [[ ! "$old_sha" =~ ^[0-9a-f]{40}$ || ! "$old_seller" =~ ^[0-9]+$ ]] ||
    ! compose "$current_env" pull "${rollback_images[@]}" >/dev/null 2>&1 ||
    ! compose "$current_env" up -d --no-deps "${runtime[@]}" >/dev/null 2>&1 ||
    ! smoke "$current_env" "$old_sha" "$old_seller" >/dev/null 2>&1; then
    compose "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
    fail "$stage" manual_data_recovery_required
  fi
  fail "$stage" rolled_back
}

[[ "$release_sha" =~ ^[0-9a-f]{40}$ && -f "$compose_file" && -f "$next_env" ]] ||
  fail preflight no_change
[[ "$(value "$next_env" KITH_INN_RELEASE_SHA)" == "$release_sha" ]] || fail preflight no_change
command -v "$compose_bin" >/dev/null || fail preflight no_change
command -v "$smoke_bin" >/dev/null || fail preflight no_change
command -v jq >/dev/null || fail preflight no_change
command -v curl >/dev/null || fail preflight no_change
command -v date >/dev/null || fail preflight no_change
if [[ -f "$current_env" ]]; then
  old_sha="$(value "$current_env" KITH_INN_RELEASE_SHA)"
  old_seller="$(value "$current_env" KITH_INN_PROVISIONED_SELLER_ID)"
  [[ "$old_sha" =~ ^[0-9a-f]{40}$ && "$old_seller" =~ ^[0-9]+$ ]] &&
    compose "$current_env" config --quiet >/dev/null 2>&1 || fail preflight no_change
fi

compose "$next_env" pull "${all_services[@]}" >/dev/null 2>&1 || fail pull no_change
migration_output="$(compose "$next_env" run --rm --no-deps kith-inn-cms-migrate 2>&1)" || recover migration
migration_head="$(sed -nE 's/^✓ cms migration head ([A-Za-z0-9_]+)$/\1/p' <<<"$migration_output" | tail -n 1)"
[[ -n "$migration_head" ]] || recover migration
provision_output="$(compose "$next_env" run --rm --no-deps kith-inn-cms-provision 2>&1)" || recover provision
seller_id="$(tail -n 1 <<<"$provision_output" | jq -er 'select(.project == "kith-inn") | .sellerId | tostring')" || recover provision
compose "$next_env" up -d --no-deps "${runtime[@]}" >/dev/null 2>&1 || recover rollout
smoke_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
smoke_result="$(smoke "$next_env" "$release_sha" "$seller_id" 2>/dev/null)" || recover smoke
smoke_evidence="$(jq -c --arg startedAt "$smoke_started_at" '. + {startedAt:$startedAt}' <<<"$smoke_result")" || recover smoke

printf 'KITH_INN_PROVISIONED_SELLER_ID=%s\n' "$seller_id" >>"$next_env" || recover persist
chmod 600 "$next_env" || recover persist
[[ ! -f "$current_env" ]] || cp -p "$current_env" "$previous_env" || recover persist
mv "$next_env" "$current_env" || recover persist
jq -cn --arg releaseSha "$release_sha" --arg migrationHead "$migration_head" --arg sellerId "$seller_id" \
  --argjson smokeEvidence "$smoke_evidence" \
  '{releaseSha:$releaseSha,migrationHead:$migrationHead,sellerId:$sellerId,smokeEvidence:$smokeEvidence,status:"passed"}'
