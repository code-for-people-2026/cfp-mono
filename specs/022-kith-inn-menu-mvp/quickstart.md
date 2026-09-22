# 街坊味菜单 MVP 开发与验证指引

日期：2026-09-22 · 状态：菜池、周菜单、历史与复制已可本地 H5 联调；集成 PR #376，真机待验收

当前 checkout 已提供共享契约、API/五表迁移、菜池与周菜单服务，以及 H5/weapp 客户端。下面命令可验证菜池→排菜→保存→历史→复制流程；各版本的检查结果见 PR #376 和 [合并核查记录](checklists/merge-review.md)。真实微信及生产恢复验收仍未完成。业务范围和规则见 [spec.md](spec.md)，请求响应以 [OpenAPI](contracts/openapi.json) 为准。

## 1. 开始条件

使用包含本功能实现的 checkout，运行 Node 22、pnpm 10.2.0；Docker 提供 PostgreSQL 17 测试基线。后续实施从届时最新 main 建独立分支，先检查现有文件和未提交改动，不搬入用户旧分支的其他修改。`7bb984d` 仅为最初规划基线，不包含本版实现。

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

当前 H5 回归已包含菜池及完整周菜单联合流程：

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

## 5. 单独启动与联调前提

会话、健康、菜池及周菜单接口均已实现。由维护者在服务端安全配置表内真实值；本指引不提供会把密钥打印到终端的读取命令。以下命令只分别启动 API 和前端开发服务器，**不是开箱即用的 H5→真实 API 联调步骤**：仓库没有 H5 开发代理或浏览器测试登录入口。客户端还要求构建时提供已配置的 HTTPS API 源站，空值/HTTP 地址会被拒绝。

```sh
pnpm --filter @cfp/kith-inn-api dev
```

```sh
pnpm --filter @cfp/kith-inn-miniapp dev:h5
```

H5 适合检查界面和受控测试会话，不声称浏览器可直接完成 `wx.login`。设置 `TARO_APP_ID` 为现有街坊味 AppID 后运行 `build:weapp`，微信开发者工具导入 `apps/kith-inn-miniapp/dist`（生成配置的 `miniprogramRoot` 为 `./`）；Taro 不会把根目录的 `project.private.config.json` 自动合并到产物。真机通过已配置的合法 HTTPS 请求域名访问 API，不能用关闭域名校验代替交付条件。

Taro 4.2.0 原生在 `generateProjectConfig` 中读取 `TARO_APP_ID`，覆盖生成产物的 `appid`；根配置的 `touristappid` 仅为未提供环境变量时的本地构建默认值。实际上传前必须检查生成的 `dist/project.config.json`，确认其 AppID 与服务端配置及现有小程序一致。测试占位 AppID 的构建成功只证明注入机制，不证明微信登录。

本轮用户正在使用的 H5 真实 API 联调，由**仓库外的临时验收启动器**提供同源转发、传输适配和测试微信身份；这些工具没有随本次代码提交，不能靠上面的两条命令复现。仓库内可直接复现的入口是第 4 节的 Playwright H5 回归（受控 HTTP/微信替身）和独立 PostgreSQL API 测试，两者的边界须分别记录。

API 当前没有开放 CORS，客户端也不会把 HTTP 本机地址当作合法源站。可共享的真实 H5 联调入口仍需 #360 提供明确的 HTTPS 源站、同源代理及隔离测试会话配置；若部署采用不同源，必须单独验证精确允许的 Origin 与预检请求，不能使用允许任意来源的配置代替。反向代理场景的登录限流地址识别也在部署前核验，不能直接信任任意 `X-Forwarded-For`。下列检查是联调环境具备后的验收目标，不代表上述单独启动命令已提供这些外部条件。

主路径检查：

