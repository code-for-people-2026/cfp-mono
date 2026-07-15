#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/write-kith-inn-smoke-marker.sh"
workflow="$root/.github/workflows/deploy-production.yml"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sha=1234567890abcdef1234567890abcdef12345678
cms="sha256:$(printf '%063d1' 0)"; ops="sha256:$(printf '%063d2' 0)"
be="sha256:$(printf '%063d3' 0)"; h5="sha256:$(printf '%063d4' 0)"
smoke='{"startedAt":"2026-07-15T17:00:00Z","durationMs":1234,"checks":["cms_liveness","cms_readiness","be_liveness","be_readiness","h5","be_ingress_liveness","be_ingress_readiness","be_ingress_auth_boundary","operator","jwt","offerings"],"writeCount":0,"redactionPassed":true,"status":"passed"}'

run_marker() {
  env RELEASE_SHA="$sha" DEPLOY_RUN_ID=29436909014 \
    KITH_INN_CMS_DIGEST="$cms" KITH_INN_CMS_OPS_DIGEST="$ops" \
    KITH_INN_BE_DIGEST="$be" KITH_INN_H5_DIGEST="$h5" \
    KITH_INN_MIGRATION_HEAD=20260714_105116_initial_cms_schema \
    KITH_INN_BACKUP_ID=456 KITH_INN_BACKUP_CREATED_AT=2026-07-15T15:00:00Z \
    KITH_INN_SMOKE_EVIDENCE_JSON="$smoke" KITH_INN_TRIAL_OPENID=secret-sentinel \
    SMOKE_MARKER_OUTPUT="$tmp/smoke-passed.json" "$@" bash "$script"
}

run_marker
jq -e --arg sha "$sha" --arg cms "$cms" --arg ops "$ops" --arg be "$be" --arg h5 "$h5" '
  .markerSchemaVersion == 1 and .releaseSha == $sha and .deployRunId == "29436909014" and
  .cmsImageDigest == $cms and .cmsOpsImageDigest == $ops and .beImageDigest == $be and
  .h5ImageDigest == $h5 and .schemaMigrationHead == "20260714_105116_initial_cms_schema" and
  .backupId == "456" and .backupCreatedAt == "2026-07-15T15:00:00Z" and
  .startedAt == "2026-07-15T17:00:00Z" and .durationMs == 1234 and .writeCount == 0 and
  .redactionPassed == true and .smokeStatus == "passed" and (.checks | length) == 11
' "$tmp/smoke-passed.json" >/dev/null
! grep -q secret-sentinel "$tmp/smoke-passed.json"

must_fail() {
  rm -f "$tmp/smoke-passed.json"
  if run_marker "$@" >/dev/null 2>&1; then echo "$1 必须失败" >&2; exit 1; fi
  [[ ! -e "$tmp/smoke-passed.json" ]]
}
must_fail RELEASE_SHA=short
must_fail DEPLOY_RUN_ID=0
must_fail KITH_INN_CMS_DIGEST=sha256:short
must_fail KITH_INN_BACKUP_ID=
must_fail KITH_INN_BACKUP_CREATED_AT=local-time
must_fail KITH_INN_MIGRATION_HEAD='bad head'
must_fail KITH_INN_SMOKE_EVIDENCE_JSON='{"status":"failed"}'

ruby -ryaml -e '
  workflow = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)
  kith = workflow.dig("jobs", "prepare_kith_inn", "steps")
  marker = kith.index { |step| step["name"] == "Write kith-inn smoke marker" }
  upload = kith.index { |step| step["name"] == "Upload kith-inn smoke marker" }
  deploy = kith.index { |step| step["name"] == "Deploy and smoke kith-inn candidate" }
  abort "marker 顺序无效" unless deploy && marker && upload && deploy < marker && marker < upload
  [kith.fetch(marker), kith.fetch(upload)].each do |step|
    abort "失败路径必须跳过证据" unless step.fetch("if").include?("success()")
  end
  artifact = kith.fetch(upload)
  abort "artifact 配置无效" unless artifact["uses"] == "actions/upload-artifact@v4" &&
    artifact.dig("with", "name").include?("github.sha") && artifact.dig("with", "path") == "smoke-passed.json" &&
    artifact.dig("with", "retention-days") == 30 && artifact.dig("with", "if-no-files-found") == "error"
  website = workflow.dig("jobs", "deploy", "steps")
  abort "website 路径不得上传 kith 凭据" if website.any? { |step| step["uses"] == "actions/upload-artifact@v4" }
' "$workflow"

echo 'smoke marker tests passed'
