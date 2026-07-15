#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="$repo_root/.github/workflows/deploy-production.yml"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "production workflow verification failed: $*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "$1 is missing: $2"; }

for required in \
  'target:' 'kith_inn:' 'prepare-kith-inn:' 'deploy-kith-inn:' \
  'needs: [affected, prepare-kith-inn, deploy]' "needs.deploy.result == 'success'" \
  "github.ref == 'refs/heads/main'" "github.ref != 'refs/heads/main'" \
  'bash deploy/kith-inn-check-production-env.sh' \
  'bash deploy/create-rds-backup.sh' 'bash ~/cfp-kith/deploy/kith-inn-rollout.sh' \
  'bash deploy/write-smoke-marker.sh' 'name: smoke-passed-${{ github.sha }}' \
  'retention-days: 30'; do
  assert_contains "$workflow" "$required"
done

# 在真实临时 git range 上运行受影响判断；pnpm mock 只替代 Turbo 的 dry-run JSON。
mkdir -p "$tmp/repo/deploy" "$tmp/repo/docs" "$tmp/bin"
cp "$repo_root/deploy/production-targets.sh" "$tmp/repo/deploy/"
cat > "$tmp/bin/pnpm" <<'MOCK'
#!/usr/bin/env bash
if [[ "${MOCK_TURBO_FAIL:-false}" == true ]]; then
  exit 88
elif [[ "$*" == *'@cfp/cms'* && "${MOCK_KITH_AFFECTED:-false}" == true ]]; then
  printf '{"tasks":[{"taskId":"@cfp/cms#build"}]}'
elif [[ "$*" == *'@cfp/website'* && "${MOCK_WEBSITE_AFFECTED:-false}" == true ]]; then
  printf '{"tasks":[{"taskId":"@cfp/website#build"}]}'
else
  printf '{"tasks":[]}'
fi
MOCK
chmod +x "$tmp/bin/pnpm"
(
  cd "$tmp/repo"
  git init -q
  git config user.email verify@example.invalid
  git config user.name verify
  echo initial > docs/readme.md
  git add . && git commit -qm initial
  base="$(git rev-parse HEAD)"
  echo unrelated >> docs/readme.md
  git add . && git commit -qm docs
  output="$tmp/docs.output"
  PATH="$tmp/bin:$PATH" GITHUB_OUTPUT="$output" bash deploy/production-targets.sh push website "$base" HEAD
  grep -qx 'website=false' "$output" && grep -qx 'kith_inn=false' "$output" || fail "docs-only range affected a deploy target"
  if PATH="$tmp/bin:$PATH" MOCK_TURBO_FAIL=true GITHUB_OUTPUT="$tmp/turbo-fail.output" \
    bash deploy/production-targets.sh push website "$base" HEAD >/dev/null 2>&1; then
    fail "failed Turbo dry-run was accepted"
  fi

  base="$(git rev-parse HEAD)"
  mkdir -p apps/kith-inn-be && echo change > apps/kith-inn-be/change.ts
  git add . && git commit -qm kith
  output="$tmp/kith.output"
  PATH="$tmp/bin:$PATH" MOCK_KITH_AFFECTED=true GITHUB_OUTPUT="$output" \
    bash deploy/production-targets.sh push website "$base" HEAD
  grep -qx 'website=false' "$output" && grep -qx 'kith_inn=true' "$output" || fail "kith range was not isolated"

  base="$(git rev-parse HEAD)"
  echo node_modules > .dockerignore
  git add . && git commit -qm docker-context
  output="$tmp/dockerignore.output"
  PATH="$tmp/bin:$PATH" GITHUB_OUTPUT="$output" \
    bash deploy/production-targets.sh push website "$base" HEAD
  grep -qx 'website=true' "$output" && grep -qx 'kith_inn=true' "$output" \
    || fail "root .dockerignore did not affect every root-context image"
)
output="$tmp/manual.output"
GITHUB_OUTPUT="$output" bash "$repo_root/deploy/production-targets.sh" workflow_dispatch kith-inn '' ''
grep -qx 'website=false' "$output" && grep -qx 'kith_inn=true' "$output" || fail "manual kith target was not isolated"
output="$tmp/missing.output"
GITHUB_OUTPUT="$output" bash "$repo_root/deploy/kith-inn-check-production-env.sh" >/dev/null
grep -qx 'configured=false' "$output" || fail "missing kith secrets did not remain unconfigured"

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
    KITH_INN_RELEASE_DIR="$tmp/rollout/deploy" KITH_INN_SMOKE_SCRIPT="$smoke" \
    bash "$tmp/rollout/deploy/kith-inn-rollout.sh" >"$tmp/$mode.output" 2>&1; then
    fail "$mode failure was accepted"
  fi
  grep -Fq 'up -d --no-deps --wait --wait-timeout 120 kith-inn-cms kith-inn-be kith-inn-h5' "$log" \
    || fail "$mode did not restore runtime images"
  [[ ! -e "$tmp/rollout/deploy/smoke-passed.json" ]] || fail "$mode failure generated a marker"
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
  KITH_INN_RELEASE_DIR="$tmp/rollout/deploy" KITH_INN_SMOKE_SCRIPT="$tmp/rollout/deploy/smoke-ok.sh" \
  bash "$tmp/rollout/deploy/kith-inn-rollout.sh" >"$tmp/success.output" 2>&1
grep -Fq 'image rm sha256:stale' "$success_log" || fail "successful rollout did not prune a stale kith image"
for retained in current previous container unrelated; do
  ! grep -Fq "image rm sha256:$retained" "$success_log" || fail "successful rollout pruned retained image: $retained"
done

digest="repo@sha256:$(printf 'a%.0s' {1..64})"
marker="$tmp/smoke-passed.json"
RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 DEPLOY_RUN_ID=123 \
  CMS_IMAGE_DIGEST="$digest" CMS_OPS_IMAGE_DIGEST="$digest" BE_IMAGE_DIGEST="$digest" H5_IMAGE_DIGEST="$digest" \
  SCHEMA_MIGRATION_HEAD=20260714_105116_initial_cms_schema BACKUP_ID=9001 BACKUP_CREATED_AT=2026-07-15T01:02:03Z \
  bash "$repo_root/deploy/write-smoke-marker.sh" "$marker"
jq -e '.schemaVersion == 1 and .releaseSha and .deployRunId and .cmsImageDigest and .cmsOpsImageDigest and
  .beImageDigest and .h5ImageDigest and .schemaMigrationHead and .backupId and .backupCreatedAt and .smokeStatus == "passed"' \
  "$marker" >/dev/null || fail "success marker is incomplete"

echo "production workflow verification passed"