1. 桃子登录；另一微信身份得不到内部菜池或菜单权限。
2. 每行录入菜品，查看并纠正分类；未确认不进入菜池，确认后全部保存。重复名失败时不出现半批数据。
3. 选择一周午晚餐和统一荤素汤数量，生成预览；跳过餐没有菜，同餐不重复。
4. 换掉一个指定位置，再进入检查页，返回调整时草稿仍在。
5. 保存并确认；重开及另一设备读取同一结果。制造保存失败后，旧保存版本仍可读取，界面不能显示保存成功。
6. 从已保存餐次进入复制页，在具体这一餐关闭“本餐做汤”并保存；其他餐次不变。核对日期、午晚餐和无汤文字，分别编辑/复制接龙说明与填写示例；失败保留文字可重试，复制本身不写回菜单，桃子自行到微信粘贴。
7. 已换菜/去汤后改周结构，确认覆盖才重排；取消或缺菜失败保留原编辑，成功预览未保存前服务器旧菜单不变。
8. 一餐需两荤但只有一道时提示分类及所需/可用数量，整次不生成；补菜或改结构后重试成功；缺位保存请求被拒绝。
9. 确认、复制后继续换菜，普通保存清原确认状态，保存并确认更新内容；重新复制得到新保存菜名，旧文字不变，由桃子自行通知邻居，页面不展示相关解释提示，无公布锁。

各步骤记录实际构建提交和使用的环境。通过 Mock 或测试替身的部分单独写明，不能计入真实外部条件。

## 6. 上线与交接仍需的证据

独立 PR #368 已准备专用 compose/env/nginx 与运行手册，未包含在 PR #376 的本地 MVP 集成内。不要执行现有 website 或 weekly-menu 发布命令来代替街坊味的发布安排。

上线验收至少包含：镜像在专用配置下启动，health/ready 有效；数据库角色受限；迁移前生成可读取的专库备份；在隔离目标恢复后，应用可读取同一批菜品和菜单；退出删除流程同时处理主数据、会话及备份中的残留，遵守最终确认的数据承诺。不可只做 `pg_restore --list` 就认定业务数据可恢复，也不在共享数据库实例上原地覆盖恢复。

真实 AppID/域名/经营身份、真机菜单与复制、恢复演练、数据保留/退出删除由 T023/T024 在 `checklists/release-evidence.md` 记录实际日期、构建、操作者与脱敏证据。文件尚未产生或事项未执行时保持未完成；试用后再记录桃子是否能直接按菜单供餐、无需另抄。

## 7. 本轮菜池实现的验证记录

2026-09-20，菜池页面源码 `10b56b5`，Node22.23.2、TZ=UTC、隔离PG17下根 `pnpm verify` 通过：契约37、API67、前端33项测试；另有5条受控HTTP的H5浏览器回归通过，覆盖分类往返、维护、失败留稿、未知结果同请求重试、过期重新读取核对、键盘操作及刷新重开。独立审查问题已收敛。

另在全新 `cfp_kith_inn_ui_test` 库执行浏览器联调：注入测试微信身份取得真实业务会话，通过H5测试传输适配访问实际HTTP/API和PG；先成功提交批量新增再故意丢弃201响应，页面保持未知状态，重试使用相同key/body，库内仍只有3道菜；改名、改类、停用后恢复达到version3；刷新及第二个独立会话读回相同结果。页面脚本错误0，390px无横向溢出，手机录入/预览/列表及1280px桌面截图已检查。测试仅适配微信身份与本地HTTP传输，未替换菜品服务或数据库。

浏览器实测修复了三个构建/平台问题：显式注入公开API源站、H5原生按钮与输入区样式、H5 hash路由配合静态验证服务后可刷新重开。微信沿用原小程序入口；尚未获取真实AppID、合法request域名和桃子身份绑定，未进行真机或跨真实设备验收。上述H5第二会话不能作为微信跨设备证据，T023/T024仍未执行。


## 8. 原型视觉验收

菜池页面以 PRD 固定引用的桃子端原型为视觉和交互依据，不能用“功能验证版”自行替换样式。比较手机内业务内容区，不把原型外的讲解排版、手机外壳、系统状态栏和微信胶囊搬进业务页面。输入、分类预览用相同菜名、相同宽度逐项核对字体、间距、颜色、控件、图标与文案；列表、编辑、保存成功和异常恢复沿用同一组件样式。分类更换图标复用原型的 RefreshCw 文件。

视觉证据和差异说明见 [菜池视觉验收](../../apps/kith-inn-miniapp/design-qa.md)。功能回归与视觉对照分别检查；新截图未通过前，不因为旧 CI 或功能用例通过就宣称界面符合原型。周菜单与复制后续实施遵循相同规则，已确认的 MVP 业务边界仍优先于原型的完整功能。
