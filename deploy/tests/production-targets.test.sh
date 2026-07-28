#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
selector="$root/deploy/resolve-production-targets.sh"
config_check="$root/deploy/check-kith-inn-production-config.sh"
v1_config_check="$root/deploy/check-kith-inn-v1-production-config.sh"
website_config_check="$root/deploy/check-website-production-config.sh"
workflow="$root/.github/workflows/deploy-production.yml"
preview_workflow="$root/.github/workflows/deploy-preview.yml"
v1_workflow="$root/.github/workflows/deploy-kith-inn-v1-production.yml"
shared_compose="$root/deploy/docker-compose.kith-inn.prod.yml"
v1_compose="$root/deploy/docker-compose.kith-inn-v1.prod.yml"
tmp="$(mktemp -d)"
worktree=""
trap 'if [[ -n "$worktree" ]]; then git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true; fi; rm -rf "$tmp"' EXIT

assert_output() {
  local file="$1" website="$2" kith_inn="$3" kith_inn_v1="$4"
  grep -qx "website=$website" "$file"
  grep -qx "kith_inn=$kith_inn" "$file"
  grep -qx "kith_inn_v1=$kith_inn_v1" "$file"
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

if run_selector "$root" workflow_dispatch website "" "$(git -C "$root" rev-parse HEAD)" "$tmp/manual" 2>/dev/null; then
  echo "生产 selector 必须拒绝非 push 事件" >&2; exit 1
fi

run_selector "$root" push "" "" "$(git -C "$root" rev-parse HEAD)" "$tmp/missing-base"
assert_output "$tmp/missing-base" true false true
run_selector "$root" push "" deadbeefdeadbeefdeadbeefdeadbeefdeadbeef "$(git -C "$root" rev-parse HEAD)" "$tmp/unknown-base"
assert_output "$tmp/unknown-base" true false true

worktree="$tmp/worktree"
git -C "$root" worktree add --detach "$worktree" HEAD >/dev/null
base="$(git -C "$worktree" rev-parse HEAD)"
head="$(synthetic_commit apps/website/.production-target-test 'test: website range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/website-range"
assert_output "$tmp/website-range" true false false
base="$head"
head="$(synthetic_commit apps/kith-inn-be/.production-target-test 'test: kith range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/kith-range"
assert_output "$tmp/kith-range" false false false
base="$head"
head="$(synthetic_commit apps/kith-inn-v1-be/.production-target-test 'test: kith v1 range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/kith-v1-range"
assert_output "$tmp/kith-v1-range" false false true
base="$head"
head="$(synthetic_commit apps/cms/.production-target-test 'test: shared cms range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/cms-range"
assert_output "$tmp/cms-range" false false true
base="$head"
head="$(synthetic_commit deploy/website-candidate.fixture 'test: website deploy range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/website-deploy-range"
assert_output "$tmp/website-deploy-range" true false false
base="$head"
head="$(synthetic_commit deploy/kith-inn-candidate.fixture 'test: kith deploy range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/kith-deploy-range"
assert_output "$tmp/kith-deploy-range" false false false
base="$head"
head="$(synthetic_commit deploy/kith-inn-v1-candidate.fixture 'test: kith v1 deploy range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/kith-v1-deploy-range"
assert_output "$tmp/kith-v1-deploy-range" false false true
base="$head"
head="$(synthetic_commit deploy/create-rds-backup.sh 'test: shared backup contract range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/shared-backup-range"
assert_output "$tmp/shared-backup-range" true false true
base="$head"
head="$(synthetic_commit deploy/smoke-test.sh 'test: shared deploy contract range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/shared-contract-range"
assert_output "$tmp/shared-contract-range" true false true
base="$head"
head="$(synthetic_commit deploy/nginx.example.conf 'test: external ingress contract range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/ingress-contract-range"
assert_output "$tmp/ingress-contract-range" false false false
base="$head"
head="$(synthetic_commit deploy/RUNBOOK.md 'test: deploy documentation range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/deploy-docs-range"
assert_output "$tmp/deploy-docs-range" false false false
base="$head"
head="$(synthetic_commit deploy/tests/.production-target-test 'test: deploy test range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/deploy-test-range"
assert_output "$tmp/deploy-test-range" false false false
base="$head"
head="$(synthetic_commit deploy/.production-target-test 'test: unknown deploy range')"
run_selector "$worktree" push "" "$base" "$head" "$tmp/shared-range"
assert_output "$tmp/shared-range" true false true
git -C "$root" worktree remove --force "$worktree" >/dev/null
worktree=""

deploy_job="$(sed -n '/^  deploy:/,$p' "$workflow")"
website_prepare_job="$(sed -n '/^  prepare:/,/^  prepare_kith_inn:/p' "$workflow")"
! grep -q 'workflow_dispatch' "$workflow"
grep -q '^permissions:' "$workflow"
grep -q 'actions: read' "$workflow"
! grep -q 'StrictHostKeyChecking=no' "$workflow"
checkout_line="$(grep -n 'actions/checkout@v4' <<<"$website_prepare_job" | cut -d: -f1)"
config_check_line="$(grep -n 'check-website-production-config.sh' <<<"$website_prepare_job" | cut -d: -f1)"
(( checkout_line < config_check_line ))
grep -q 'needs: \[affected, prepare, prepare_kith_inn\]' <<<"$deploy_job"
grep -q 'timeout-minutes: 120' <<<"$deploy_job"
grep -q "needs.prepare_kith_inn.result == 'success'.*needs.prepare_kith_inn.result == 'skipped'" <<<"$deploy_job"
grep -q 'RELEASE_SHA: \${{ github.sha }}' <<<"$deploy_job"
grep -q 'docker build --build-arg RELEASE_SHA="$RELEASE_SHA"' <<<"$deploy_job"
grep -q 'WEBSITE_IMAGE_TAG.*steps.push.outputs.website_digest' <<<"$deploy_job"
grep -q 'id: rollout' <<<"$deploy_job"
grep -q 'chmod 600 .*\.env.production.next' <<<"$deploy_job"
grep -q 'deploy-website-candidate.sh deploy' <<<"$deploy_job"
grep -q 'deploy-website-candidate.sh finalize' <<<"$deploy_job"
grep -q 'deploy-website-candidate.sh preflight-candidate' <<<"$deploy_job"
stage_line="$(grep -n 'id: stage' <<<"$deploy_job" | cut -d: -f1)"
website_gate_line="$(grep -n 'id: gate' <<<"$deploy_job" | cut -d: -f1)"
website_backup_line="$(grep -n 'id: backup' <<<"$deploy_job" | cut -d: -f1)"
rollout_line="$(grep -n 'id: rollout' <<<"$deploy_job" | cut -d: -f1)"
(( stage_line < website_gate_line && website_gate_line < website_backup_line && website_backup_line < rollout_line ))
grep -q 'deploy-website-candidate.sh gate-writes' <<<"$deploy_job"
website_smoke_step="$(grep -A7 -- '- name: Smoke test' <<<"$deploy_job")"
grep -q 'SITE_URL: https://www.codeforpeople.cn' <<<"$website_smoke_step"
grep -q 'SITE_CONNECT_TO: www.codeforpeople.cn:443:${{ secrets.ECS_HOST }}:443' <<<"$website_smoke_step"
! grep -q 'secrets.NEXT_PUBLIC_SITE_URL' <<<"$website_smoke_step"
grep -A3 'Restore the last-good website' <<<"$deploy_job" | grep -q "steps.gate.outcome != 'skipped'"
grep -q '### website recovery point' <<<"$deploy_job"
grep -q 'Remove local website deployment credentials' <<<"$deploy_job"
grep -A3 'Restore the last-good website' <<<"$deploy_job" | grep -q 'timeout-minutes: 15'
grep -q 'docker build --build-arg RELEASE_SHA="${{ github.sha }}"' "$preview_workflow"
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
grep -q 'KITH_INN_V1_INTERNAL_TOKEN' <<<"$kith_job"
grep -q 'KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN' <<<"$kith_job"
grep -q '^    name: kith-inn-shared$' "$shared_compose"
grep -q 'aliases: \[kith-inn-cms\]' "$shared_compose"
grep -q '^  kith-inn-v1-cms:$' "$v1_compose"
grep -q 'kith-inn-v1-cms-migrate' "$v1_compose"
grep -q 'run --rm --no-deps kith-inn-v1-cms-migrate' "$root/deploy/deploy-kith-inn-v1-candidate.sh"
grep -q 'CMS_BASE_URL: http://kith-inn-cms:3304' "$v1_compose"
grep -A3 '^  kith-inn-v1-be:$' "$v1_compose" | grep -q 'read_only: true'
grep -A3 '^  kith-inn-shared:$' "$v1_compose" | grep -q 'external: true'
grep -q '^  workflow_call:' "$v1_workflow"
! grep -q '^  push:' "$v1_workflow"
! grep -q 'Wait for the shared CMS production rollout' "$v1_workflow"
v1_call_job="$(sed -n '/^  deploy_kith_inn_v1:/,$p' "$workflow")"
grep -q 'needs: \[affected\]' <<<"$v1_call_job"
! grep -q 'needs.prepare_kith_inn' <<<"$v1_call_job"
grep -q "needs.affected.outputs.kith_inn_v1 == 'true'" <<<"$v1_call_job"
grep -q 'uses: ./.github/workflows/deploy-kith-inn-v1-production.yml' <<<"$v1_call_job"
grep -q 'secrets: inherit' <<<"$v1_call_job"
grep -q 'docker build --target jobs' "$v1_workflow"
grep -q 'apps/cms/Dockerfile -t "$KITH_INN_V1_CMS_IMAGE"' "$v1_workflow"
grep -q 'apps/kith-inn-v1-be/Dockerfile' "$v1_workflow"
grep -q 'KITH_INN_V1_CMS_IMAGE' "$v1_workflow"
grep -q 'KITH_INN_V1_PREVIOUS_JWT_SECRET' "$v1_workflow"
grep -q 'KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN' "$v1_workflow"
grep -q 'KITH_INN_V1_PREVIOUS_JWT_SECRET: ${KITH_INN_V1_PREVIOUS_JWT_SECRET:-}' "$v1_compose"
grep -A16 'server_name v1.codeforpeople.cn;' "$root/deploy/nginx.example.conf" | grep -q 'proxy_pass http://127.0.0.1:3311;'

required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_SSH_KNOWN_HOSTS ECS_HOST ECS_USER PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET
  KITH_INN_JWT_SECRET KITH_INN_CMS_INTERNAL_TOKEN KITH_INN_TRIAL_OPENID
  KITH_INN_V1_JWT_SECRET KITH_INN_V1_INTERNAL_TOKEN
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

: > "$tmp/incomplete-previous"
env "${all_values[@]}" KITH_INN_V1_PREVIOUS_JWT_SECRET=previous-value \
  GITHUB_OUTPUT="$tmp/incomplete-previous" bash "$config_check" >"$tmp/incomplete-previous.log"
grep -qx 'configured=false' "$tmp/incomplete-previous"
grep -q 'KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN' "$tmp/incomplete-previous.log"
! grep -q 'previous-value' "$tmp/incomplete-previous.log"

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

v1_required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_SSH_KNOWN_HOSTS ECS_HOST ECS_USER PAYLOAD_DATABASE_URL KITH_INN_PAYLOAD_SECRET
  KITH_INN_V1_JWT_SECRET KITH_INN_V1_INTERNAL_TOKEN KITH_INN_V1_OPERATOR_OPENID
  KITH_INN_V1_WX_APPID KITH_INN_V1_WX_SECRET KITH_INN_V1_BE_BASE_URL
)
v1_values=()
for name in "${v1_required[@]}"; do v1_values+=("$name=production-value-$name"); done
v1_values+=("KITH_INN_V1_BE_BASE_URL=https://v1.codeforpeople.cn")
: > "$tmp/v1-configured"
env "${v1_values[@]}" GITHUB_OUTPUT="$tmp/v1-configured" bash "$v1_config_check" >"$tmp/v1-configured.log"
grep -qx 'configured=true' "$tmp/v1-configured"
: > "$tmp/v1-incomplete-previous"
if env "${v1_values[@]}" KITH_INN_V1_PREVIOUS_JWT_SECRET=previous-value \
  GITHUB_OUTPUT="$tmp/v1-incomplete-previous" bash "$v1_config_check" >"$tmp/v1-incomplete-previous.log" 2>&1; then
  exit 1
