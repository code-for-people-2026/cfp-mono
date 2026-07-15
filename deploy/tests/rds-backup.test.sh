#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/create-rds-backup.sh"
fake="$root/deploy/tests/fake-aliyun-backup.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
run() {
  GITHUB_OUTPUT="$tmp/output" ALIYUN_BIN="$fake" ALIYUN_REGION_ID=cn-shenzhen \
    ALIYUN_RDS_INSTANCE_ID=rm-test PAYLOAD_DATABASE_URL='postgresql://cms:p%40ss@rm-test.pg.rds.aliyuncs.com:5432/cfp' \
    BACKUP_RETRIES=2 BACKUP_SLEEP_SECONDS=0 \
    FAKE_BACKUP_MODE="$1" bash "$script"
}
run success >"$tmp/result"
grep -qx 'backup_id=456' "$tmp/output"
grep -qx 'backup_created_at=2026-07-15T15:00:00Z' "$tmp/output"
jq -e '.backupId == "456" and .status == "verified"' "$tmp/result" >/dev/null
for mode in endpoint-mismatch failed unverified unavailable no-time timeout; do
  : >"$tmp/output"
  if run "$mode" >"$tmp/$mode.out" 2>"$tmp/$mode.err"; then
    echo "expected $mode backup to fail" >&2; exit 1
  fi
  [[ ! -s "$tmp/output" ]]
  grep -q 'rds backup failed:' "$tmp/$mode.err"
done
echo "rds backup tests passed"
