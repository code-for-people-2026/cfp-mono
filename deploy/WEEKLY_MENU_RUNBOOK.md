# Weekly Menu 最小部署手册

> 本仓库是公开仓库。本文只记录变量名和占位符，不记录真实 IP、实例 ID、连接串、AppID、AppSecret 或密码。

Weekly Menu 是允许短暂停机的个人学习项目。本手册只管理 `${HOME}/cfp-weekly-menu`、
`cfp-weekly-menu` Compose project、`weekly-menu-be` 容器和 Weekly Menu 专库；任何命令都不得
停止、替换、恢复或写入 website。

## 1. 交付物与边界

- 镜像：`cfp-weekly-menu-be:<40 位 main SHA>`。
- 容器：宿主机只绑定 `127.0.0.1:3304`。
- 远端目录：`${HOME}/cfp-weekly-menu`，不得放进 `${HOME}/cfp-mono`。
- 数据库：Weekly Menu 专用库和账号；不连接 website 数据库。
- 公网入口：`https://weekly-menu-api.codeforpeople.cn`，只经 Nginx 80/443。
- website Payload 继续私有；BE 只匿名只读 `GET /api/recipes`。

生产部署保持手工触发。本期不实现零停机、自动回滚、状态机或全局发布锁。

## 2. 一次性准备

在 ECS 上创建独立目录：

```bash
set -euo pipefail
export WEEKLY_MENU_REMOTE_ROOT="${HOME}/cfp-weekly-menu"
test "$WEEKLY_MENU_REMOTE_ROOT" = "${HOME}/cfp-weekly-menu"
test "$WEEKLY_MENU_REMOTE_ROOT" != "${HOME}/cfp-mono"
install -d -m 700 "$WEEKLY_MENU_REMOTE_ROOT/backups"
```

把以下仓库文件复制到该目录，复制后保持 `600` 权限：

- `deploy/docker-compose.weekly-menu.yml` → `docker-compose.yml`
- 私下填写的 `deploy/.env.weekly-menu.example` → `.env.production`
- `deploy/smoke-test.sh` → `smoke-test.sh`（脚本本身可为 `700`）

另建不含业务密钥的 `.env.images`：

```dotenv
WEEKLY_MENU_IMAGE=<ACR_REGISTRY>/<NAMESPACE>/cfp-weekly-menu-be:<40 位 main SHA>@sha256:<digest>
RELEASE_SHA=<同一个 40 位 main SHA>
WEEKLY_MENU_EXPECTED_ROLE=<Weekly Menu 专用普通账号名>
WEEKLY_MENU_ENV_FILE=./.env.production
```

```bash
chmod 600 "$WEEKLY_MENU_REMOTE_ROOT"/.env.production \
  "$WEEKLY_MENU_REMOTE_ROOT"/.env.images \
  "$WEEKLY_MENU_REMOTE_ROOT"/docker-compose.yml
chmod 700 "$WEEKLY_MENU_REMOTE_ROOT"/smoke-test.sh
```

## 3. 构建并推送不可变镜像

只从已经 rebase merge 到 `main` 的提交构建。ACR 密码通过标准输入提供，不写进命令历史：

```bash
set -euo pipefail
git fetch --no-tags origin main
release_sha="$(git rev-parse HEAD)"
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
test "$release_sha" = "$(git rev-parse origin/main)"
test "${#release_sha}" = 40
weekly_image="<ACR_REGISTRY>/<NAMESPACE>/cfp-weekly-menu-be:$release_sha"

printf '%s' "$ACR_PASSWORD" | docker login \
  --username "$ACR_USERNAME" --password-stdin '<ACR_REGISTRY>'
docker build --platform linux/amd64 --build-arg RELEASE_SHA="$release_sha" \
  -f apps/weekly-menu-be/Dockerfile -t "$weekly_image" .
docker push "$weekly_image"
docker buildx imagetools inspect "$weekly_image"
docker logout '<ACR_REGISTRY>'
unset ACR_PASSWORD ACR_USERNAME
```

从 inspect 输出记录 digest，再填写远端 `.env.images`。不得使用 `latest` 或可变 tag。

## 4. 发布前检查（此阶段失败不得停止当前 Weekly Menu）

1. 人工确认当前没有 website 生产发布运行，并约定本次短暂停机窗口内不触发 website 发布。
2. 确认 `.env.production` 的四个变量均已安全填写，文件权限为 `600`。
3. 确认 image 使用不可变 SHA tag + digest，随后在停止旧容器前完成拉取。
4. 确认 website ready，且匿名 recipes 的三个 active 分类各非空。

