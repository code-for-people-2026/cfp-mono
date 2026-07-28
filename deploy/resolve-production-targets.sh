#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
repo="${REPOSITORY_DIR:-$(pwd)}"
cd "$repo"

write_target() {
  local website="$1"
  printf 'website=%s\n' "$website" >> "$GITHUB_OUTPUT"
  printf 'affected target: website=%s\n' "$website"
}

[[ "${GITHUB_EVENT_NAME:-}" == push ]] || {
  echo "production deploy only supports push" >&2
  exit 1
}

base="${DEPLOY_BASE:-}"
head="${GITHUB_SHA:-}"
if [[ -z "$base" || "$base" == 0000000000000000000000000000000000000000 ]] ||
  ! git cat-file -e "$base^{commit}" 2>/dev/null ||
  ! git cat-file -e "$head^{commit}" 2>/dev/null; then
  write_target true
  exit 0
fi

changed_files="$(git diff --name-only "$base" "$head")"
printf '%s\n' "$changed_files"

website_deploy=false
while IFS= read -r path; do
  case "$path" in
    .github/workflows/deploy-production.yml | package.json | pnpm-lock.yaml | pnpm-workspace.yaml | turbo.json)
      write_target true
      exit 0
      ;;
    deploy/RUNBOOK.md | deploy/.gitignore | deploy/tests/* | deploy/nginx.example.conf | \
      deploy/verify-nginx-example.sh | deploy/verify-website-cutover.sh)
      ;;
    deploy/resolve-production-targets.sh | deploy/smoke-test.sh | deploy/create-rds-backup.sh | \
      deploy/docker-compose.prod.yml | deploy/.env.website.verify.example | deploy/*website*)
      website_deploy=true
      ;;
    deploy/*)
      # 未分类的部署文件按 website 发布契约处理，避免漏发生产目标。
      write_target true
      exit 0
      ;;
  esac
done <<< "$changed_files"

if [[ -n "${TURBO_BIN:-}" ]]; then
  turbo=("$TURBO_BIN")
else
  turbo=(pnpm dlx turbo@2.9.18)
fi

output="$("${turbo[@]}" run build --filter="@cfp/website...[$base]" --dry-run=json)"
website_affected="$(printf '%s' "$output" | node -e '
  let text = "";
  process.stdin.on("data", chunk => text += chunk).on("end", () => {
    const start = text.indexOf("{");
    if (start < 0) throw new Error("Turbo dry run did not emit JSON.");
    process.stdout.write(JSON.parse(text.slice(start)).tasks.length > 0 ? "true" : "false");
  });
')"

website=false
if [[ "$website_deploy" == true || "$website_affected" == true ]]; then
  website=true
fi
write_target "$website"
