#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
selector="$root/deploy/resolve-production-targets.sh"
config_check="$root/deploy/check-kith-inn-production-config.sh"
workflow="$root/.github/workflows/deploy-production.yml"
preview_workflow="$root/.github/workflows/deploy-preview.yml"
tmp="$(mktemp -d)"
worktree=""
trap 'if [[ -n "$worktree" ]]; then git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true; fi; rm -rf "$tmp"' EXIT

assert_output() {
  local file="$1" website="$2" kith_inn="$3"
  grep -qx "website=$website" "$file"
  grep -qx "kith_inn=$kith_inn" "$file"
}

run_selector() {
  local repo="$1" event="$2" target="$3" base="$4" head="$5" output="$6"
  : > "$output"
  GITHUB_EVENT_NAME="$event" DEPLOY_TARGET="$target" DEPLOY_BASE="$base" GITHUB_SHA="$head" \
    GITHUB_OUTPUT="$output" REPOSITORY_DIR="$repo" TURBO_BIN="$root/node_modules/.bin/turbo" \
    bash "$selector"
}

synthetic_commit() {
  local path="$1" message="$2"
  printf 'production target fixture\n' > "$worktree/$path"
  git -C "$worktree" add "$path"
  git -C "$worktree" -c user.name=fixture -c user.email=fixture@example.invalid \
    commit -m "$message" --quiet
  git -C "$worktree" rev-parse HEAD
}

run_selector "$root" workflow_dispatch website "" "$(git -C "$root" rev-parse HEAD)" "$tmp/manual-website"
assert_output "$tmp/manual-website" true false
run_selector "$root" workflow_dispatch kith-inn "" "$(git -C "$root" rev-parse HEAD)" "$tmp/manual-kith"
assert_output "$tmp/manual-kith" false true

if run_selector "$root" workflow_dispatch unknown "" "$(git -C "$root" rev-parse HEAD)" "$tmp/manual-invalid" 2>/dev/null; then
  echo "非法手动 target 必须失败" >&2
  exit 1
fi

run_selector "$root" push "" "" "$(git -C "$root" rev-parse HEAD)" "$tmp/missing-base"
assert_output "$tmp/missing-base" true true
run_selector "$root" push "" deadbeefdeadbeefdeadbeefdeadbeefdeadbeef "$(git -C "$root" rev-parse HEAD)" "$tmp/unknown-base"
assert_output "$tmp/unknown-base" true true

worktree="$tmp/worktree"
git -C "$root" worktree add --detach "$worktree" HEAD >/dev/null
base="$(git -C "$worktree" rev-parse HEAD)"
head="$(synthetic_commit apps/website/.production-target-test 'test: website range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/website-range"
assert_output "$tmp/website-range" true false
base="$head"
head="$(synthetic_commit apps/kith-inn-be/.production-target-test 'test: kith range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/kith-range"
assert_output "$tmp/kith-range" false true
base="$head"
head="$(synthetic_commit deploy/website-candidate.fixture 'test: website deploy range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/website-deploy-range"
assert_output "$tmp/website-deploy-range" true false
base="$head"
head="$(synthetic_commit deploy/kith-inn-candidate.fixture 'test: kith deploy range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/kith-deploy-range"
assert_output "$tmp/kith-deploy-range" false true
base="$head"
head="$(synthetic_commit deploy/create-rds-backup.sh 'test: kith backup contract range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/kith-backup-range"
assert_output "$tmp/kith-backup-range" false true
base="$head"
head="$(synthetic_commit deploy/smoke-test.sh 'test: shared deploy contract range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/shared-contract-range"
assert_output "$tmp/shared-contract-range" true true
base="$head"
head="$(synthetic_commit deploy/RUNBOOK.md 'test: deploy documentation range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/deploy-docs-range"
assert_output "$tmp/deploy-docs-range" false false
base="$head"
head="$(synthetic_commit deploy/tests/.production-target-test 'test: deploy test range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/deploy-test-range"
assert_output "$tmp/deploy-test-range" false false
base="$head"
head="$(synthetic_commit deploy/.production-target-test 'test: unknown deploy range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/shared-range"
assert_output "$tmp/shared-range" true true
git -C "$root" worktree remove --force "$worktree" >/dev/null
worktree=""

