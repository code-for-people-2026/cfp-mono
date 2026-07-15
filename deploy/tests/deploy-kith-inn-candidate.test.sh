#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/deploy-kith-inn-candidate.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
case_dir="$tmp/case"
reset_case() {
  rm -rf "$case_dir"; mkdir -p "$case_dir/deploy"
  printf '# last-good-compose\n' >"$case_dir/deploy/docker-compose.kith-inn.prod.yml"
  printf '# candidate-compose\n' >"$case_dir/deploy/docker-compose.kith-inn.prod.yml.next"
}
new_env() {
  cat >"$case_dir/.env.kith-inn.next" <<'EOF'
KITH_INN_RELEASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
KITH_INN_TRIAL_OPENID='openid\'new'
KITH_INN_BE_BASE_URL='https://be.codeforpeople.cn'
EOF
}
old_env() {
  cat >"$case_dir/.env.kith-inn" <<'EOF'
KITH_INN_RELEASE_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
KITH_INN_PROVISIONED_SELLER_ID=1
KITH_INN_TRIAL_OPENID='openid-old'
KITH_INN_BE_BASE_URL='https://be.codeforpeople.cn'
EOF
}
run() {
  local mode="$1" action="${2:-deploy}"
  : >"$case_dir/compose.log"; : >"$case_dir/smoke.log"
  KITH_INN_REMOTE_ROOT="$case_dir" COMPOSE_BIN="$root/deploy/tests/fake-kith-compose.sh" \
    SMOKE_BIN="$root/deploy/tests/fake-kith-smoke.sh" FAKE_COMPOSE_LOG="$case_dir/compose.log" \
    FAKE_SMOKE_LOG="$case_dir/smoke.log" FAKE_DEPLOY_MODE="$mode" \
    RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "${BASH_BIN:-bash}" "$script" "$action"
}
reset_case; new_env; old_env
run success gate-writes >"$case_dir/gate.out"
grep -q 'writes_gated' "$case_dir/gate.out"
grep -q -- "--project-directory $case_dir/deploy -f $case_dir/deploy/docker-compose.kith-inn.prod.yml" \
  "$case_dir/compose.log"
grep -q ' stop kith-inn-cms kith-inn-be kith-inn-h5' "$case_dir/compose.log"
[[ -f "$case_dir/.kith-inn-write-gate" ]]
run success restore-runtime >"$case_dir/restore.out"
grep -q 'last_good_runtime_restored' "$case_dir/restore.out"
grep -q -- '--env-file .*\.env.kith-inn up -d --no-deps' "$case_dir/compose.log"
[[ ! -e "$case_dir/.kith-inn-write-gate" ]]
reset_case; new_env; old_env
if run gate-fail gate-writes >"$case_dir/gate-fail.out" 2>"$case_dir/gate-fail.err"; then exit 1; fi
grep -q 'rolled_back' "$case_dir/gate-fail.err"
grep -q -- '--env-file .*\.env.kith-inn up -d --no-deps' "$case_dir/compose.log"
[[ ! -e "$case_dir/.kith-inn-write-gate" ]]
reset_case; new_env; old_env
if run pull-fail gate-writes >"$case_dir/pull-fail.out" 2>"$case_dir/pull-fail.err"; then exit 1; fi
[[ ! -e "$case_dir/.kith-inn-write-gate" ]]
run pull-fail restore-runtime >"$case_dir/pull-cleanup.out"
grep -q 'write_gate_not_attempted' "$case_dir/pull-cleanup.out"
! grep -q ' stop ' "$case_dir/compose.log"
reset_case; new_env
run success >"$case_dir/first.out"
jq -e '.status == "passed" and .sellerId == "1" and .smokeEvidence.status == "passed" and
  .smokeEvidence.writeCount == 0 and (.smokeEvidence.startedAt | test("Z$"))' "$case_dir/first.out" >/dev/null
