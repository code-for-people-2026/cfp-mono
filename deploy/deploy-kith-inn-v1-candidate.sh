#!/usr/bin/env bash
set -euo pipefail

root="${KITH_INN_V1_REMOTE_ROOT:-$HOME/cfp-mono}"
project_dir="$root/deploy"
next_compose="$project_dir/docker-compose.kith-inn-v1.prod.yml.next"
next_env="$root/.env.kith-inn-v1.next"
release_store="$root/.kith-inn-v1-releases"
current_pointer="$root/.kith-inn-v1-current"
previous_pointer="$root/.kith-inn-v1-previous"
compose_bin="${COMPOSE_BIN:-docker}"
smoke_bin="${SMOKE_BIN:-$project_dir/smoke-kith-inn-v1.sh}"
release_sha="${RELEASE_SHA:-}"
action="${1:-deploy}"
runtime=(kith-inn-v1-cms kith-inn-v1-be)
all_services=(kith-inn-v1-cms-migrate kith-inn-v1-cms-provision "${runtime[@]}")

fail() { printf '{"status":"failed","stage":"%s","recovery":"%s"}\n' "$1" "$2" >&2; exit 1; }
value() {
  local raw
  raw="$(sed -n "s/^$2=//p" "$1" | head -n 1)"
  raw="${raw#\'}"
  raw="${raw%\'}"
  printf "%s" "${raw//\\\'/\'}"
}
read_pointer() {
  local pointer="$1" release
  IFS= read -r release <"$pointer" || return 1
  [[ "$(wc -l <"$pointer")" -eq 1 && "$(dirname "$release")" == "$release_store" &&
    "$(basename "$release")" == .release.* && -f "$release/compose.yml" && -f "$release/env" ]] || return 1
  printf "%s" "$release"
}
current_release=""
if [[ -e "$current_pointer" ]]; then
  current_release="$(read_pointer "$current_pointer")" || fail preflight invalid_current_pointer
fi
current_compose="${current_release:+$current_release/compose.yml}"
current_env="${current_release:+$current_release/env}"
compose() {
  local compose_file="$1" env_file="$2"
  shift 2
  "$compose_bin" compose --project-name kith-inn-v1 --project-directory "$project_dir" -f "$compose_file" --env-file "$env_file" "$@"
}
candidate_valid() {
  [[ "$release_sha" =~ ^[0-9a-f]{40}$ && -f "$next_compose" && -f "$next_env" ]] &&
    [[ "$(value "$next_env" KITH_INN_V1_RELEASE_SHA)" == "$release_sha" ]] &&
    compose "$next_compose" "$next_env" config --quiet >/dev/null 2>&1
}
current_valid() {
  [[ -n "$current_release" && -f "$current_compose" && -f "$current_env" ]] &&
    [[ "$(value "$current_env" KITH_INN_V1_RELEASE_SHA)" =~ ^[0-9a-f]{40}$ ]] &&
    compose "$current_compose" "$current_env" config --quiet >/dev/null 2>&1
}
smoke() {
  local compose_file="$1" env_file="$2" sha="$3"
  compose "$compose_file" "$env_file" ps --status running "${runtime[@]}" >/dev/null
  KITH_INN_V1_ENV_FILE="$env_file" RELEASE_SHA="$sha" "$smoke_bin"
}
restore_current() {
  current_valid || return 1
  compose "$current_compose" "$current_env" up -d --no-deps "${runtime[@]}" >/dev/null 2>&1 &&
    smoke "$current_compose" "$current_env" "$(value "$current_env" KITH_INN_V1_RELEASE_SHA)" >/dev/null 2>&1
}
recover() {
  local stage="$1"
  compose "$next_compose" "$next_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
  if [[ -n "$current_release" ]] && restore_current; then fail "$stage" rolled_back; fi
  fail "$stage" candidate_stopped
}

command -v "$compose_bin" >/dev/null || fail preflight no_change
command -v "$smoke_bin" >/dev/null || fail preflight no_change
command -v jq >/dev/null || fail preflight no_change
command -v curl >/dev/null || fail preflight no_change

if [[ "$action" == "preflight" ]]; then
  candidate_valid || fail preflight no_change
  [[ -z "$current_release" ]] || current_valid || fail preflight no_change
  compose "$next_compose" "$next_env" pull "${all_services[@]}" >/dev/null 2>&1 || fail preflight no_change
  echo '{"status":"candidate_ready"}'
  exit 0
fi

[[ "$action" == "deploy" ]] || fail preflight unsupported_action
candidate_valid || fail preflight no_change
[[ -z "$current_release" ]] || current_valid || fail preflight no_change
compose "$next_compose" "$next_env" pull "${all_services[@]}" >/dev/null 2>&1 || recover pull

interrupted() { trap - TERM INT HUP; recover interrupted; }
trap interrupted TERM INT HUP
if [[ -n "$current_release" ]]; then
  compose "$current_compose" "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || recover write_gate
fi

migration_output="$(compose "$next_compose" "$next_env" run --rm --no-deps kith-inn-v1-cms-migrate 2>&1)" || recover migration
migration_head="$(sed -nE 's/^✓ cms migration head ([A-Za-z0-9_]+)$/\1/p' <<<"$migration_output" | tail -n 1)"
[[ -n "$migration_head" ]] || recover migration
provision_output="$(compose "$next_compose" "$next_env" run --rm --no-deps kith-inn-v1-cms-provision 2>&1)" || recover provision
seller_id="$(tail -n 1 <<<"$provision_output" | jq -er 'select(.project == "kiv1") | .sellerId | tostring')" || recover provision

compose "$next_compose" "$next_env" up -d --no-deps "${runtime[@]}" >/dev/null 2>&1 || recover rollout
smoke_result="$(smoke "$next_compose" "$next_env" "$release_sha" 2>/dev/null)" || recover smoke

mkdir -p "$release_store" || recover persist
chmod 700 "$release_store" || recover persist
new_release="$(mktemp -d "$release_store/.release.XXXXXX")" || recover persist
install -m 600 "$next_env" "$new_release/env" || recover persist
install -m 600 "$next_compose" "$new_release/compose.yml" || recover persist
if [[ -n "$current_release" ]]; then
  printf "%s\n" "$current_release" >"$previous_pointer.next" || recover persist
  chmod 600 "$previous_pointer.next" || recover persist
  mv -f "$previous_pointer.next" "$previous_pointer" || recover persist
fi
printf "%s\n" "$new_release" >"$current_pointer.next" || recover persist
chmod 600 "$current_pointer.next" || recover persist
mv -f "$current_pointer.next" "$current_pointer" || recover persist
trap - TERM INT HUP
rm -f -- "$next_env" "$next_compose"

jq -cn --arg releaseSha "$release_sha" --arg migrationHead "$migration_head" --arg sellerId "$seller_id" --argjson smokeEvidence "$smoke_result" '{releaseSha:$releaseSha,migrationHead:$migrationHead,sellerId:$sellerId,smokeEvidence:$smokeEvidence,status:"passed"}'
