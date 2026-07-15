#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="$repo_root/.github/workflows/deploy-production.yml"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "production workflow verification failed: $*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "$1 is missing: $2"; }

for required in \
  'target:' 'kith_inn:' 'prepare_kith_inn:' 'deploy-kith-inn:' \
  'needs: [affected, prepare_kith_inn, deploy]' "needs.deploy.result == 'success'" \
  "needs.prepare_kith_inn.result == 'success'" \
  "github.ref == 'refs/heads/main'" "github.ref != 'refs/heads/main'" \
  'bash deploy/check-kith-inn-production-config.sh' \
  'bash deploy/create-rds-backup.sh' 'bash ~/cfp-kith/deploy/kith-inn-rollout.sh' \
  'needs.prepare_kith_inn.outputs.cms_digest' 'needs.prepare_kith_inn.outputs.cms_ops_digest' \
  'needs.prepare_kith_inn.outputs.be_digest' 'needs.prepare_kith_inn.outputs.h5_digest' \
  'jq-1.7.1/jq-linux-amd64' '5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5' \
  'KITH_INN_BE_BASE_URL=$remote_be_url'; do
  assert_contains "$workflow" "$required"
done

bash "$repo_root/deploy/tests/production-targets.test.sh"

mkdir -p "$tmp/bin"

# fake aliyun 覆盖 URL/实例绑定、成功备份与不可恢复备份。
cat > "$tmp/bin/aliyun" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
  *DescribeDBInstanceNetInfo*)
    host=rm-test.pg.rds.aliyuncs.com; [[ "${MOCK_RDS_MISMATCH:-false}" == true ]] && host=rm-other.pg.rds.aliyuncs.com
    printf '{"DBInstanceNetInfos":{"DBInstanceNetInfo":[{"ConnectionString":"%s"}]}}' "$host" ;;
  *CreateBackup*) printf '{"BackupJobId":"5071"}' ;;
  *DescribeBackupTasks*)
    if [[ "${MOCK_BACKUP_MISSING:-false}" == true ]]; then backup=''; else backup=',"BackupId":"9001"'; fi
    printf '{"Items":{"BackupJob":[{"BackupJobId":"5071","BackupStatus":"Finished"%s}]}}' "$backup" ;;
  *DescribeBackups*)
    if [[ "${MOCK_BACKUP_UNAVAILABLE:-false}" == true ]]; then status=Failed; available=0; else status=Success; available=1; fi
    printf '{"Items":{"Backup":[{"BackupId":"9001","DBInstanceId":"rm-test","BackupStatus":"%s","IsAvail":%s,"BackupStartTime":"2026-07-15T01:02:03Z"}]}}' "$status" "$available"
    ;;
  *) exit 99 ;;
esac
MOCK
chmod +x "$tmp/bin/aliyun"
backup_json="$(PATH="$tmp/bin:$PATH" RDS_INSTANCE_ID=rm-test \
  PAYLOAD_DATABASE_URL='postgresql://user:secret@rm-test.pg.rds.aliyuncs.com:5432/cfp' \
  BACKUP_POLL_SECONDS=0 bash "$repo_root/deploy/create-rds-backup.sh")"
jq -e '.backupId == "9001" and .backupCreatedAt == "2026-07-15T01:02:03Z"' <<<"$backup_json" >/dev/null \
  || fail "recoverable backup did not produce metadata"
if PATH="$tmp/bin:$PATH" MOCK_BACKUP_UNAVAILABLE=true RDS_INSTANCE_ID=rm-test \
  PAYLOAD_DATABASE_URL='postgresql://user:secret@rm-test.pg.rds.aliyuncs.com:5432/cfp' \
  BACKUP_POLL_SECONDS=0 bash "$repo_root/deploy/create-rds-backup.sh" >/dev/null 2>&1; then
  fail "unrecoverable backup was accepted"
