#!/usr/bin/env bash
set -euo pipefail

root="${KITH_INN_REMOTE_ROOT:-$HOME/cfp-mono}"
project_dir="$root/deploy"
legacy_compose="$project_dir/docker-compose.kith-inn.prod.yml"
next_compose="$legacy_compose.next"
next_env="$root/.env.kith-inn.next"
legacy_current_env="$root/.env.kith-inn"
legacy_previous_env="$root/.env.kith-inn.previous"
release_store="$root/.kith-inn-releases"
current_pointer="$root/.kith-inn-current"
previous_pointer="$root/.kith-inn-previous"
gate_marker="$root/.kith-inn-write-gate"
compose_bin="${COMPOSE_BIN:-docker}"
smoke_bin="${SMOKE_BIN:-$root/deploy/smoke-test.sh}"
release_sha="${RELEASE_SHA:-}"
action="${1:-deploy}"
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
read_release_pointer() {
  local pointer="$1" stored_release
  IFS= read -r stored_release <"$pointer" || return 1
  [[ "$(wc -l <"$pointer")" -eq 1 && "$(dirname "$stored_release")" == "$release_store" &&
    "$(basename "$stored_release")" == .release.* && -d "$stored_release" &&
    -f "$stored_release/.env.kith-inn" && -f "$stored_release/docker-compose.kith-inn.prod.yml" ]] || return 1
  printf '%s\n' "$stored_release"
}
resolve_releases() {
  current_release= previous_release=
  current_env="$legacy_current_env"; current_compose="$legacy_compose"
  if [[ -e "$current_pointer" ]]; then
    current_release="$(read_release_pointer "$current_pointer")" || fail preflight invalid_current_pointer
    current_env="$current_release/.env.kith-inn"
    current_compose="$current_release/docker-compose.kith-inn.prod.yml"
  fi
  if [[ -e "$previous_pointer" ]]; then
    previous_release="$(read_release_pointer "$previous_pointer")" || fail preflight invalid_previous_pointer
  fi
}
resolve_releases
compose_file_for() {
  [[ "$1" == "$next_env" ]] && printf '%s\n' "$next_compose" || printf '%s\n' "$current_compose"
}
compose() {
  local env_file="$1" selected_compose
  shift
  selected_compose="$(compose_file_for "$env_file")"
  "$compose_bin" compose --project-directory "$project_dir" -f "$selected_compose" --env-file "$env_file" "$@"
}
smoke() {
  local result
  result="$(KITH_INN_COMPOSE_FILE="$(compose_file_for "$1")" KITH_INN_PROJECT_DIRECTORY="$project_dir" \
    KITH_INN_ENV_FILE="$1" RELEASE_SHA="$2" KITH_INN_PROVISIONED_SELLER_ID="$3" \
    KITH_INN_TRIAL_OPENID="$(value "$1" KITH_INN_TRIAL_OPENID)" \
    KITH_INN_BE_BASE_URL="$(value "$1" KITH_INN_BE_BASE_URL)" "$smoke_bin" kith-inn)" || return
  jq -ce '
    select(.durationMs | type == "number" and . >= 0 and floor == .) |
    select(.checks == ["cms_liveness","cms_readiness","be_liveness","be_readiness","h5",
      "be_ingress_liveness","be_ingress_readiness","be_ingress_auth_boundary","operator","jwt","offerings"]) |
    select(.status == "passed" and .writeCount == 0 and .redactionPassed == true)
  ' <<<"$result"
}
validate_current() {
  local old_sha old_seller
  [[ -f "$current_env" && -f "$current_compose" ]] || return 1
  old_sha="$(value "$current_env" KITH_INN_RELEASE_SHA)"
  old_seller="$(value "$current_env" KITH_INN_PROVISIONED_SELLER_ID)"
  [[ "$old_sha" =~ ^[0-9a-f]{40}$ && "$old_seller" =~ ^[0-9]+$ ]] &&
    compose "$current_env" config --quiet >/dev/null 2>&1
}
restore_current() {
  local old_sha old_seller
  validate_current || return 1
  old_sha="$(value "$current_env" KITH_INN_RELEASE_SHA)"
  old_seller="$(value "$current_env" KITH_INN_PROVISIONED_SELLER_ID)"
  if compose "$current_env" up -d --no-deps "${runtime[@]}" >/dev/null 2>&1 && smoke "$current_env" "$old_sha" "$old_seller" >/dev/null 2>&1; then return 0; fi
  compose "$current_env" pull "${rollback_images[@]}" >/dev/null 2>&1 &&
    compose "$current_env" up -d --no-deps "${runtime[@]}" >/dev/null 2>&1 &&
    smoke "$current_env" "$old_sha" "$old_seller" >/dev/null 2>&1
}
recover() {
  local stage="$1"
  if [[ ! -f "$current_env" ]]; then
    compose "$next_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
    fail "$stage" candidate_stopped
  fi
  if ! restore_current; then
    compose "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
    fail "$stage" manual_data_recovery_required
  fi
  rm -f "$gate_marker"
  fail "$stage" rolled_back
}

