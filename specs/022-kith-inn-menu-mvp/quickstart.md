# 街坊味菜单 MVP 开发与验证指引

日期：2026-09-20 · 状态：菜池API及小程序客户端基础可验证；菜池页面待接入

`@cfp/kith-inn-contracts` 已提供 build/lint/typecheck/test/test:coverage 脚本；`@cfp/kith-inn-api` 已提供配置校验、五表迁移及真实PG17验证；API已提供 dev/start、微信登录/退出、health/ready、请求校验和脱敏日志，菜池 GET/POST/PATCH、账号锁、版本检查和24小时安全重放已实现，累计67个API测试通过；`@cfp/kith-inn-miniapp` 工程及客户端基础已有24个测试，H5/weapp双构建通过，当前菜池路由仅为占位，T015页面待接入。下面命令供 [tasks.md](tasks.md) 中对应 PR 实施后使用；不能因为命令写在这里，就把应用、数据迁移或验证标为完成。业务范围和规则见 [spec.md](spec.md)，请求响应以 [OpenAPI](contracts/openapi.json) 为准。

## 1. 开始条件

使用包含本功能实现的 checkout，运行 Node 22、pnpm 10.2.0；Docker 提供 PostgreSQL 17 测试基线。实施应从当时最新 main 建独立分支，先检查现有文件和未提交改动，不把用户旧分支的其他修改一并搬入。当前参考工程提交为 `7bb984d6697b74b1f095cb6475be6cb0f4d0e264`。

本轮 1A、2A、3A 业务决定已同步：改结构确认后重排，缺菜整次不生成，分享后可编辑保存并重新复制。用户已确认微信小程序创建完成，沿用现有小程序，不重复注册。真实微信联调需核对该小程序的 AppID、现有权限、服务端密钥配置、桃子 OpenID 绑定及合法 HTTPS request 域名；这些接入条件尚未实测。

## 2. 本地独立数据库

完成 PR2 后，在仓库根目录安装并启动已有本地 PostgreSQL：

```sh
pnpm install --frozen-lockfile
pnpm db:up
```

首次为本功能准备独立开发库和测试库。下面密码只用于本机 Docker 的示例开发环境，不能用于上线配置；已有同名角色/数据库时先核对归属，不删除重建用户现有数据。

```sh
docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE kith_inn_local LOGIN PASSWORD 'kith-inn-local-only';
CREATE DATABASE cfp_kith_inn OWNER kith_inn_local;
CREATE DATABASE cfp_kith_inn_test OWNER kith_inn_local;
SQL
```

设置本终端开发库，执行迁移两次，第二次应只识别已应用记录，不重复建表：

```sh
export KITH_INN_DATABASE_URL='postgresql://kith_inn_local:kith-inn-local-only@127.0.0.1:54324/cfp_kith_inn'
pnpm --filter @cfp/kith-inn-api db:migrate
pnpm --filter @cfp/kith-inn-api db:migrate
```

测试应使用专库，不能从通用 `DATABASE_URL` 静默回退到 website 或 weekly-menu 数据库：

```sh
KITH_INN_DATABASE_URL='postgresql://kith_inn_local:kith-inn-local-only@127.0.0.1:54324/cfp_kith_inn_test' \
  pnpm --filter @cfp/kith-inn-api test
```

数据库测试要实际验证迁移、约束和事务回滚。API 的数据库测试禁用 Turbo 缓存，每次执行都访问专用测试库；URL 的连接目标覆盖参数会被拒绝，连接后再次核对实际数据库名。没有数据库或配置时应报告失败，目标库名不以 `_test` 结尾时拒绝测试清理，不能以跳过通过表示持久化完成。角色在生产环境还应核对最小权限、独立数据库和迁移权限，具体步骤由 PR10 的运行手册承载。

## 3. 约定的运行配置

| 配置 | 使用方 | 来源与要求 |
| --- | --- | --- |
| `KITH_INN_DATABASE_URL` | API、migration、DB 测试 | 本功能专库；测试使用独立库 |
| `KITH_INN_WECHAT_APP_ID` | API | 同一个街坊味小程序的 AppID |
| `KITH_INN_WECHAT_APP_SECRET` | API | 仅服务端密钥配置，不进入源码、前端构建或日志 |
| `KITH_INN_WECHAT_OWNER_OPEN_ID` | API | 桃子在该 AppID 下的 OpenID，部署时核对绑定，不开放自助注册 |
| `PORT` | API | 本产品默认 3305，可显式配置 |
| `RELEASE_SHA` | API、镜像 | 实际构建提交，用于定位验证版本 |
| `TARO_APP_ID` | 小程序构建 | 现有街坊味 AppID，写入生成的 dist/project.config.json |
| `TARO_APP_KITH_INN_API_BASE_URL` | 小程序构建 | HTTPS 服务源站（只含域名和可选端口，不含路径）；配置错误应明确失败，不静默回退 Mock |

服务端微信返回的 `session_key` 不作为自己的登录凭据，不发给客户端。客户端只保存服务端签发的会话令牌和到期信息；菜品和菜单仍以服务端保存版本为准。每次菜品或周菜单写操作生成 UUID 幂等键；同一次网络重试保留原键和原请求体，不因重试生成第二次业务操作。未知结果在24小时内仅能重试原请求，读取或退出不能提前解除；过期后必须重新读取并由用户核对后解除。429按Retry-After冷却后才能重试；微信使用UserCryptoManager安全随机源，H5使用Web Crypto，不支持时明确失败。

## 4. 单元、集成与构建