fi
grep -qx 'configured=false' "$tmp/v1-incomplete-previous"
grep -q 'KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN' "$tmp/v1-incomplete-previous.log"
! grep -q 'previous-value' "$tmp/v1-incomplete-previous.log"
: > "$tmp/v1-blank-previous"
if env "${v1_values[@]}" KITH_INN_V1_PREVIOUS_JWT_SECRET='   ' \
  KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN=previous-value GITHUB_OUTPUT="$tmp/v1-blank-previous" \
  bash "$v1_config_check" >"$tmp/v1-blank-previous.log" 2>&1; then exit 1; fi
grep -qx 'configured=false' "$tmp/v1-blank-previous"
grep -q 'KITH_INN_V1_PREVIOUS_JWT_SECRET' "$tmp/v1-blank-previous.log"
! grep -q 'previous-value' "$tmp/v1-blank-previous.log"
: > "$tmp/v1-dev-openid"
if env "${v1_values[@]}" KITH_INN_V1_OPERATOR_OPENID=TAOZI-V1-DEV-OPENID GITHUB_OUTPUT="$tmp/v1-dev-openid" \
  bash "$v1_config_check" >"$tmp/v1-dev-openid.log" 2>&1; then exit 1; fi
grep -qx 'configured=false' "$tmp/v1-dev-openid"
grep -q 'KITH_INN_V1_OPERATOR_OPENID' "$tmp/v1-dev-openid.log"
! grep -q 'TAOZI-V1-DEV-OPENID' "$tmp/v1-dev-openid.log"

