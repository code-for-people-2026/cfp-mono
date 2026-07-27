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
candidate() {
  local digest="${1:-current}"
  printf "# candidate\n" >"$tmp/deploy/docker-compose.kith-inn-v1.prod.yml.next"
  printf "KITH_INN_V1_RELEASE_SHA='%s'\n" "$sha" >"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_CMS_OPS_IMAGE='registry/ops@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_BE_IMAGE='registry/be@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_INTERNAL_TOKEN='internal-value'\n" >>"$tmp/.env.kith-inn-v1.next"
}
run_deploy() {
  local mode="$1" action="${2:-deploy}"
  KITH_INN_V1_REMOTE_ROOT="$tmp" RELEASE_SHA="$sha" COMPOSE_BIN="$repo/deploy/tests/fake-kith-v1-compose.sh" SMOKE_BIN="$repo/deploy/tests/fake-kith-v1-smoke.sh" CURL_BIN="$repo/deploy/tests/fake-kith-v1-ready.sh" FAKE_COMPOSE_LOG="$tmp/compose.log" FAKE_SMOKE_LOG="$tmp/smoke.log" FAKE_DEPLOY_MODE="$mode" bash "$script" "$action"
}
candidate
if run_deploy shared-cms preflight >"$tmp/shared-cms.out" 2>"$tmp/shared-cms.err"; then exit 1; fi
grep -q '"stage":"shared_cms"' "$tmp/shared-cms.err"
! grep -q ' pull ' "$tmp/compose.log"
run_deploy success preflight | jq -e '.status == "candidate_ready"' >/dev/null
run_deploy success | jq -e '.status == "passed" and .sellerId == "1" and .smokeEvidence.writeCount == 0' >/dev/null
grep -q 'up -d --wait --wait-timeout 120 --no-deps kith-inn-v1-be' "$tmp/compose.log"
current="$(cat "$tmp/.kith-inn-v1-current")"
[[ -f "$current/env" && -f "$current/compose.yml" ]]
grep -qx "KITH_INN_V1_RELEASE_SHA='$sha'" "$current/env"
[[ ! -e "$tmp/.kith-inn-v1-releases/.release.stale" ]]
candidate next
run_deploy success preflight | jq -e '.status == "candidate_ready"' >/dev/null
grep -q 'image rm registry/ops@sha256:old' "$tmp/compose.log"
! grep -q 'image rm registry/ops@sha256:current' "$tmp/compose.log"
if run_deploy gate-fail gate-writes >"$tmp/gate-fail.out" 2>"$tmp/gate-fail.err"; then exit 1; fi
grep -q '"stage":"write_gate","recovery":"rolled_back"' "$tmp/gate-fail.err"
[[ ! -e "$tmp/.kith-inn-v1-write-gate" ]]
run_deploy success gate-writes | jq -e '.status == "writes_gated"' >/dev/null
grep -q 'stop kith-inn-v1-be' "$tmp/compose.log"
! grep -q 'stop kith-inn-v1-cms' "$tmp/compose.log"
if run_deploy smoke >"$tmp/fail.out" 2>"$tmp/fail.err"; then exit 1; fi
grep -q '"recovery":"rolled_back"' "$tmp/fail.err"
[[ "$(cat "$tmp/.kith-inn-v1-current")" == "$current" ]]
grep -q "$current/env" "$tmp/smoke.log"
candidate next
run_deploy success preflight >/dev/null
run_deploy success gate-writes >/dev/null
if run_deploy all-smoke >"$tmp/all-smoke.out" 2>"$tmp/all-smoke.err"; then exit 1; fi
grep -q '"stage":"smoke","recovery":"manual_data_recovery_required"' "$tmp/all-smoke.err"
grep -q -- "-f $current/compose.yml --env-file $current/env stop kith-inn-v1-be" "$tmp/compose.log"
echo "kith-inn-v1 candidate deployment tests passed"