fi
for mode in MOCK_RDS_MISMATCH MOCK_BACKUP_MISSING; do
  if env PATH="$tmp/bin:$PATH" "$mode=true" RDS_INSTANCE_ID=rm-test BACKUP_POLL_SECONDS=0 \
    PAYLOAD_DATABASE_URL='postgresql://user:secret@rm-test.pg.rds.aliyuncs.com:5432/cfp' \
    bash "$repo_root/deploy/create-rds-backup.sh" >/dev/null 2>&1; then
    fail "$mode backup precondition was accepted"
  fi
done

# migration 与 smoke 任一失败都必须触发仅 runtime digest 的回滚。
mkdir -p "$tmp/rollout/deploy"
cp "$repo_root/deploy/docker-compose.kith-inn.prod.yml" "$tmp/rollout/deploy/"
cp "$repo_root/deploy/kith-inn-rollout.sh" "$tmp/rollout/deploy/"
printf 'old=true\n' > "$tmp/rollout/deploy/.env.kith-inn"
printf 'candidate=true\n' > "$tmp/rollout/deploy/.env.kith-inn.next"
cat > "$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
echo "$*" >> "$MOCK_DOCKER_LOG"
if [[ "$*" == *'logs --no-color --no-log-prefix kith-inn-cms-provision'* ]]; then
  printf '{"project":"kith-inn","status":"provisioned","sellerId":"seller-1","offeringCount":1}\n'
elif [[ "$*" == *'config --format json'* ]]; then
  printf '{"services":{"kith-inn-cms-provision":{"environment":{"KITH_INN_TRIAL_OPENID":"masked"}}}}'
elif [[ "$*" == *'config --images'* ]]; then
  if [[ "$*" == *'.env.kith-inn.previous'* ]]; then
    printf 'registry.example/cfp-kith-inn-cms@sha256:%064d\n' 2
  else
    printf 'registry.example/cfp-kith-inn-cms@sha256:%064d\n' 1
  fi
elif [[ "$*" == *'image inspect'* ]]; then
  if [[ "$*" == *'sha256:0000000000000000000000000000000000000000000000000000000000000002'* ]]; then
    printf 'sha256:previous\n'
  else
    printf 'sha256:current\n'
  fi
elif [[ "$*" == 'ps -aq' ]]; then
  printf 'container-retained\n'
elif [[ "$*" == *'inspect --format {{.Image}} container-retained'* ]]; then
  printf 'sha256:container\n'
elif [[ "$*" == *'image ls '*'--format'* ]]; then
  printf '%s\n' \
    'registry.example/cfp-kith-inn-cms sha256:current' \
    'registry.example/cfp-kith-inn-cms sha256:previous' \
    'registry.example/cfp-kith-inn-cms sha256:container' \
    'registry.example/cfp-kith-inn-cms sha256:stale' \
    'registry.example/unrelated sha256:unrelated'
elif [[ "${MOCK_PRUNE_FAIL:-false}" == true && "$*" == *'image rm sha256:stale'* ]]; then
  exit 45
elif [[ "${MOCK_MIGRATION_FAIL:-false}" == true && "$*" == *'--exit-code-from kith-inn-cms-migrate'* ]]; then
  exit 42
elif [[ "${MOCK_CANDIDATE_PULL_FAIL:-false}" == true && "$*" == *' pull' ]]; then
  exit 44
elif [[ "${MOCK_ROLLBACK_FAIL:-false}" == true && "$*" == *'kith-inn-cms kith-inn-be kith-inn-h5'* ]]; then
  exit 43
