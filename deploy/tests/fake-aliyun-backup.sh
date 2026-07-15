#!/usr/bin/env bash
set -euo pipefail
operation="${2:-}"
case "$operation" in
  CreateBackup) jq -cn '{BackupJobId:123}' ;;
  DescribeBackupTasks)
    if [[ "${FAKE_BACKUP_MODE:-success}" == timeout ]]; then
      jq -cn '{Items:{BackupJob:[{BackupJobId:123,BackupStatus:"Uploading"}]}}'
    elif [[ "${FAKE_BACKUP_MODE:-success}" == failed ]]; then
      jq -cn '{Items:{BackupJob:[{BackupJobId:123,BackupStatus:"Failed"}]}}'
    else
      jq -cn '{Items:{BackupJob:[{BackupJobId:123,BackupStatus:"Finished",BackupId:456}]}}'
    fi ;;
  DescribeBackups)
    if [[ "${FAKE_BACKUP_MODE:-success}" == unverified ]]; then
      jq -cn '{Items:{Backup:[]}}'
    elif [[ "${FAKE_BACKUP_MODE:-success}" == no-time ]]; then
      jq -cn '{Items:{Backup:[{BackupId:456,BackupStatus:"Success"}]}}'
    else
      jq -cn '{Items:{Backup:[{BackupId:456,BackupStatus:"Success",BackupStartTime:"2026-07-15T15:00:00Z"}]}}'
    fi ;;
  *) exit 2 ;;
esac
