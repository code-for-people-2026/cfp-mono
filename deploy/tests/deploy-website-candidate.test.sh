#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo/deploy/deploy-website-candidate.sh"
candidate_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
current_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
case_dir="$tmp/case"

write_bundle() {
  local suffix="$1" sha="$2" label="$3"
  printf 'services: { website: { image: "${WEBSITE_IMAGE}" } } # %s\n' "$label" >"$case_dir/docker-compose.yml$suffix"
  printf 'WEBSITE_IMAGE=registry.example/cfp-website:%s\n' "$sha" >"$case_dir/.env$suffix"
  printf 'PAYLOAD_SECRET=%s\n' "$label" >"$case_dir/.env.production$suffix"
}
reset_case() {
  rm -rf "$case_dir"
  mkdir -p "$case_dir"
  write_bundle "" "$current_sha" current
  write_bundle .next "$candidate_sha" candidate
}
run() {
  local mode="$1" action="${2:-deploy}"
  : >"$case_dir/compose.log"
  WEBSITE_REMOTE_ROOT="$case_dir" COMPOSE_BIN="$repo/deploy/tests/fake-website-compose.sh" \
    CURL_BIN="$repo/deploy/tests/fake-website-ready.sh" FAKE_COMPOSE_LOG="$case_dir/compose.log" \
    INSTALL_BIN="$repo/deploy/tests/fake-install.sh" \
    FAKE_INSTALL_FAIL_MATCH="${FAKE_INSTALL_FAIL_MATCH:-}" \
    FAKE_DEPLOY_MODE="$mode" CANDIDATE_SHA="$candidate_sha" WEBSITE_READY_RETRIES=1 \
    WEBSITE_READY_SLEEP=0 RELEASE_SHA="$candidate_sha" bash "$script" "$action"
}

reset_case
run success >"$case_dir/deploy.out"
grep -q 'candidate_ready' "$case_dir/deploy.out"
grep -qx "WEBSITE_IMAGE=registry.example/cfp-website:$candidate_sha" "$case_dir/.env"
grep -qx "WEBSITE_IMAGE=registry.example/cfp-website:$current_sha" "$case_dir/.website-last-good/.env"
grep -q -- '--env-file .*\.env.next pull website' "$case_dir/compose.log"
grep -q -- '--env-file .*\.env up -d --no-deps website' "$case_dir/compose.log"
grep -q -- '--project-name cfp-mono' "$case_dir/compose.log"
[[ -f "$case_dir/.website-rollout" ]]
run success finalize >"$case_dir/finalize.out"
grep -q 'release_finalized' "$case_dir/finalize.out"
[[ ! -e "$case_dir/.website-rollout" ]]

reset_case
run success >/dev/null
run rollback-pull restore-runtime >"$case_dir/restore.out"
grep -q 'last_good_runtime_restored' "$case_dir/restore.out"
grep -qx "WEBSITE_IMAGE=registry.example/cfp-website:$current_sha" "$case_dir/.env"
! grep -q " pull website" "$case_dir/compose.log"
[[ ! -e "$case_dir/.website-rollout" ]]

for mode in rollout readiness; do
  reset_case
  if run "$mode" >"$case_dir/$mode.out" 2>"$case_dir/$mode.err"; then exit 1; fi
  grep -q 'rolled_back' "$case_dir/$mode.err"
  grep -qx "WEBSITE_IMAGE=registry.example/cfp-website:$current_sha" "$case_dir/.env"
  [[ ! -e "$case_dir/.website-rollout" ]]
done

reset_case
if run pull >"$case_dir/pull.out" 2>"$case_dir/pull.err"; then exit 1; fi
grep -q 'no_change' "$case_dir/pull.err"
grep -qx "WEBSITE_IMAGE=registry.example/cfp-website:$current_sha" "$case_dir/.env"
[[ ! -e "$case_dir/.website-rollout" ]]

reset_case
if FAKE_INSTALL_FAIL_MATCH='.website-last-good/.env.next' \
  run success >"$case_dir/snapshot.out" 2>"$case_dir/snapshot.err"; then exit 1; fi
grep -q 'persist.*no_change' "$case_dir/snapshot.err"
grep -qx "WEBSITE_IMAGE=registry.example/cfp-website:$current_sha" "$case_dir/.env"
[[ ! -e "$case_dir/.website-rollout" ]]
[[ ! -e "$case_dir/.website-last-good/docker-compose.yml" ]]

reset_case
run success >/dev/null
if FAKE_INSTALL_FAIL_MATCH='.env.production.restore' \
  run success restore-runtime >"$case_dir/restore-copy.out" 2>"$case_dir/restore-copy.err"; then exit 1; fi
grep -q 'manual_recovery_required' "$case_dir/restore-copy.err"
grep -qx "WEBSITE_IMAGE=registry.example/cfp-website:$candidate_sha" "$case_dir/.env"
grep -qx 'PAYLOAD_SECRET=candidate' "$case_dir/.env.production"
grep -q '# candidate$' "$case_dir/docker-compose.yml"

reset_case
printf 'WEBSITE_IMAGE=registry.example/cfp-website:latest\n' >"$case_dir/.env.next"
if run success >"$case_dir/invalid.out" 2>"$case_dir/invalid.err"; then exit 1; fi
grep -q 'preflight.*no_change' "$case_dir/invalid.err"
[[ ! -e "$case_dir/.website-rollout" ]]

grep -qx '      - "127.0.0.1:3302:3302"' "$repo/deploy/docker-compose.prod.yml"
echo "website candidate deployment tests passed"
