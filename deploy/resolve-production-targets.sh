#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
repo="${REPOSITORY_DIR:-$(pwd)}"
cd "$repo"

write_targets() {
  local website="$1" kith_inn="$2" kith_inn_v1="$3"
  printf 'website=%s\nkith_inn=%s\nkith_inn_v1=%s\n' "$website" "$kith_inn" "$kith_inn_v1" >> "$GITHUB_OUTPUT"
  printf 'affected targets: website=%s kith-inn=%s kith-inn-v1=%s\n' "$website" "$kith_inn" "$kith_inn_v1"
}

[[ "${GITHUB_EVENT_NAME:-}" == push ]] || { echo "production deploy only supports push" >&2; exit 1; }

base="${DEPLOY_BASE:-}"
head="${GITHUB_SHA:-}"
if [[ -z "$base" || "$base" == 0000000000000000000000000000000000000000 ]] ||
  ! git cat-file -e "$base^{commit}" 2>/dev/null ||
  ! git cat-file -e "$head^{commit}" 2>/dev/null; then
  write_targets true false true
  exit 0
fi

changed_files="$(git diff --name-only "$base" "$head")"
printf '%s\n' "$changed_files"

website_deploy=false
kith_inn_v1_deploy=false
while IFS= read -r path; do
  case "$path" in
    .github/workflows/deploy-production.yml | package.json | pnpm-lock.yaml | pnpm-workspace.yaml | turbo.json)
      write_targets true false true
      exit 0
      ;;
    .github/workflows/deploy-kith-inn-v1-production.yml)
      kith_inn_v1_deploy=true
      ;;
    deploy/RUNBOOK.md | deploy/.gitignore | deploy/tests/* | deploy/nginx.example.conf | \
      deploy/verify-nginx-example.sh | deploy/verify-website-cutover.sh)
      ;;
    deploy/resolve-production-targets.sh | deploy/smoke-test.sh | deploy/create-rds-backup.sh)
      write_targets true false true
      exit 0
      ;;
    deploy/docker-compose.prod.yml | deploy/.env.website.verify.example | deploy/*website*)
      website_deploy=true
      ;;
    deploy/*kith-inn-v1*)
      kith_inn_v1_deploy=true
      ;;
    deploy/.env.verify.example | deploy/*kith-inn*)
      # 旧版 production target 已停用；保留文件仅供未来显式重新开通时迁移。
      ;;
    deploy/*)
      # 新增且尚未分类的部署文件按共享契约处理，避免漏发生产目标。
      write_targets true false true
      exit 0
      ;;
  esac
done <<< "$changed_files"

if [[ -n "${TURBO_BIN:-}" ]]; then
  turbo=("$TURBO_BIN")
else
  turbo=(pnpm dlx turbo@2.9.18)
fi

turbo_has_tasks() {
  local filters=() filter output
  for filter in "$@"; do filters+=("--filter=$filter"); done
  output="$("${turbo[@]}" run build "${filters[@]}" --dry-run=json)"
  printf '%s' "$output" | node -e '
    let text = "";
    process.stdin.on("data", chunk => text += chunk).on("end", () => {
      const start = text.indexOf("{");
      if (start < 0) throw new Error("Turbo dry run did not emit JSON.");
      process.stdout.write(JSON.parse(text.slice(start)).tasks.length > 0 ? "true" : "false");
    });
  '
}

website_affected="$(turbo_has_tasks "@cfp/website...[$base]")"
kith_inn_v1_affected="$(turbo_has_tasks \
  "@cfp/cms...[$base]" \
  "@cfp/kith-inn-v1-be...[$base]")"
website=false
kith_inn=false
kith_inn_v1=false
if [[ "$website_deploy" == true || "$website_affected" == true ]]; then website=true; fi
# 旧版尚未发布，production target 保持关闭，避免与 v1 管理的唯一 CMS 竞争 3304。
if [[ "$kith_inn_v1_deploy" == true || "$kith_inn_v1_affected" == true ]]; then kith_inn_v1=true; fi
write_targets "$website" "$kith_inn" "$kith_inn_v1"
