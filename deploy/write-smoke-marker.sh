#!/usr/bin/env bash
set -euo pipefail

output="${1:-smoke-passed.json}"
for name in RELEASE_SHA DEPLOY_RUN_ID CMS_IMAGE_DIGEST CMS_OPS_IMAGE_DIGEST BE_IMAGE_DIGEST H5_IMAGE_DIGEST \
  SCHEMA_MIGRATION_HEAD BACKUP_ID BACKUP_CREATED_AT; do
  [[ -n "${!name:-}" ]] || { echo "missing marker field: $name" >&2; exit 2; }
done
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid release SHA" >&2; exit 2; }
for digest in "$CMS_IMAGE_DIGEST" "$CMS_OPS_IMAGE_DIGEST" "$BE_IMAGE_DIGEST" "$H5_IMAGE_DIGEST"; do
  [[ "$digest" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]] || { echo "invalid image digest" >&2; exit 2; }
done
[[ "$BACKUP_CREATED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || {
  echo "invalid backup timestamp" >&2; exit 2;
}
jq -n \
  --arg releaseSha "$RELEASE_SHA" --arg deployRunId "$DEPLOY_RUN_ID" \
  --arg cmsImageDigest "$CMS_IMAGE_DIGEST" --arg cmsOpsImageDigest "$CMS_OPS_IMAGE_DIGEST" \
  --arg beImageDigest "$BE_IMAGE_DIGEST" --arg h5ImageDigest "$H5_IMAGE_DIGEST" \
  --arg schemaMigrationHead "$SCHEMA_MIGRATION_HEAD" --arg backupId "$BACKUP_ID" \
  --arg backupCreatedAt "$BACKUP_CREATED_AT" '{
    schemaVersion: 1, releaseSha: $releaseSha, deployRunId: $deployRunId,
    cmsImageDigest: $cmsImageDigest, cmsOpsImageDigest: $cmsOpsImageDigest,
    beImageDigest: $beImageDigest, h5ImageDigest: $h5ImageDigest,
    schemaMigrationHead: $schemaMigrationHead, backupId: $backupId,
    backupCreatedAt: $backupCreatedAt, smokeStatus: "passed"
  }' > "$output"
