#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo/deploy/deploy-kith-inn-v1-candidate.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/deploy"
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
mkdir -p "$tmp/.kith-inn-v1-releases/.release.stale"
printf "stale\n" >"$tmp/.kith-inn-v1-releases/.release.stale/env"
legacy_release="$tmp/.kith-inn-v1-releases/.release.legacy"
mkdir -p "$legacy_release"
printf "# legacy-v1\n" >"$legacy_release/compose.yml"
printf "KITH_INN_V1_RELEASE_SHA='%s'\nKITH_INN_V1_INTERNAL_TOKEN='legacy-internal'\n" \
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb >"$legacy_release/env"
printf '%s\n' "$legacy_release" >"$tmp/.kith-inn-v1-current"
candidate() {
  local digest="${1:-current}"
  printf "# candidate\n" >"$tmp/deploy/docker-compose.kith-inn-v1.prod.yml.next"
  printf "KITH_INN_V1_RELEASE_SHA='%s'\n" "$sha" >"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_CMS_IMAGE='registry/cms@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_CMS_OPS_IMAGE='registry/ops@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_BE_IMAGE='registry/be@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_INTERNAL_TOKEN='internal-value'\n" >>"$tmp/.env.kith-inn-v1.next"
}
run_deploy() {
  local mode="$1" action="${2:-deploy}"
  KITH_INN_V1_REMOTE_ROOT="$tmp" RELEASE_SHA="$sha" COMPOSE_BIN="$repo/deploy/tests/fake-kith-v1-compose.sh" SMOKE_BIN="$repo/deploy/tests/fake-kith-v1-smoke.sh" CURL_BIN="$repo/deploy/tests/fake-kith-v1-ready.sh" SLEEP_BIN=true FAKE_COMPOSE_LOG="$tmp/compose.log" FAKE_SMOKE_LOG="$tmp/smoke.log" FAKE_DEPLOY_MODE="$mode" bash "$script" "$action"
}
candidate
if run_deploy shared-network preflight >"$tmp/shared-network.out" 2>"$tmp/shared-network.err"; then exit 1; fi
grep -q '"stage":"shared_network"' "$tmp/shared-network.err"
! grep -q ' pull ' "$tmp/compose.log"
run_deploy legacy-v1 preflight | jq -e '.status == "candidate_ready"' >/dev/null
if run_deploy legacy-query-fail gate-writes >"$tmp/legacy-query.out" 2>"$tmp/legacy-query.err"; then exit 1; fi
grep -q '"stage":"write_gate","recovery":"no_change"' "$tmp/legacy-query.err"
[[ ! -e "$tmp/.kith-inn-v1-write-gate" && ! -e "$tmp/.kith-inn-v1-legacy-runtime" ]]
run_deploy legacy-v1 gate-writes | jq -e '.status == "writes_gated"' >/dev/null
grep -q 'stop aaaaaaaaaaaa bbbbbbbbbbbb cccccccccccc' "$tmp/compose.log"
grep -q -- "-f $legacy_release/compose.yml --env-file $legacy_release/env stop kith-inn-v1-be" "$tmp/compose.log"
if run_deploy migration >"$tmp/legacy-migration.out" 2>"$tmp/legacy-migration.err"; then exit 1; fi
grep -q '"stage":"migration","recovery":"rolled_back"' "$tmp/legacy-migration.err"
grep -q 'start aaaaaaaaaaaa bbbbbbbbbbbb cccccccccccc' "$tmp/compose.log"
[[ ! -e "$tmp/.kith-inn-v1-legacy-runtime" ]]
run_deploy legacy-v1 gate-writes | jq -e '.status == "writes_gated"' >/dev/null
if run_deploy legacy-recovery-fail >"$tmp/legacy-recovery.out" 2>"$tmp/legacy-recovery.err"; then exit 1; fi
grep -q '"stage":"migration","recovery":"manual_data_recovery_required"' "$tmp/legacy-recovery.err"
grep -q 'stop aaaaaaaaaaaa bbbbbbbbbbbb cccccccccccc' "$tmp/compose.log"
[[ -e "$tmp/.kith-inn-v1-legacy-runtime" ]]
rm -f "$tmp/.kith-inn-v1-legacy-runtime" "$tmp/.kith-inn-v1-write-gate"
run_deploy legacy-v1 gate-writes | jq -e '.status == "writes_gated"' >/dev/null
run_deploy legacy-v1 | jq -e '.status == "passed" and .sellerId == "1" and .smokeEvidence.writeCount == 0' >/dev/null
[[ ! -e "$tmp/.kith-inn-v1-legacy-runtime" ]]
grep -q 'run --rm --no-deps kith-inn-v1-cms-migrate' "$tmp/compose.log"
grep -q 'run --rm --no-deps kith-inn-v1-cms-provision' "$tmp/compose.log"
grep -q 'up -d --wait --wait-timeout 120 --no-deps kith-inn-v1-cms kith-inn-v1-be' "$tmp/compose.log"
current="$(cat "$tmp/.kith-inn-v1-current")"
[[ -f "$current/env" && -f "$current/compose.yml" ]]
grep -qx "KITH_INN_V1_RELEASE_SHA='$sha'" "$current/env"
[[ ! -e "$tmp/.kith-inn-v1-releases/.release.stale" ]]
candidate next
run_deploy success preflight | jq -e '.status == "candidate_ready"' >/dev/null
grep -q 'image rm registry/cms@sha256:old' "$tmp/compose.log"
! grep -q 'image rm registry/cms@sha256:current' "$tmp/compose.log"
grep -q 'image rm registry/ops@sha256:old' "$tmp/compose.log"
! grep -q 'image rm registry/ops@sha256:current' "$tmp/compose.log"
if run_deploy gate-fail gate-writes >"$tmp/gate-fail.out" 2>"$tmp/gate-fail.err"; then exit 1; fi
grep -q '"stage":"write_gate","recovery":"rolled_back"' "$tmp/gate-fail.err"
[[ ! -e "$tmp/.kith-inn-v1-write-gate" ]]
run_deploy success gate-writes | jq -e '.status == "writes_gated"' >/dev/null
grep -q 'stop kith-inn-v1-cms kith-inn-v1-be' "$tmp/compose.log"
if run_deploy smoke >"$tmp/fail.out" 2>"$tmp/fail.err"; then exit 1; fi
grep -q '"recovery":"rolled_back"' "$tmp/fail.err"
[[ "$(cat "$tmp/.kith-inn-v1-current")" == "$current" ]]
grep -q "$current/env" "$tmp/smoke.log"
candidate next
run_deploy success preflight >/dev/null
run_deploy success gate-writes >/dev/null
if run_deploy all-smoke >"$tmp/all-smoke.out" 2>"$tmp/all-smoke.err"; then exit 1; fi
grep -q '"stage":"smoke","recovery":"manual_data_recovery_required"' "$tmp/all-smoke.err"
grep -q -- "-f $current/compose.yml --env-file $current/env stop kith-inn-v1-cms kith-inn-v1-be" "$tmp/compose.log"
echo "kith-inn-v1 candidate deployment tests passed"
