#!/usr/bin/env bash
set -euo pipefail

root="${WEBSITE_REMOTE_ROOT:-$HOME/cfp-mono}"
compose_bin="${COMPOSE_BIN:-docker}"
curl_bin="${CURL_BIN:-curl}"
jq_bin="${JQ_BIN:-jq}"
install_bin="${INSTALL_BIN:-install}"
release_sha="${RELEASE_SHA:-}"
action="${1:-deploy}"
current_compose="$root/docker-compose.yml"
current_images="$root/.env"
current_runtime="$root/.env.production"
next_compose="$current_compose.next"
next_images="$current_images.next"
next_runtime="$current_runtime.next"
last_good="$root/.website-last-good"
rollout_marker="$root/.website-rollout"

fail() { printf '{"status":"failed","stage":"%s","recovery":"%s"}\n' "$1" "$2" >&2; exit 1; }
value() { sed -n "s/^$2=//p" "$1" | head -n 1; }
bundle_sha() {
  local image
  image="$(value "$1" WEBSITE_IMAGE)"
  [[ "$image" =~ :([0-9a-f]{40})$ ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}
compose() {
  local compose_file="$1" image_env="$2" runtime_env="$3"
  shift 3
  WEBSITE_ENV_FILE="$runtime_env" "$compose_bin" compose --project-name cfp-mono \
    --project-directory "$root" -f "$compose_file" --env-file "$image_env" "$@"
}
validate_bundle() {
  local compose_file="$1" image_env="$2" runtime_env="$3" expected="${4:-}" actual
  [[ -f "$compose_file" && -f "$image_env" && -f "$runtime_env" ]] || return 1
  actual="$(bundle_sha "$image_env")" || return 1
  [[ -z "$expected" || "$actual" == "$expected" ]] || return 1
  compose "$compose_file" "$image_env" "$runtime_env" config --quiet >/dev/null 2>&1
}
probe() {
  local expected="$1" response attempt retries="${WEBSITE_READY_RETRIES:-30}"
  for ((attempt = 1; attempt <= retries; attempt++)); do
    response="$($curl_bin -fsS -m 10 http://127.0.0.1:3302/api/ready 2>/dev/null || true)"
    if "$jq_bin" -e --arg sha "$expected" \
      '.ok == true and .service == "website" and .releaseSha == $sha' <<<"$response" >/dev/null 2>&1; then
      return 0
    fi
    (( attempt == retries )) || sleep "${WEBSITE_READY_SLEEP:-2}"
  done
  return 1
}
install_bundle() {
  local source="$1" suffix="$2"
  "$install_bin" -m 600 "$source/docker-compose.yml" "$current_compose$suffix" || return 1
  "$install_bin" -m 600 "$source/.env" "$current_images$suffix" || return 1
  "$install_bin" -m 600 "$source/.env.production" "$current_runtime$suffix" || return 1
}
promote_files() {
  mv -f "$current_compose$1" "$current_compose" || return 1
  mv -f "$current_images$1" "$current_images" || return 1
  mv -f "$current_runtime$1" "$current_runtime" || return 1
}
snapshot_current() {
  mkdir -p "$last_good" || return 1
  chmod 700 "$last_good" || return 1
  "$install_bin" -m 600 "$current_compose" "$last_good/docker-compose.yml.next" || return 1
  "$install_bin" -m 600 "$current_images" "$last_good/.env.next" || return 1
  "$install_bin" -m 600 "$current_runtime" "$last_good/.env.production.next" || return 1
  mv -f "$last_good/docker-compose.yml.next" "$last_good/docker-compose.yml" || return 1
  mv -f "$last_good/.env.next" "$last_good/.env" || return 1
  mv -f "$last_good/.env.production.next" "$last_good/.env.production" || return 1
}
restore_last_good() {
  local old_sha
  validate_bundle "$last_good/docker-compose.yml" "$last_good/.env" \
    "$last_good/.env.production" || return 1
  old_sha="$(bundle_sha "$last_good/.env")" || return 1
  install_bundle "$last_good" .restore || return 1
  promote_files .restore || return 1
  if compose "$current_compose" "$current_images" "$current_runtime" \
    up -d --no-deps website >/dev/null 2>&1 && probe "$old_sha"; then
    return 0
  fi
  compose "$current_compose" "$current_images" "$current_runtime" pull website >/dev/null 2>&1 &&
    compose "$current_compose" "$current_images" "$current_runtime" \
      up -d --no-deps website >/dev/null 2>&1 && probe "$old_sha"
}
recover() {
  local stage="$1"
  if restore_last_good; then
    rm -f "$rollout_marker"
    fail "$stage" rolled_back
  fi
  compose "$current_compose" "$current_images" "$current_runtime" stop website >/dev/null 2>&1 || true
  rm -f "$rollout_marker"
  fail "$stage" manual_recovery_required
}

[[ -n "$root" && "$root" != / ]] || fail preflight no_change
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail preflight no_change
[[ "${WEBSITE_READY_RETRIES:-30}" =~ ^[1-9][0-9]*$ ]] || fail preflight no_change
for command in "$compose_bin" "$curl_bin" "$jq_bin" "$install_bin"; do
  command -v "$command" >/dev/null || fail preflight no_change
done

if [[ "$action" == restore-runtime ]]; then
  [[ -f "$rollout_marker" ]] || { printf '{"status":"skipped","reason":"rollout_not_attempted"}\n'; exit 0; }
  if restore_last_good; then
    rm -f "$rollout_marker"
    printf '{"status":"last_good_runtime_restored"}\n'
    exit 0
  fi
  recover restore
fi

if [[ "$action" == finalize ]]; then
  [[ -f "$rollout_marker" && "$(head -n 1 "$rollout_marker")" == "$release_sha" ]] || recover finalize
  validate_bundle "$current_compose" "$current_images" "$current_runtime" "$release_sha" || recover finalize
  probe "$release_sha" || recover finalize
  rm -f "$rollout_marker" "$next_compose" "$next_images" "$next_runtime"
  printf '{"status":"release_finalized","releaseSha":"%s"}\n' "$release_sha"
  exit 0
fi

[[ "$action" == deploy ]] || fail preflight unsupported_action
if [[ -f "$rollout_marker" ]]; then recover stale_rollout; fi
validate_bundle "$next_compose" "$next_images" "$next_runtime" "$release_sha" || fail preflight no_change
current_available=false
if [[ -e "$current_compose" || -e "$current_images" || -e "$current_runtime" ]]; then
  validate_bundle "$current_compose" "$current_images" "$current_runtime" || fail preflight no_change
  current_available=true
fi
compose "$next_compose" "$next_images" "$next_runtime" pull website >/dev/null 2>&1 || fail pull no_change
if [[ "$current_available" == true ]]; then snapshot_current || fail persist no_change; fi
printf '%s\n' "$release_sha" >"$rollout_marker.next"
chmod 600 "$rollout_marker.next"
mv -f "$rollout_marker.next" "$rollout_marker"
"$install_bin" -m 600 "$next_compose" "$current_compose.promote" || recover persist
"$install_bin" -m 600 "$next_images" "$current_images.promote" || recover persist
"$install_bin" -m 600 "$next_runtime" "$current_runtime.promote" || recover persist
promote_files .promote || recover persist
compose "$current_compose" "$current_images" "$current_runtime" up -d --no-deps website >/dev/null 2>&1 || recover rollout
probe "$release_sha" || recover readiness
printf '{"status":"candidate_ready","releaseSha":"%s"}\n' "$release_sha"
