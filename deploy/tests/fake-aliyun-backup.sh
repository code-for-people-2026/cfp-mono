#!/usr/bin/env bash
set -euo pipefail
operation="${2:-}"
case "$operation" in
  DescribeDBInstances)
    if [[ "${FAKE_BACKUP_MODE:-success}" == endpoint-mismatch ]]; then
      jq -cn '{Items:{DBInstance:[{DBInstanceId:"rm-other"}]}}'
    else
      jq -cn '{Items:{DBInstance:[{DBInstanceId:"rm-test"}]}}'
    fi ;;
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
      jq -cn '{Items:{Backup:[{BackupId:456,BackupStatus:"Success",IsAvail:1}]}}'
    elif [[ "${FAKE_BACKUP_MODE:-success}" == unavailable ]]; then
      jq -cn '{Items:{Backup:[{BackupId:456,BackupStatus:"Success",IsAvail:0,BackupStartTime:"2026-07-15T15:00:00Z"}]}}'
    else
      jq -cn '{Items:{Backup:[{BackupId:456,BackupStatus:"Success",IsAvail:1,BackupStartTime:"2026-07-15T15:00:00Z"}]}}'
    fi ;;
  *) exit 2 ;;
esac
