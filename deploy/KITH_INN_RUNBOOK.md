# 街坊味 API 运行手册

适用：规格 022、Issue #360、PR10。准备文件不是上线许可；实际环境与试用证据见
[release-evidence](../specs/022-kith-inn-menu-mvp/checklists/release-evidence.md)。
只操作街坊味专库与专用 compose；不得执行 website/weekly-menu 发布命令。

## 1. 运行前核对

- 记录部署提交、镜像 digest、主机、PG 版本、专库名、操作者与回退镜像；镜像用完整提交 SHA 标签或 digest，禁止 latest。
- 沿用现有小程序，维护者在安全环境核对 AppID、权限、桃子在该 AppID 下的 OpenID、HTTPS request 域名及证书。
- AppSecret 仅写服务器私密文件。示例值不能登录；不把凭据放命令行、Issue、截图、构建参数或日志。不运行会展开密钥的 `docker compose config`。
- 确认备份频率、保留、RPO/RTO、责任人、托管快照/PITR 的删除能力；这些仍待定，文档中的建议不构成用户承诺。
- 首次新建前核对资源不存在；已有同名资源停下核查归属，禁止删除重建。测试库必须以 `_test` 结尾。

## 2. 专库与角色

使用 PG17 管理员通过私密连接配置进入 psql。以下名称仅为新部署示例；密码用 psql `\password` 交互设置，避免写入 SQL 历史。托管 PG 的管理员权限与 TLS CA 需现场核实。

```sql
CREATE ROLE kith_inn_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE kith_inn_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password kith_inn_owner
\password kith_inn_runtime
CREATE DATABASE kith_inn OWNER kith_inn_owner;
REVOKE ALL ON DATABASE kith_inn FROM PUBLIC;
GRANT CONNECT ON DATABASE kith_inn TO kith_inn_runtime;
\connect kith_inn
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kith_inn_runtime;
```

专库 owner 只供迁移/备份，日常 API 使用 runtime；不授予其他产品数据库权限。
其他数据库若仍允许 PUBLIC CONNECT，管理员需核查并单独收紧；不能仅凭本库 GRANT 宣称跨库隔离。
将 `deploy/.env.kith-inn.example` 复制到仓库外绝对路径并 `chmod 600`；分别保存 runtime 和 migration 文件，仅后者使用 owner 连接。
远程 PG 使用验证服务器证书的 TLS 连接配置，不关闭证书验证。

## 3. 构建、备份、迁移与启动

以下命令使用已核实的私密环境文件；不设置真实微信值到构建参数。

```sh
set -eu
test -z "$(git status --porcelain)" # 拒绝把未提交内容标记成 HEAD 镜像
export KITH_INN_RELEASE_SHA="$(git rev-parse HEAD)"
export KITH_INN_IMAGE="your-registry/kith-inn-api:$KITH_INN_RELEASE_SHA"
docker build --build-arg RELEASE_SHA="$KITH_INN_RELEASE_SHA" \
  -f apps/kith-inn-api/Dockerfile -t "$KITH_INN_IMAGE" .
export KITH_INN_ENV_FILE=/secure/kith-inn/runtime.env
# 每次命令显式指定本产品配置，避免当前目录默认 compose。
docker compose -f deploy/docker-compose.kith-inn.yml config --quiet
```

使用 PG17 客户端的私密 `PGSERVICEFILE` / `PGPASSFILE`（权限600），配置 `kith_source` 服务指向已核对专库；不把连接串打印到日志。备份目录位于受控加密存储，下面文件名须全新。

```sh
set -eu
umask 077
export KITH_BACKUP=/secure/backups/kith-inn-YYYYMMDDTHHMMSS.dump
# 首次空库也保留迁移前备份；任何一步失败停止迁移。
test ! -e "$KITH_BACKUP"
pg_dump --dbname=service=kith_source --format=custom --no-owner --no-acl --file="$KITH_BACKUP"
pg_restore --list "$KITH_BACKUP" >/dev/null
sha256sum "$KITH_BACKUP" > "$KITH_BACKUP.sha256"
# list/hash 仅检查归档结构；第4节应用读回成功才证明可恢复。
KITH_INN_ENV_FILE=/secure/kith-inn/migration.env \
  docker compose -f deploy/docker-compose.kith-inn.yml run --rm --no-deps kith-inn-api \
  pnpm --filter @cfp/kith-inn-api db:migrate
# 原命令再次执行应成功，已应用 migration 不重复且校验 checksum。
```