fi
MOCK
chmod +x "$tmp/bin/docker"
cat > "$tmp/rollout/deploy/smoke-ok.sh" <<'MOCK'
#!/usr/bin/env bash
: "${KITH_INN_BE_BASE_URL:?KITH_INN_BE_BASE_URL is required}"
printf '{"status":"passed"}\n'
MOCK
cat > "$tmp/rollout/deploy/smoke-fail.sh" <<'MOCK'
#!/usr/bin/env bash
exit 13
MOCK
chmod +x "$tmp/rollout/deploy/smoke-"*.sh
run_failure() {
  local mode="$1" smoke="$2" log
  log="$tmp/$mode.log"
  cp "$tmp/rollout/deploy/.env.kith-inn" "$tmp/rollout/deploy/.env.kith-inn.next"
  if PATH="$tmp/bin:$PATH" MOCK_DOCKER_LOG="$log" MOCK_MIGRATION_FAIL="${3:-false}" \
    MOCK_ROLLBACK_FAIL="${4:-false}" MOCK_CANDIDATE_PULL_FAIL="${5:-false}" \
    RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
    KITH_INN_BE_BASE_URL=https://kith.example.cn \
    KITH_INN_RELEASE_DIR="$tmp/rollout/deploy" KITH_INN_SMOKE_SCRIPT="$smoke" \
    bash "$tmp/rollout/deploy/kith-inn-rollout.sh" >"$tmp/$mode.output" 2>&1; then
    fail "$mode failure was accepted"
  fi
  grep -Fq 'up -d --no-deps --wait --wait-timeout 120 kith-inn-cms kith-inn-be kith-inn-h5' "$log" \
    || fail "$mode did not restore runtime images"
}
run_failure migration "$tmp/rollout/deploy/smoke-ok.sh" true
run_failure smoke "$tmp/rollout/deploy/smoke-fail.sh" false
run_failure schema "$tmp/rollout/deploy/smoke-fail.sh" false true
run_failure pull-outage "$tmp/rollout/deploy/smoke-ok.sh" false true true
grep -Fq 'manual_recovery_required' "$tmp/schema.output" || fail "schema-incompatible rollback did not hand off"
! grep -Fq ' stop kith-inn-cms' "$tmp/pull-outage.log" || fail "pre-migration outage stopped healthy runtime"
[[ "$(grep -c -- '--exit-code-from kith-inn-cms-migrate' "$tmp/smoke.log")" == 1 ]] || fail "rollback reran old migration"
[[ "$(grep -c -- '--exit-code-from kith-inn-cms-provision' "$tmp/smoke.log")" == 1 ]] || fail "rollback reran old provision"

printf 'old=true\n' > "$tmp/rollout/deploy/.env.kith-inn"
printf 'candidate=true\n' > "$tmp/rollout/deploy/.env.kith-inn.next"
success_log="$tmp/success.log"
PATH="$tmp/bin:$PATH" MOCK_DOCKER_LOG="$success_log" \
  RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  KITH_INN_BE_BASE_URL=https://kith.example.cn \
  KITH_INN_RELEASE_DIR="$tmp/rollout/deploy" KITH_INN_SMOKE_SCRIPT="$tmp/rollout/deploy/smoke-ok.sh" \
  bash "$tmp/rollout/deploy/kith-inn-rollout.sh" >"$tmp/success.output" 2>&1
grep -Fq 'image rm sha256:stale' "$success_log" || fail "successful rollout did not prune a stale kith image"
prune_line="$(grep -nF 'image rm sha256:stale' "$success_log" | head -n 1 | cut -d: -f1)"
pull_line="$(grep -nF ' pull' "$success_log" | head -n 1 | cut -d: -f1)"
(( prune_line < pull_line )) || fail "stale kith images were not pruned before candidate pull"
for retained in current previous container unrelated; do
  ! grep -Fq "image rm sha256:$retained" "$success_log" || fail "successful rollout pruned retained image: $retained"
done

printf 'old=true\n' > "$tmp/rollout/deploy/.env.kith-inn"
printf 'candidate=true\n' > "$tmp/rollout/deploy/.env.kith-inn.next"
PATH="$tmp/bin:$PATH" MOCK_DOCKER_LOG="$tmp/prune-failure.log" MOCK_PRUNE_FAIL=true \
  RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  KITH_INN_BE_BASE_URL=https://kith.example.cn \
  KITH_INN_RELEASE_DIR="$tmp/rollout/deploy" KITH_INN_SMOKE_SCRIPT="$tmp/rollout/deploy/smoke-ok.sh" \
  bash "$tmp/rollout/deploy/kith-inn-rollout.sh" >"$tmp/prune-failure.output" 2>&1 \
  || fail "post-smoke image cleanup failure blocked a successful rollout"
grep -Fq 'stale_image_cleanup_failed' "$tmp/prune-failure.output" \
  || fail "post-smoke image cleanup failure was not reported"

echo "production workflow verification passed"
