#!/usr/bin/env bash
set -euo pipefail

root="${KITH_INN_V1_REMOTE_ROOT:-$HOME/cfp-mono}"
project_dir="$root/deploy"
next_compose="$project_dir/docker-compose.kith-inn-v1.prod.yml.next"
next_env="$root/.env.kith-inn-v1.next"
release_store="$root/.kith-inn-v1-releases"
current_pointer="$root/.kith-inn-v1-current"
previous_pointer="$root/.kith-inn-v1-previous"
gate_marker="$root/.kith-inn-v1-write-gate"
compose_bin="${COMPOSE_BIN:-docker}"
smoke_bin="${SMOKE_BIN:-$project_dir/smoke-kith-inn-v1.sh}"
curl_bin="${CURL_BIN:-curl}"
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
previous_release=""
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
  compose "$current_compose" "$current_env" up -d --wait --wait-timeout 120 --no-deps "${runtime[@]}" >/dev/null 2>&1 &&
    smoke "$current_compose" "$current_env" "$(value "$current_env" KITH_INN_V1_RELEASE_SHA)" >/dev/null 2>&1
}
prune_unused_v1_images() {
  local image repo ref preserve_images=() repositories=()
  contains() {
    local needle="$1" item
    shift
    for item in "$@"; do [[ "$item" == "$needle" ]] && return 0; done
    return 1
  }
  for image in KITH_INN_V1_CMS_IMAGE KITH_INN_V1_CMS_OPS_IMAGE KITH_INN_V1_BE_IMAGE; do
    ref="$(value "$next_env" "$image")"
    [[ -z "$ref" ]] || preserve_images+=("$ref")
    if [[ -n "$current_release" ]]; then
      ref="$(value "$current_env" "$image")"
      [[ -z "$ref" ]] || preserve_images+=("$ref")
    fi
  done
  for ref in "${preserve_images[@]}"; do
    repo="${ref%@*}"
    if (( ${#repositories[@]} == 0 )) || ! contains "$repo" "${repositories[@]}"; then repositories+=("$repo"); fi
  done
  if (( ${#repositories[@]} > 0 )); then
    for repo in "${repositories[@]}"; do
      while IFS= read -r ref; do
        [[ -n "$ref" && "$ref" != *"@<none>" ]] || continue
        contains "$ref" "${preserve_images[@]}" || "$compose_bin" image rm "$ref" >/dev/null 2>&1 || true
      done < <("$compose_bin" image ls --digests --format '{{.Repository}}@{{.Digest}}' "$repo" 2>/dev/null)
    done
  fi
  "$compose_bin" image prune -f >/dev/null 2>&1 || true
}
recover() {
  local stage="$1"
  compose "$next_compose" "$next_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
  if [[ -n "$current_release" ]]; then
    if restore_current; then rm -f "$gate_marker"; fail "$stage" rolled_back; fi
    compose "$current_compose" "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
    fail "$stage" manual_data_recovery_required
  fi
  fail "$stage" candidate_stopped
}

command -v "$compose_bin" >/dev/null || fail preflight no_change
command -v "$smoke_bin" >/dev/null || fail preflight no_change
command -v jq >/dev/null || fail preflight no_change
command -v "$curl_bin" >/dev/null || fail preflight no_change

if [[ "$action" == "preflight" ]]; then
  candidate_valid || fail preflight no_change
  [[ -z "$current_release" ]] || current_valid || fail preflight no_change
  if [[ -n "$current_release" ]]; then
    smoke "$current_compose" "$current_env" "$(value "$current_env" KITH_INN_V1_RELEASE_SHA)" >/dev/null 2>&1 ||
      fail current_runtime no_change
  fi
  "$compose_bin" network inspect kith-inn-shared >/dev/null 2>&1 ||
    "$compose_bin" network create kith-inn-shared >/dev/null 2>&1 || fail shared_network no_change
  prune_unused_v1_images
  compose "$next_compose" "$next_env" pull "${all_services[@]}" >/dev/null 2>&1 || fail preflight no_change
  echo '{"status":"candidate_ready"}'
  exit 0
fi

if [[ "$action" == "gate-writes" || "$action" == "restore-runtime" ]]; then
  if [[ -z "$current_release" ]]; then echo '{"status":"skipped","reason":"active_runtime_unavailable"}'; exit 0; fi
  current_valid || fail preflight no_change
  if [[ "$action" == "restore-runtime" ]]; then
    [[ -f "$gate_marker" ]] || { echo '{"status":"skipped","reason":"write_gate_not_attempted"}'; exit 0; }
    if ! restore_current; then
      compose "$current_compose" "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
      fail restore manual_data_recovery_required
    fi
    rm -f "$gate_marker"
    echo '{"status":"last_good_runtime_restored"}'
    exit 0
  fi
  printf "attempted\n" >"$gate_marker"
  chmod 600 "$gate_marker"
  if ! compose "$current_compose" "$current_env" stop "${runtime[@]}" >/dev/null 2>&1; then
    if restore_current; then rm -f "$gate_marker"; fail write_gate rolled_back; fi
    compose "$current_compose" "$current_env" stop "${runtime[@]}" >/dev/null 2>&1 || true
    fail write_gate manual_data_recovery_required
  fi
  echo '{"status":"writes_gated"}'
  exit 0
fi

[[ "$action" == "deploy" ]] || fail preflight unsupported_action
candidate_valid || fail preflight no_change
[[ -z "$current_release" ]] || current_valid || fail preflight no_change

interrupted() { trap - TERM INT HUP; recover interrupted; }
trap interrupted TERM INT HUP
[[ -z "$current_release" || -f "$gate_marker" ]] || fail write_gate no_change

compose "$next_compose" "$next_env" run --rm --no-deps kith-inn-v1-cms-migrate >/dev/null 2>&1 || recover migration
provision_output="$(compose "$next_compose" "$next_env" run --rm --no-deps kith-inn-v1-cms-provision 2>&1)" || recover provision
seller_id="$(tail -n 1 <<<"$provision_output" | jq -er 'select(.project == "kiv1") | .sellerId | tostring')" || recover provision

compose "$next_compose" "$next_env" up -d --wait --wait-timeout 120 --no-deps "${runtime[@]}" >/dev/null 2>&1 || recover rollout
smoke_result="$(smoke "$next_compose" "$next_env" "$release_sha" 2>/dev/null)" || recover smoke

mkdir -p "$release_store" || recover persist
chmod 700 "$release_store" || recover persist
new_release="$(mktemp -d "$release_store/.release.XXXXXX")" || recover persist
install -m 600 "$next_env" "$new_release/env" || recover persist
install -m 600 "$next_compose" "$new_release/compose.yml" || recover persist
if [[ -n "$current_release" ]]; then
  previous_release="$current_release"
  printf "%s\n" "$current_release" >"$previous_pointer.next" || recover persist
  chmod 600 "$previous_pointer.next" || recover persist
  mv -f "$previous_pointer.next" "$previous_pointer" || recover persist
else
  rm -f -- "$previous_pointer" || recover persist
fi
printf "%s\n" "$new_release" >"$current_pointer.next" || recover persist
chmod 600 "$current_pointer.next" || recover persist
trap '' TERM INT HUP
if ! mv -f "$current_pointer.next" "$current_pointer"; then
  trap interrupted TERM INT HUP
  recover persist
fi
current_release="$new_release"
current_compose="$new_release/compose.yml"
current_env="$new_release/env"
trap - TERM INT HUP
rm -f -- "$next_env" "$next_compose" "$gate_marker"
for stored_release in "$release_store"/.release.*; do
  [[ -d "$stored_release" ]] || continue
  [[ "$stored_release" == "$current_release" || "$stored_release" == "$previous_release" ]] ||
    rm -rf -- "$stored_release" || true
done

jq -cn --arg releaseSha "$release_sha" --arg sellerId "$seller_id" --argjson smokeEvidence "$smoke_result" '{releaseSha:$releaseSha,sellerId:$sellerId,smokeEvidence:$smokeEvidence,status:"passed"}'