current_release="$(cat "$case_dir/.kith-inn-current")"
grep -qx 'KITH_INN_PROVISIONED_SELLER_ID=1' "$current_release/.env.kith-inn"
grep -q '# candidate-compose' "$current_release/docker-compose.kith-inn.prod.yml"
grep -q "|$case_dir/deploy/docker-compose.kith-inn.prod.yml.next|$case_dir/deploy|openid'new|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$" \
  "$case_dir/smoke.log"
[[ ! -e "$case_dir/.env.kith-inn.next" && ! -e "$case_dir/deploy/docker-compose.kith-inn.prod.yml.next" ]]

reset_case; new_env; old_env
run success >"$case_dir/upgrade.out"
current_release="$(cat "$case_dir/.kith-inn-current")"
previous_release="$(cat "$case_dir/.kith-inn-previous")"
grep -qx "KITH_INN_RELEASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'" "$current_release/.env.kith-inn"
grep -qx "KITH_INN_RELEASE_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'" "$previous_release/.env.kith-inn"
grep -q '# candidate-compose' "$current_release/docker-compose.kith-inn.prod.yml"
grep -q '# last-good-compose' "$previous_release/docker-compose.kith-inn.prod.yml"

reset_case; new_env; printf '%s\n' "KITH_INN_TRIAL_OPENID='legacy-openid'" >"$case_dir/.env.kith-inn"
if run migration >"$case_dir/legacy.out" 2>"$case_dir/legacy.err"; then exit 1; fi
grep -q 'preflight.*no_change' "$case_dir/legacy.err"; ! grep -Eq ' pull | run | stop ' "$case_dir/compose.log"
mkdir "$tmp/no-curl"
for command in sed head jq; do ln -sf "$(command -v "$command")" "$tmp/no-curl/$command"; done
reset_case; new_env
if PATH="$tmp/no-curl" BASH_BIN=/bin/bash run success >"$case_dir/curl.out" 2>"$case_dir/curl.err"; then exit 1; fi
grep -q 'preflight.*no_change' "$case_dir/curl.err"; ! grep -q ' pull ' "$case_dir/compose.log"
reset_case; new_env; printf '/tmp/not-a-release\n' >"$case_dir/.kith-inn-current"
if run success >"$case_dir/pointer.out" 2>"$case_dir/pointer.err"; then exit 1; fi
grep -q 'invalid_current_pointer' "$case_dir/pointer.err"; ! grep -Eq ' pull | run | stop ' "$case_dir/compose.log"

for mode in migration provision smoke; do
  reset_case; new_env; old_env
  if run "$mode" >"$case_dir/$mode.out" 2>"$case_dir/$mode.err"; then exit 1; fi
  grep -q -- "-f $case_dir/deploy/docker-compose.kith-inn.prod.yml.next --env-file $case_dir/.env.kith-inn.next" \
    "$case_dir/compose.log"
  grep -q -- "-f $case_dir/deploy/docker-compose.kith-inn.prod.yml --env-file $case_dir/.env.kith-inn up -d" \
    "$case_dir/compose.log"
  grep -q '# last-good-compose' "$case_dir/deploy/docker-compose.kith-inn.prod.yml"
  [[ ! -e "$case_dir/.kith-inn-current" ]]
done
reset_case; new_env; old_env
if run incompatible >"$case_dir/incompatible.out" 2>"$case_dir/incompatible.err"; then exit 1; fi
grep -q 'manual_data_recovery_required' "$case_dir/incompatible.err"

for mode in invalid-smoke incomplete-smoke; do
  reset_case; new_env; old_env
  if run "$mode" >"$case_dir/$mode.out" 2>"$case_dir/$mode.err"; then exit 1; fi
  grep -q 'manual_data_recovery_required' "$case_dir/$mode.err"
  grep -q -- '-f .*docker-compose.kith-inn.prod.yml --env-file .*\.env.kith-inn stop' "$case_dir/compose.log"
done

reset_case; new_env
if run smoke >"$case_dir/first-fail.out" 2>"$case_dir/first-fail.err"; then exit 1; fi
grep -q 'candidate_stopped' "$case_dir/first-fail.err"
grep -q -- '-f .*\.next --env-file .*\.next stop' "$case_dir/compose.log"
echo "candidate deployment tests passed"
