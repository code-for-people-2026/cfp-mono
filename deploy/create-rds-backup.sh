#!/usr/bin/env bash
set -euo pipefail

: "${RDS_INSTANCE_ID:?RDS_INSTANCE_ID is required}"
: "${PAYLOAD_DATABASE_URL:?PAYLOAD_DATABASE_URL is required}"
method="${RDS_BACKUP_METHOD:-Physical}"
attempts="${BACKUP_MAX_ATTEMPTS:-60}"
poll_seconds="${BACKUP_POLL_SECONDS:-10}"
for command in aliyun jq node; do command -v "$command" >/dev/null || { echo "missing command: $command" >&2; exit 2; }; done
[[ "$method" == Physical || "$method" == Snapshot ]] || { echo "invalid RDS backup method" >&2; exit 2; }

# 先证明生产 URL 的 host 确实属于待备份实例，避免把别的 RDS 快照当成本次恢复点。
db_host="$(node <<'NODE'
try {
  const url = new URL(process.env.PAYLOAD_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) process.exit(2);
  process.stdout.write(url.hostname);
} catch {
  process.exit(2);
}
NODE
)" || { echo "invalid PostgreSQL URL" >&2; exit 2; }
net_info="$(aliyun rds DescribeDBInstanceNetInfo --DBInstanceId "$RDS_INSTANCE_ID")"
jq -e --arg host "$db_host" '
  [.. | objects | (.ConnectionString? // .connectionString?) | select(type == "string")] | index($host) != null
' <<<"$net_info" >/dev/null || { echo "database URL is not bound to RDS instance" >&2; exit 3; }

created="$(aliyun rds CreateBackup --DBInstanceId "$RDS_INSTANCE_ID" --BackupMethod "$method")"
job_id="$(jq -er '.BackupJobId | tostring | select(length > 0)' <<<"$created")"
backup_id=""
for ((attempt=1; attempt<=attempts; attempt++)); do
  task="$(aliyun rds DescribeBackupTasks --DBInstanceId "$RDS_INSTANCE_ID" --BackupJobId "$job_id")"
  status="$(jq -r --arg id "$job_id" '
    def list: if type == "array" then . else [.] end;
    ((.Items.BackupJob // []) | list | map(select((.BackupJobId | tostring) == $id)) | first).BackupStatus // "Missing"
  ' <<<"$task")"
  if [[ "$status" == Finished ]]; then
    backup_id="$(jq -r --arg id "$job_id" '
      def list: if type == "array" then . else [.] end;
      ((.Items.BackupJob | list | map(select((.BackupJobId | tostring) == $id)) | first).BackupId // "") | tostring
    ' <<<"$task")"
    [[ -z "$backup_id" ]] || break
  fi
  [[ "$status" != Failed ]] || { echo "RDS backup task failed" >&2; exit 4; }
  (( attempt < attempts )) && sleep "$poll_seconds"
done
[[ -n "$backup_id" ]] || { echo "RDS backup task timed out" >&2; exit 4; }
[[ "$backup_id" =~ ^[A-Za-z0-9._:-]+$ ]] || { echo "invalid RDS backup ID" >&2; exit 4; }

for ((attempt=1; attempt<=attempts; attempt++)); do
  backups="$(aliyun rds DescribeBackups --DBInstanceId "$RDS_INSTANCE_ID" --BackupId "$backup_id")"
  backup="$(jq -ec --arg id "$backup_id" --arg instance "$RDS_INSTANCE_ID" '
    def list: if type == "array" then . else [.] end;
    .Items.Backup | list | map(select((.BackupId | tostring) == $id and .DBInstanceId == $instance)) | first // empty
  ' <<<"$backups")" || true
  if [[ -n "$backup" ]]; then
    status="$(jq -r '.BackupStatus' <<<"$backup")"
    available="$(jq -r '.IsAvail | tostring' <<<"$backup")"
    [[ "$status" != Failed ]] || { echo "RDS backup set failed" >&2; exit 5; }
    if [[ "$status" == Success && "$available" == 1 ]]; then
      jq -ec '{backupId: (.BackupId | tostring), backupCreatedAt: .BackupStartTime} |
        select(.backupCreatedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))' <<<"$backup"
      exit 0
    fi
  fi
  (( attempt < attempts )) && sleep "$poll_seconds"
done
echo "RDS backup set did not become recoverable" >&2
exit 5