website_required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_SSH_KNOWN_HOSTS ECS_HOST ECS_USER DATABASE_URL PAYLOAD_SECRET
  NEXT_PUBLIC_SITE_URL DEEPSEEK_API_KEY
)
website_values=()
for name in "${website_required[@]}"; do
  if [[ "$name" == NEXT_PUBLIC_SITE_URL ]]; then
    website_values+=("$name=https://www.codeforpeople.cn")
  else
    website_values+=("$name=website-sentinel-$name")
  fi
done
: > "$tmp/website-configured"
env "${website_values[@]}" GITHUB_OUTPUT="$tmp/website-configured" \
  bash "$website_config_check" > "$tmp/website-configured.log"
grep -qx 'configured=true' "$tmp/website-configured"
! grep -q 'website-sentinel' "$tmp/website-configured.log"

website_missing=()
for entry in "${website_values[@]}"; do
  [[ "$entry" == ECS_SSH_KNOWN_HOSTS=* ]] || website_missing+=("$entry")
done
if env "${website_missing[@]}" GITHUB_OUTPUT="$tmp/website-missing" \
  bash "$website_config_check" > "$tmp/website-missing.log" 2>&1; then
  echo "website 缺配置必须失败" >&2; exit 1
fi
grep -q 'ECS_SSH_KNOWN_HOSTS' "$tmp/website-missing.log"
! grep -q 'website-sentinel' "$tmp/website-missing.log"

if env "${website_values[@]}" NEXT_PUBLIC_SITE_URL=https://demo.codeforpeople.cn \
  GITHUB_OUTPUT="$tmp/website-wrong-url" bash "$website_config_check" \
  > "$tmp/website-wrong-url.log" 2>&1; then
  echo "website canonical URL 错误时必须失败" >&2; exit 1
fi
grep -q 'NEXT_PUBLIC_SITE_URL' "$tmp/website-wrong-url.log"
! grep -q 'website-sentinel' "$tmp/website-wrong-url.log"

echo "production target/config tests passed"