迁移成功后，以 owner 在专库执行：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON merchants, sessions, dishes, week_plans, mutation_receipts TO kith_inn_runtime;
GRANT SELECT ON kith_inn_migrations TO kith_inn_runtime;
-- 后续新增表必须人工审查授权，不默认授予 schema CREATE。
```

```sh
set -eu
docker compose -f deploy/docker-compose.kith-inn.yml up -d --wait kith-inn-api
curl --fail http://127.0.0.1:3305/api/kith-inn/health
curl --fail http://127.0.0.1:3305/api/kith-inn/ready
```

health 仅证明进程存活；ready 校验数据库及 migration checksum，未迁移/断库须503。
检查 runtime 无超级用户、建库、建角色、建表权限，未授权业务读取401。
`nginx.kith-inn.example.conf` 使用保留示例域名，核实后单独安装，`nginx -t` 成功再按授权 reload。
API3305仅 loopback，不开放公网安全组端口；HTTPS入口只代理 `/api/kith-inn/`。
维护者核对绑定后由桃子首次真实登录创建唯一账号；禁止用第一位访客绑定或把测试种子写入生产。

## 4. 隔离恢复（不原地覆盖）

1. 记录开始时间、原库/镜像版本、备份时间/hash和恢复目标。管理员新建隔离数据库/角色，禁止覆盖现有库；隔离服务无公网入口，不调用真实微信。
2. 对照第2节限制角色、库和 schema 权限。用私密 PG service `kith_restore` 指向全新目标，执行下列命令；不使用 `--clean`。

```sh
set -eu
pg_restore --dbname=service=kith_restore --exit-on-error --single-transaction \
  --no-owner --no-acl "$KITH_BACKUP"
psql service=kith_restore -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM sessions;
DELETE FROM mutation_receipts;
COMMIT;
SELECT (SELECT count(*) FROM merchants) AS merchants,
       (SELECT count(*) FROM dishes) AS dishes,
       (SELECT count(*) FROM week_plans) AS weeks;
SQL
```

3. 使用与备份兼容的 API 镜像，连接隔离库，给 runtime 授权；先在原镜像检查 ready，再尝试新版本迁移。用新 compose 项目名及空闲 loopback端口启动，禁止复用现有生产容器。
4. 旧 token 必须401。人工样本允许仅在隔离测试中注入测试身份/新会话；真实恢复在安全批准环境重新微信登录。测试替身不算微信登录证据。
5. **通过应用读取** `/dishes`、`/weeks` 分页及每个 `/weeks/{weekStart}`。与备份前应用响应比较：菜品状态/版本、周结构、14餐快照、确认时间、同周唯一、账号归属；特意包含已改名/停用菜历史快照和去汤餐。禁止只看表行数或归档目录判通过。
6. 记录恢复结束时间/耗时、丢失窗口与每项差异；恢复结果未核对前不切流量。仅当前菜池可读的演练不能勾选完整菜单恢复。

## 5. 失败停止与回退

构建/备份/迁移/ready任一步失败停止后续操作，保留原实例和原库；根据脱敏 requestId诊断。
已提交 migration 不得改 checksum；失败事务由迁移器回滚。不要手工逆向删除列来尝试修复。
只有旧镜像兼容当前 schema 才切回已记录的旧 digest，重复 health/ready及读写检查。
不兼容时使用第4节恢复到新库，核对后另行批准切流量；恢复可能丢失备份后保存，须先说明实际窗口。

## 6. 日常清理与退出删除

到期会话30天、成功回执24小时是技术期限；业务保留/备份频率和期限、日志期限、RPO/RTO及值班责任人仍待确认。
日常清理可由维护者使用专库受控任务执行（当前未安装调度）：

```sql
BEGIN;
DELETE FROM sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL;
DELETE FROM mutation_receipts WHERE expires_at <= now();
COMMIT;
```

退出操作涉及真实删除，需核实请求者、授权范围、目标资源及操作者。本轮仅演练自有假数据。

1. 停止专用 API、备份任务和入口，防止写入/重新登录；在安全配置中撤去经营身份绑定。单纯删 merchant 后仍开着原白名单会重新创建账号。
2. 管理员确认连接的专库名与账号，使用事务锁定唯一 merchant；以下 SQL 仅用于已核对的单账号专库。禁止在其他产品库运行。

```sql
BEGIN;
SELECT id FROM merchants FOR UPDATE;
DELETE FROM mutation_receipts;
DELETE FROM sessions;
DELETE FROM week_plans;
DELETE FROM dishes;
DELETE FROM merchants;
COMMIT;
SELECT (SELECT count(*) FROM merchants) + (SELECT count(*) FROM sessions)
     + (SELECT count(*) FROM dishes) + (SELECT count(*) FROM week_plans)
     + (SELECT count(*) FROM mutation_receipts) AS remaining_rows;
```

3. 验证 remaining_rows=0、旧 token拒绝、入口停止。清除自己控制的备份、恢复库、下载件、测试副本、日志、环境凭据和客户端缓存；逐项记录对象与删除结果，不保留菜名/身份正文。
4. SQL DELETE 不是介质擦除：WAL、PG卷、云盘快照、对象版本、异地副本、PITR与宿主备份都需核查。优先采用独立存储/加密密钥可撤销方案，由存储管理员完成对应销毁和证明；不要对共享实例执行整库/整卷删除。
5. 托管服务无法立即删除时，标记阻塞并解决存储安排或取得明确重新约定；不能用自然到期替代退出即删除。退出记录也须约定最少信息与保留期限。
6. 恢复旧归档前核对退出处置记录，已退出数据不得重新出现；未能证明备份与托管残留处置完毕，不宣布退出删除完成。