deploy_job="$(sed -n '/^  deploy:/,$p' "$workflow")"
grep -q 'needs: \[affected, prepare, prepare_kith_inn\]' <<<"$deploy_job"
grep -q "needs.prepare_kith_inn.result == 'success'.*needs.prepare_kith_inn.result == 'skipped'" <<<"$deploy_job"
grep -q 'RELEASE_SHA: \${{ github.sha }}' <<<"$deploy_job"
grep -q 'docker build --build-arg RELEASE_SHA="$RELEASE_SHA"' <<<"$deploy_job"
grep -q 'docker build --build-arg RELEASE_SHA="${{ github.event.pull_request.head.sha }}"' "$preview_workflow"
kith_job="$(sed -n '/^  prepare_kith_inn:/,/^  deploy:/p' "$workflow")"
stage_line="$(grep -n 'id: stage' <<<"$kith_job" | cut -d: -f1)"
gate_line="$(grep -n 'id: gate' <<<"$kith_job" | cut -d: -f1)"
backup_line="$(grep -n 'id: backup' <<<"$kith_job" | cut -d: -f1)"
kith_deploy_line="$(grep -n 'id: deploy' <<<"$kith_job" | cut -d: -f1)"
(( stage_line < gate_line && gate_line < backup_line && backup_line < kith_deploy_line ))
grep -q 'docker-compose.kith-inn.prod.yml.next' <<<"$kith_job"
grep -q "steps.gate.outcome != 'skipped'" <<<"$kith_job"
grep -q 'failure() || cancelled()' <<<"$kith_job"
grep -q 'preflight-candidate' <<<"$kith_job"
grep -A2 'Restore the last-good runtime' <<<"$kith_job" | grep -q 'timeout-minutes: 30'
grep -q 'GITHUB_STEP_SUMMARY' <<<"$kith_job"

required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_SSH_KNOWN_HOSTS ECS_HOST ECS_USER PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET
  KITH_INN_JWT_SECRET KITH_INN_CMS_INTERNAL_TOKEN KITH_INN_TRIAL_OPENID
  KITH_INN_WX_APPID KITH_INN_WX_SECRET KITH_INN_DEEPSEEK_API_KEY KITH_INN_BE_BASE_URL
)
all_values=()
for name in "${required[@]}"; do all_values+=("$name=secret-sentinel-$name"); done

: > "$tmp/configured"
env "${all_values[@]}" GITHUB_OUTPUT="$tmp/configured" bash "$config_check" > "$tmp/configured.log"
grep -qx 'configured=true' "$tmp/configured"
if grep -q 'secret-sentinel' "$tmp/configured.log"; then
  echo "配置检查不得回显值" >&2
  exit 1
fi

missing_values=()
for entry in "${all_values[@]}"; do
  [[ "$entry" == KITH_INN_WX_SECRET=* ]] || missing_values+=("$entry")
done
: > "$tmp/missing"
env "${missing_values[@]}" GITHUB_OUTPUT="$tmp/missing" bash "$config_check" > "$tmp/missing.log"
grep -qx 'configured=false' "$tmp/missing"
grep -q 'KITH_INN_WX_SECRET' "$tmp/missing.log"
if grep -q 'secret-sentinel' "$tmp/missing.log"; then
  echo "缺配置日志不得回显其他值" >&2
  exit 1
fi

: > "$tmp/blank"
env "${all_values[@]}" KITH_INN_BE_BASE_URL='   ' GITHUB_OUTPUT="$tmp/blank" bash "$config_check" > "$tmp/blank.log"
grep -qx 'configured=false' "$tmp/blank"
grep -q 'KITH_INN_BE_BASE_URL' "$tmp/blank.log"

echo "production target/config tests passed"
