#!/usr/bin/env bash
set -euo pipefail

aliyun_bin="${ALIYUN_BIN:-aliyun}"
region="${ALIYUN_REGION_ID:-}"
instance="${ALIYUN_RDS_INSTANCE_ID:-}"
github_output="${GITHUB_OUTPUT:-}"
retries="${BACKUP_RETRIES:-60}"
sleep_seconds="${BACKUP_SLEEP_SECONDS:-30}"
fail() { printf 'rds backup failed: %s\n' "$1" >&2; exit 1; }

command -v "$aliyun_bin" >/dev/null || fail "aliyun CLI is unavailable"
command -v jq >/dev/null || fail "jq is unavailable"
[[ -n "$region" && -n "$instance" && -n "$github_output" ]] || fail "required configuration is missing"
[[ "$retries" =~ ^[1-9][0-9]*$ && "$sleep_seconds" =~ ^[0-9]+$ ]] || fail "poll configuration is invalid"

create_result="$($aliyun_bin rds CreateBackup --RegionId "$region" --DBInstanceId "$instance" --BackupMethod Physical)" ||
  fail "CreateBackup request failed"
job_id="$(jq -er '.BackupJobId | tostring | select(test("^[0-9]+$"))' <<<"$create_result")" ||
  fail "CreateBackup did not return a job ID"

backup_id=""
for ((attempt=1; attempt<=retries; attempt++)); do
  task_result="$($aliyun_bin rds DescribeBackupTasks --RegionId "$region" --DBInstanceId "$instance" --BackupJobId "$job_id")" ||
    fail "DescribeBackupTasks request failed"
  task="$(jq -cer --arg id "$job_id" '
    [.Items.BackupJob[]? | select((.BackupJobId | tostring) == $id)] | select(length == 1) | .[0]
  ' <<<"$task_result")" ||
    fail "backup job is missing"
  status="$(jq -r '.BackupStatus' <<<"$task")"
  if [[ "$status" == Failed ]]; then fail "backup job failed"; fi
  if [[ "$status" == Finished ]]; then
    backup_id="$(jq -er '.BackupId | tostring | select(test("^[0-9]+$"))' <<<"$task")" ||
      fail "finished job has no backup set"
    break
  fi
  (( attempt < retries )) && sleep "$sleep_seconds"
done
[[ -n "$backup_id" ]] || fail "backup job timed out"

verified="$($aliyun_bin rds DescribeBackups --RegionId "$region" --DBInstanceId "$instance" \
  --BackupId "$backup_id" --BackupStatus Success)" || fail "DescribeBackups request failed"
backup_record="$(jq -cer --arg id "$backup_id" '
  [.Items.Backup[]? | select((.BackupId | tostring) == $id and .BackupStatus == "Success")] |
  select(length == 1) | .[0]
' <<<"$verified")" || fail "backup set is not recoverable"
created_at="$(jq -er '.BackupStartTime | select(test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$"))' <<<"$backup_record")" ||
  fail "backup set has no UTC start time"
printf 'backup_id=%s\nbackup_created_at=%s\n' "$backup_id" "$created_at" >>"$github_output"
jq -cn --arg backupId "$backup_id" --arg backupCreatedAt "$created_at" \
  '{backupId:$backupId,backupCreatedAt:$backupCreatedAt,status:"verified"}'