```bash
set -euo pipefail
cd "$WEEKLY_MENU_REMOTE_ROOT"
compose=(docker compose --project-name cfp-weekly-menu --env-file .env.images -f docker-compose.yml)
"${compose[@]}" config --quiet
"${compose[@]}" pull weekly-menu-be
docker pull postgres:17-alpine

image_value() {
  sed -n "s/^$1=//p" .env.images | tail -n 1
}
release_sha="$(image_value RELEASE_SHA)"
weekly_image="$(image_value WEEKLY_MENU_IMAGE)"
expected_role="$(image_value WEEKLY_MENU_EXPECTED_ROLE)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$weekly_image" == *":$release_sha@sha256:"* ]]
test "$(docker image inspect --format \
  '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$weekly_image")" = "$release_sha"

curl -fsS https://www.codeforpeople.cn/api/ready >/dev/null
env_value() {
  sed -n "s/^$1=//p" .env.production | tail -n 1
}
for name in WEEKLY_MENU_DATABASE_URL WEEKLY_MENU_RECIPES_BASE_URL \
  WEEKLY_MENU_WECHAT_APP_ID WEEKLY_MENU_WECHAT_APP_SECRET; do
  value="$(env_value "$name")"
  test -n "${value//[[:space:]]/}"
done
WEEKLY_MENU_DATABASE_URL="$(env_value WEEKLY_MENU_DATABASE_URL)"
export WEEKLY_MENU_DATABASE_URL
database_identity="$(docker run --rm --network host \
  -e WEEKLY_MENU_DATABASE_URL postgres:17-alpine sh -euc \
  'psql --dbname="$WEEKLY_MENU_DATABASE_URL" --no-align --tuples-only \
    --field-separator="|" --set=ON_ERROR_STOP=1 \
    --command="SELECT current_database(), current_user, \
      NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls), \
      has_schema_privilege(current_user, current_schema(), '\''USAGE,CREATE'\'') \
      FROM pg_roles WHERE rolname = current_user"')"
IFS='|' read -r actual_database actual_role restricted_role schema_access \
  <<<"$database_identity"
test "$actual_database" = study_weekly_menu
test "$actual_role" = "$expected_role"
test "$restricted_role" = t
test "$schema_access" = t
recipes_base_url="$(env_value WEEKLY_MENU_RECIPES_BASE_URL)"
recipes="$(curl -fsS --get "${recipes_base_url%/}/api/recipes" \
  --data-urlencode 'where[active][equals]=true' --data-urlencode 'limit=0')"
for category in big-meat small-meat vegetable; do
  jq -e --arg category "$category" \
    '.docs | any(.active == true and .category == $category)' <<<"$recipes" >/dev/null
done
unset actual_database actual_role database_identity expected_role recipes \
  recipes_base_url release_sha restricted_role schema_access \
  value WEEKLY_MENU_DATABASE_URL weekly_image
```

任一检查失败时立即退出，保持当前运行态。Weekly Menu 不执行 website seed 或 CMS 写入。

## 5. 八步短暂停机发布

以下命令只在前置检查全部通过后执行。首次发布没有旧容器，第 1 步自然为空。

```bash
set -euo pipefail
cd "$WEEKLY_MENU_REMOTE_ROOT"
compose=(docker compose --project-name cfp-weekly-menu --env-file .env.images -f docker-compose.yml)

# 1. 只停止旧 Weekly Menu。
"${compose[@]}" stop weekly-menu-be

# 2. 为 Weekly Menu 专库创建并校验逻辑备份。
WEEKLY_MENU_DATABASE_URL="$(sed -n 's/^WEEKLY_MENU_DATABASE_URL=//p' \
  .env.production | tail -n 1)"
export WEEKLY_MENU_DATABASE_URL
backup_name="weekly-menu-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e WEEKLY_MENU_DATABASE_URL -e BACKUP_NAME="$backup_name" \
  -v "$WEEKLY_MENU_REMOTE_ROOT/backups:/backups" postgres:17-alpine \
  sh -euc 'umask 077; pg_dump --dbname="$WEEKLY_MENU_DATABASE_URL" --format=custom --no-owner --no-acl \
    --file="/backups/$BACKUP_NAME" && pg_restore --list "/backups/$BACKUP_NAME" >/dev/null'
test -s "$WEEKLY_MENU_REMOTE_ROOT/backups/$backup_name"
chmod 600 "$WEEKLY_MENU_REMOTE_ROOT/backups/$backup_name"
unset WEEKLY_MENU_DATABASE_URL

# 3. 只对 Weekly Menu 专库执行 forward-only migration。
"${compose[@]}" run --rm --no-deps weekly-menu-be \
  pnpm --filter @cfp/weekly-menu-be db:migrate

# 4. 启动唯一的新容器。
"${compose[@]}" up -d --no-deps weekly-menu-be

# 5. 本机检查 health、ready 和无凭据 401。
release_sha="$(sed -n 's/^RELEASE_SHA=//p' .env.images)"
RELEASE_SHA="$release_sha" WEEKLY_MENU_URL=http://127.0.0.1:3304 \
  bash ./smoke-test.sh weekly-menu
```

然后完成剩余三步人工操作：

6. 将 `deploy/nginx.weekly-menu.example.conf` 填入独立 include，配置 DNS 与证书；运行
   `nginx -t` 成功后才 reload。不要开放安全组 `3304`。
7. 运行公网 smoke，并确认 website 仍可用：

   ```bash
   set -euo pipefail
   RELEASE_SHA="$release_sha" WEEKLY_MENU_URL=https://weekly-menu-api.codeforpeople.cn \
     bash ./smoke-test.sh weekly-menu
   curl -fsS https://www.codeforpeople.cn/ >/dev/null
   ```

8. 人工记录 main SHA、镜像 digest 和备份文件名后确认完成。只记录标识，不记录凭据。

## 6. 失败与恢复

- 前置检查失败：保持当前运行态，不停止容器。
- 停止旧 BE 后任一步失败：再次执行 `stop weekly-menu-be`，保持 Weekly Menu 停止，保留日志和逻辑备份。
- 兼容 migration：经人工确认后，可把 `.env.images` 改回上一不可变镜像，再启动并 smoke。
- 不兼容 migration：不得自动导入备份。先在隔离目标验证恢复，再由用户人工确认数据恢复或切换。
- 共享 RDS 实例绝不原地整实例恢复；实例级备份只能恢复到隔离实例/目标，再提取 Weekly Menu 专库。
- 任何失败路径都不得停止、替换、恢复或清理 website。

## 7. 微信交接

HTTPS 服务稳定后，#317 才把同一个真实 AppID 写入被 Git 精确忽略的
`apps/community-cooking/project.private.config.json`，在微信公众平台配置合法 request 域名，
并由用户通过微信开发者工具手工上传体验版、完成真机 `wx.login` Happy Path。AppSecret 永远只在服务端。
