#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/deploy-kith-inn-candidate.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/deploy"; : >"$tmp/deploy/docker-compose.kith-inn.prod.yml"
new_env() {
  cat >"$tmp/.env.kith-inn.next" <<'EOF'
KITH_INN_RELEASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
KITH_INN_TRIAL_OPENID='openid\'new'
KITH_INN_BE_BASE_URL='https://be.codeforpeople.cn'
EOF
}
old_env() {
  cat >"$tmp/.env.kith-inn" <<'EOF'
KITH_INN_RELEASE_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
KITH_INN_PROVISIONED_SELLER_ID=1
KITH_INN_TRIAL_OPENID='openid-old'
KITH_INN_BE_BASE_URL='https://be.codeforpeople.cn'
EOF
}
run() {
  : >"$tmp/compose.log"; : >"$tmp/smoke.log"
  KITH_INN_REMOTE_ROOT="$tmp" COMPOSE_BIN="$root/deploy/tests/fake-kith-compose.sh" \
    SMOKE_BIN="$root/deploy/tests/fake-kith-smoke.sh" FAKE_COMPOSE_LOG="$tmp/compose.log" \
    FAKE_SMOKE_LOG="$tmp/smoke.log" FAKE_DEPLOY_MODE="$1" \
    RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bash "$script"
}
new_env
run success >"$tmp/success"
jq -e '.status == "passed" and .sellerId == "1"' "$tmp/success" >/dev/null
grep -qx 'KITH_INN_PROVISIONED_SELLER_ID=1' "$tmp/.env.kith-inn"
grep -q "|openid'new|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$" "$tmp/smoke.log"

new_env; old_env
run success >"$tmp/upgrade"
grep -qx "KITH_INN_RELEASE_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'" "$tmp/.env.kith-inn.previous"
grep -qx "KITH_INN_RELEASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'" "$tmp/.env.kith-inn"

new_env; old_env
if run migration >"$tmp/migration.out" 2>"$tmp/migration.err"; then exit 1; fi
! grep -q -- '--env-file .*\.next up -d --no-deps' "$tmp/compose.log"
grep -q -- '--env-file .*\.kith-inn up -d --no-deps' "$tmp/compose.log"
grep -qx "KITH_INN_RELEASE_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'" "$tmp/.env.kith-inn"

new_env; old_env
if run provision >"$tmp/provision.out" 2>"$tmp/provision.err"; then exit 1; fi
grep -q -- '--env-file .*\.kith-inn up -d --no-deps' "$tmp/compose.log"

new_env; old_env
if run smoke >"$tmp/smoke.out" 2>"$tmp/smoke.err"; then exit 1; fi
grep -q -- '--env-file .*\.next up -d --no-deps' "$tmp/compose.log"
grep -q -- '--env-file .*\.kith-inn pull kith-inn-cms-migrate kith-inn-cms' "$tmp/compose.log"
grep -q -- '--env-file .*\.kith-inn up -d --no-deps' "$tmp/compose.log"
grep -q 'rolled_back' "$tmp/smoke.err"

new_env; old_env
if run incompatible >"$tmp/incompatible.out" 2>"$tmp/incompatible.err"; then exit 1; fi
grep -q 'manual_data_recovery_required' "$tmp/incompatible.err"
grep -q -- '--env-file .*\.kith-inn stop' "$tmp/compose.log"

new_env; rm -f "$tmp/.env.kith-inn"
if run smoke >"$tmp/first.out" 2>"$tmp/first.err"; then exit 1; fi
grep -q 'candidate_stopped' "$tmp/first.err"
grep -q -- '--env-file .*\.next stop' "$tmp/compose.log"
echo "candidate deployment tests passed"
