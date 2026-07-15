#!/usr/bin/env bash
set -euo pipefail

output="${SMOKE_MARKER_OUTPUT:-smoke-passed.json}"
fail() { rm -f -- "$output" "${output}.tmp.$$"; echo 'smoke marker input is invalid' >&2; exit 1; }
[[ -n "$output" && "$output" != *$'\n'* && "$output" != *$'\r'* ]] || exit 1
rm -f -- "$output"
command -v jq >/dev/null || fail

release_sha="${RELEASE_SHA:-}"
run_id="${DEPLOY_RUN_ID:-}"
migration_head="${KITH_INN_MIGRATION_HEAD:-}"
backup_id="${KITH_INN_BACKUP_ID:-}"
backup_created_at="${KITH_INN_BACKUP_CREATED_AT:-}"
smoke_json="${KITH_INN_SMOKE_EVIDENCE_JSON:-}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[1-9][0-9]*$ ]] || fail
[[ "$migration_head" =~ ^[A-Za-z0-9_]+$ && "$backup_id" =~ ^[0-9]+$ ]] || fail
[[ "$backup_created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] || fail

digests=()
for name in KITH_INN_CMS_DIGEST KITH_INN_CMS_OPS_DIGEST KITH_INN_BE_DIGEST KITH_INN_H5_DIGEST; do
  digest="${!name:-}"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail
  digests+=("$digest")
done
smoke="$(jq -cer '
  select(.startedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")) |
  select(.durationMs | type == "number" and . >= 0 and floor == .) |
  select(.checks == ["cms_liveness","cms_readiness","be_liveness","be_readiness","h5",
    "be_ingress_liveness","be_ingress_readiness","be_ingress_auth_boundary","operator","jwt","offerings"]) |
  select(.writeCount == 0 and .redactionPassed == true and .status == "passed")
' <<<"$smoke_json")" || fail

umask 077
tmp="${output}.tmp.$$"; trap 'rm -f -- "$tmp"' EXIT
jq -cn --arg releaseSha "$release_sha" --arg deployRunId "$run_id" \
  --arg cms "${digests[0]}" --arg ops "${digests[1]}" --arg be "${digests[2]}" --arg h5 "${digests[3]}" \
  --arg migration "$migration_head" --arg backupId "$backup_id" --arg backupCreatedAt "$backup_created_at" \
  --argjson smoke "$smoke" '{markerSchemaVersion:1,releaseSha:$releaseSha,deployRunId:$deployRunId,
    cmsImageDigest:$cms,cmsOpsImageDigest:$ops,beImageDigest:$be,h5ImageDigest:$h5,
    schemaMigrationHead:$migration,backupId:$backupId,backupCreatedAt:$backupCreatedAt,
    startedAt:$smoke.startedAt,durationMs:$smoke.durationMs,checks:$smoke.checks,writeCount:$smoke.writeCount,
    redactionPassed:$smoke.redactionPassed,smokeStatus:$smoke.status}' >"$tmp"
mv "$tmp" "$output"; trap - EXIT
