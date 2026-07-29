#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
repo="${REPOSITORY_DIR:-$(pwd)}"
cd "$repo"

write_targets() {
  local website="$1" targets preview_matrix

  if [[ "$website" == true ]]; then
    targets='["website"]'
    preview_matrix='{"include":[{"target":"website","dockerfile":"apps/website/Dockerfile","image":"cfp-website","skip":false}]}'
  else
    targets='[]'
    # GitHub Actions 不接受空 matrix；保留一个明确的 no-op 项，确保 required check 稳定存在。
    preview_matrix='{"include":[{"target":"none","dockerfile":"","image":"","skip":true}]}'
  fi

  printf 'website=%s\n' "$website" >> "$GITHUB_OUTPUT"
  printf 'targets=%s\n' "$targets" >> "$GITHUB_OUTPUT"
  printf 'preview_matrix=%s\n' "$preview_matrix" >> "$GITHUB_OUTPUT"
  printf 'affected deploy targets: %s\n' "$targets"
}

base="${DEPLOY_BASE:-}"
head="${DEPLOY_HEAD:-${GITHUB_SHA:-}}"
if [[ -z "$base" || "$base" == 0000000000000000000000000000000000000000 ]] ||
  [[ -z "$head" ]] ||
  ! git cat-file -e "$base^{commit}" 2>/dev/null ||
  ! git cat-file -e "$head^{commit}" 2>/dev/null; then
  # 无法可靠计算 diff 时宁可多构建/部署，也不能漏掉受影响服务。
  write_targets true
  exit 0
fi

changed_files="$(git diff --name-only "$base" "$head")"
printf '%s\n' "$changed_files"

website_deploy=false
while IFS= read -r path; do
  case "$path" in
    .dockerignore | .github/workflows/ci.yml | .github/workflows/deploy-preview.yml | \
      .github/workflows/deploy-production.yml | package.json | pnpm-lock.yaml | \
      pnpm-workspace.yaml | turbo.json)
      write_targets true
      exit 0
      ;;
    deploy/RUNBOOK.md | deploy/.gitignore | deploy/tests/* | deploy/nginx.example.conf | \
      deploy/verify-nginx-example.sh | deploy/verify-website-cutover.sh)
      ;;
    deploy/resolve-deploy-targets.sh | deploy/smoke-test.sh | deploy/create-rds-backup.sh | \
      deploy/docker-compose.prod.yml | deploy/.env.website.verify.example | deploy/*website*)
      website_deploy=true
      ;;
    deploy/*)
      # 未分类的部署文件按当前全部部署目标处理，避免新增契约文件后漏发。
      write_targets true
      exit 0
      ;;
  esac
done <<< "$changed_files"

if [[ -n "${TURBO_BIN:-}" ]]; then
  turbo=("$TURBO_BIN")
elif [[ -x node_modules/.bin/turbo ]]; then
  turbo=(node_modules/.bin/turbo)
else
  echo 'repository-pinned turbo is required; run pnpm install --frozen-lockfile first' >&2
  exit 1
fi

output="$(TURBO_SCM_BASE="$base" TURBO_SCM_HEAD="$head" \
  "${turbo[@]}" run build --affected --dry-run=json)"
website_affected="$(printf '%s' "$output" | node -e '
  let text = "";
  process.stdin.on("data", chunk => text += chunk).on("end", () => {
    const start = text.indexOf("{");
    if (start < 0) throw new Error("Turbo dry run did not emit JSON.");
    const tasks = JSON.parse(text.slice(start)).tasks ?? [];
    process.stdout.write(tasks.some(task => task.taskId === "@cfp/website#build") ? "true" : "false");
  });
')"

website=false
if [[ "$website_deploy" == true || "$website_affected" == true ]]; then
  website=true
fi
write_targets "$website"