command -v "$compose_bin" >/dev/null || fail preflight no_change
command -v "$smoke_bin" >/dev/null || fail preflight no_change
command -v jq >/dev/null || fail preflight no_change
command -v curl >/dev/null || fail preflight no_change
command -v date >/dev/null || fail preflight no_change
if [[ "$action" == gate-writes || "$action" == restore-runtime ]]; then
  if [[ ! -f "$current_env" ]]; then printf '{"status":"skipped","reason":"active_runtime_unavailable"}\n'; exit 0; fi
  validate_current || fail preflight no_change
  if [[ "$action" == restore-runtime ]]; then
    if [[ ! -f "$gate_marker" ]]; then printf '{"status":"skipped","reason":"write_gate_not_attempted"}\n'; exit 0; fi
    if restore_current; then
      rm -f "$gate_marker"
      printf '{"status":"last_good_runtime_restored"}\n'; exit 0
    fi
    compose "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
    fail restore manual_data_recovery_required
  fi
  compose "$current_env" pull "${rollback_images[@]}" >/dev/null 2>&1 || fail write_gate no_change
  printf 'attempted\n' >"$gate_marker.next"
  chmod 600 "$gate_marker.next"
  mv -f "$gate_marker.next" "$gate_marker"
  if ! compose "$current_env" stop "${runtime[@]}" >/dev/null 2>&1; then
    restore_current || { compose "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || true; fail write_gate manual_data_recovery_required; }
    rm -f "$gate_marker"
    fail write_gate rolled_back
  fi
  printf '{"status":"writes_gated"}\n'
  exit 0
fi
[[ "$action" == deploy ]] || fail preflight unsupported_action
[[ "$release_sha" =~ ^[0-9a-f]{40}$ && -f "$next_compose" && -f "$next_env" ]] || fail preflight no_change
[[ "$(value "$next_env" KITH_INN_RELEASE_SHA)" == "$release_sha" ]] || fail preflight no_change
[[ ! -f "$current_env" ]] || validate_current || fail preflight no_change
compose "$next_env" config --quiet >/dev/null 2>&1 || fail preflight no_change

compose "$next_env" pull "${all_services[@]}" >/dev/null 2>&1 || recover pull
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
chmod 600 "$next_env" "$next_compose" || recover persist
promote_candidate() {
  local new_release old_release stored_release
  mkdir -p "$release_store" || return 1
  chmod 700 "$release_store" || return 1
  new_release="$(mktemp -d "$release_store/.release.XXXXXX")" || return 1
  chmod 700 "$new_release" || { rm -rf "$new_release"; return 1; }
  install -m 600 "$next_env" "$new_release/.env.kith-inn" || { rm -rf "$new_release"; return 1; }
  install -m 600 "$next_compose" "$new_release/docker-compose.kith-inn.prod.yml" || {
    rm -rf "$new_release"; return 1;
  }
  if [[ -f "$current_env" ]]; then
    old_release="$current_release"
    if [[ -z "$old_release" ]]; then
      old_release="$(mktemp -d "$release_store/.release.XXXXXX")" || { rm -rf "$new_release"; return 1; }
      chmod 700 "$old_release" || { rm -rf "$new_release" "$old_release"; return 1; }
      install -m 600 "$current_env" "$old_release/.env.kith-inn" || { rm -rf "$new_release" "$old_release"; return 1; }
      install -m 600 "$current_compose" "$old_release/docker-compose.kith-inn.prod.yml" || {
        rm -rf "$new_release" "$old_release"; return 1;
      }
    fi
    printf '%s\n' "$old_release" >"$previous_pointer.next" || { rm -rf "$new_release"; return 1; }
    chmod 600 "$previous_pointer.next" || { rm -rf "$new_release"; return 1; }
    mv -f "$previous_pointer.next" "$previous_pointer" || { rm -rf "$new_release"; return 1; }
  fi
  printf '%s\n' "$new_release" >"$current_pointer.next" || { rm -rf "$new_release"; return 1; }
  chmod 600 "$current_pointer.next" || { rm -rf "$new_release"; return 1; }
  mv -f "$current_pointer.next" "$current_pointer" || { rm -rf "$new_release"; return 1; }
  rm -f "$next_env" "$next_compose" "$legacy_current_env" "$legacy_previous_env" "$legacy_compose" "$gate_marker" || true
  resolve_releases
  for stored_release in "$release_store"/.release.*; do
    [[ -d "$stored_release" ]] || continue
    [[ "$stored_release" == "$current_release" || "$stored_release" == "$previous_release" ]] || rm -rf "$stored_release" || true
  done
  return 0
}
promote_candidate || recover persist
jq -cn --arg releaseSha "$release_sha" --arg migrationHead "$migration_head" --arg sellerId "$seller_id" \
  --argjson smokeEvidence "$smoke_evidence" \
  '{releaseSha:$releaseSha,migrationHead:$migrationHead,sellerId:$sellerId,smokeEvidence:$smokeEvidence,status:"passed"}'