以下脚本名称由对应包的实现任务提供。依赖关系和每片最小反例见 [plan.md](plan.md)；不必在每次文档改字后运行全部应用测试。

```sh
pnpm --filter @cfp/kith-inn-contracts test
KITH_INN_DATABASE_URL='postgresql://kith_inn_local:kith-inn-local-only@127.0.0.1:54324/cfp_kith_inn_test' \
  pnpm --filter @cfp/kith-inn-api test
pnpm --filter @cfp/kith-inn-miniapp test
pnpm --filter @cfp/kith-inn-miniapp build:h5
pnpm --filter @cfp/kith-inn-miniapp build:weapp
```

前三项分别验证契约、服务与数据库、前端状态和文字。API 测试使用上一节测试库；微信响应和时钟采用依赖注入，不请求真实账户。生成函数应证明只返回预览，保存测试应证明版本冲突不覆盖、同键重试不重复，以及菜池改名/停用不改变已保存快照。

完成 PR9 后运行 H5 联合流程：

```sh
pnpm --filter @cfp/kith-inn-miniapp exec playwright install chromium
pnpm --filter @cfp/kith-inn-miniapp test:e2e
```

H5 测试明确记录注入的微信登录与剪贴板边界；接口错误、重开读取等样例与契约保持一致。它不能代替微信真机登录、剪贴板操作、跨设备恢复或生产数据库恢复。

实现 PR 收口时，使用独立测试库配置运行根门禁：

```sh
KITH_INN_DATABASE_URL='postgresql://kith_inn_local:kith-inn-local-only@127.0.0.1:54324/cfp_kith_inn_test' \
  pnpm verify
git diff --check
```

本地复现 CI 时使用 Node22、`TZ=UTC` 并提供各产品独立数据库。此次本机 Asia/Shanghai 下旧 Weekly Menu 的日期读取测试出现日期偏移，切换为 CI 的 UTC 环境后重新验证；没有为本片修改另一产品。

根门禁包含整个仓库已有产品要求；这里的单个环境变量不是 website、weekly-menu 测试配置的替代品。完整本地环境沿用仓库说明，CI 同时提供各产品独立数据库。

## 5. 联调与可观察结果

会话、健康和菜池接口已可启动，周菜单接口须等后续实现。由维护者在服务端安全配置表内真实值；本指引不提供会把密钥打印到终端的读取命令。启动 API 和前端开发服务分别运行：

```sh
pnpm --filter @cfp/kith-inn-api dev
```

```sh
pnpm --filter @cfp/kith-inn-miniapp dev:h5
```

H5 适合检查界面和受控测试会话，不声称浏览器可直接完成 `wx.login`。设置 `TARO_APP_ID` 为现有街坊味 AppID 后运行 `build:weapp`，微信开发者工具导入 `apps/kith-inn-miniapp/dist`（生成配置的 `miniprogramRoot` 为 `./`）；Taro 不会把根目录的 `project.private.config.json` 自动合并到产物。真机通过已配置的合法 HTTPS 请求域名访问 API，不能用关闭域名校验代替交付条件。

主路径检查：

1. 桃子登录；另一微信身份得不到内部菜池或菜单权限。
2. 每行录入菜品，查看并纠正分类；未确认不进入菜池，确认后全部保存。重复名失败时不出现半批数据。
3. 选择一周午晚餐和统一荤素汤数量，生成预览；跳过餐没有菜，同餐不重复。
4. 换掉一个指定位置，再去掉周三午餐和周五晚餐的汤，其他位置不变。
5. 保存并确认；重开及另一设备读取同一结果。制造保存失败后，旧保存版本仍可读取，界面不能显示保存成功。
6. 从已保存餐次复制文字，检查日期、午晚餐和去汤结果；失败可重试，成功只显示已复制，桃子自行到微信发送。
7. 已换菜/去汤后改周结构，确认覆盖才重排；取消或缺菜失败保留原编辑，成功预览未保存前服务器旧菜单不变。
8. 一餐需两荤但只有一道时提示分类及所需/可用数量，整次不生成；补菜或改结构后重试成功；缺位保存请求被拒绝。
9. 确认、复制后继续换菜，普通保存清原确认状态，保存并确认更新内容；重新复制得到新保存菜名，旧文字不变，提示桃子自行通知邻居，无公布锁。

各步骤记录实际构建提交和使用的环境。通过 Mock 或测试替身的部分单独写明，不能计入真实外部条件。

## 6. 上线与交接仍需的证据

PR10 才提供专用 `deploy/docker-compose.kith-inn.yml`、`deploy/.env.kith-inn.example`、`deploy/nginx.kith-inn.example.conf` 和 `deploy/KITH_INN_RUNBOOK.md`。本次不部署；不要执行现有 website 或 weekly-menu 发布命令来代替新产品的发布安排。

上线验收至少包含：镜像在专用配置下启动，health/ready 有效；数据库角色受限；迁移前生成可读取的专库备份；在隔离目标恢复后，应用可读取同一批菜品和菜单；退出删除流程同时处理主数据、会话及备份中的残留，遵守最终确认的数据承诺。不可只做 `pg_restore --list` 就认定业务数据可恢复，也不在共享数据库实例上原地覆盖恢复。

真实 AppID/域名/经营身份、真机菜单与复制、恢复演练、数据保留/退出删除由 T023/T024 在 `checklists/release-evidence.md` 记录实际日期、构建、操作者与脱敏证据。文件尚未产生或事项未执行时保持未完成；试用后再记录桃子是否能直接按菜单供餐、无需另抄。
