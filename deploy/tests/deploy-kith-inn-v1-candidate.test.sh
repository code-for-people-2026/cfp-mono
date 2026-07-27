#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo/deploy/deploy-kith-inn-v1-candidate.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/deploy"
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
candidate() {
  local digest="${1:-current}"
  printf "# candidate\n" >"$tmp/deploy/docker-compose.kith-inn-v1.prod.yml.next"
  printf "KITH_INN_V1_RELEASE_SHA='%s'\n" "$sha" >"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_CMS_IMAGE='registry/cms@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_CMS_OPS_IMAGE='registry/ops@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
  printf "KITH_INN_V1_BE_IMAGE='registry/be@sha256:%s'\n" "$digest" >>"$tmp/.env.kith-inn-v1.next"
}
run_deploy() {
  local mode="$1" action="${2:-deploy}"
  KITH_INN_V1_REMOTE_ROOT="$tmp" RELEASE_SHA="$sha" COMPOSE_BIN="$repo/deploy/tests/fake-kith-v1-compose.sh" SMOKE_BIN="$repo/deploy/tests/fake-kith-v1-smoke.sh" FAKE_COMPOSE_LOG="$tmp/compose.log" FAKE_SMOKE_LOG="$tmp/smoke.log" FAKE_DEPLOY_MODE="$mode" bash "$script" "$action"
}
candidate
run_deploy success preflight | jq -e '.status == "candidate_ready"' >/dev/null
run_deploy success | jq -e '.status == "passed" and .sellerId == "1" and .smokeEvidence.writeCount == 0' >/dev/null
current="$(cat "$tmp/.kith-inn-v1-current")"
[[ -f "$current/env" && -f "$current/compose.yml" ]]
grep -qx "KITH_INN_V1_RELEASE_SHA='$sha'" "$current/env"
candidate next
run_deploy success preflight | jq -e '.status == "candidate_ready"' >/dev/null
grep -q 'image rm registry/cms@sha256:old' "$tmp/compose.log"
! grep -q 'image rm registry/cms@sha256:current' "$tmp/compose.log"
run_deploy success gate-writes | jq -e '.status == "writes_gated"' >/dev/null
if run_deploy smoke >"$tmp/fail.out" 2>"$tmp/fail.err"; then exit 1; fi
grep -q '"recovery":"rolled_back"' "$tmp/fail.err"
[[ "$(cat "$tmp/.kith-inn-v1-current")" == "$current" ]]
grep -q "$current/env" "$tmp/smoke.log"
echo "kith-inn-v1 candidate deployment tests passed"
