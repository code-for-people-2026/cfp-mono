# 街坊味菜单 MVP 实施计划

日期：2026-09-21 · 状态：菜池、周菜单、复制核心闭环已可本地试用；按用户确认的排好菜原型调整界面，待评审/合并及真机验收 · 来源：[功能规格](spec.md)、[数据模型](data-model.md)、[接口契约](contracts/openapi.json)

本计划只交付菜池、排周菜单、保存回看和单餐文字复制。经营者只有桃子；订单、对账、连续订餐继续在首版之外。实施按 #357～#360 成果推进；本地完整闭环基线为 `b385ec1`（PR #373），实现、检查及待办证据见对应 Issue。当前界面反馈迭代基于该完整版本，不回退到只有菜池的旧切片；未宣称整体交付或发布。

## 1. 工程现状与选择

下表保留首次规划时 `origin/main@7bb984d6697b74b1f095cb6475be6cb0f4d0e264` 的工程事实；新增包已在实施分支实现，不把旧本地分支或未合并实现当作线上状态。

| 当前仓库事实 | 本功能采用的方式 |
| --- | --- |
| `apps/community-cooking` 使用 Taro 4.2.0、React 18.2、Vite 和 H5/weapp 构建；`apps/miniapp-fe` 已从 workspace 排除 | 参考活跃应用配置，建立 `apps/kith-inn-miniapp`；不恢复归档应用 |
| `apps/weekly-menu-be` 使用 Node 22、原生 HTTP、pg、tsx，具有微信会话和 SQL migration | 参考基础模式，建立独立 `apps/kith-inn-api`；不依赖它的业务服务、身份表或数据库 |
| `packages/weekly-menu-shared` 使用 Zod 4；现有生成器固定大荤、小荤、素菜，确认后不可改 | 使用独立 `packages/kith-inn-contracts`；按本版荤素汤、保存快照与编辑规则实现 |
| 根 compose 和 CI 使用 PostgreSQL 17；生产 API 使用外部数据库 URL | 测试与开发以 PG17 为基线，生产创建独立数据库和受限角色；线上实际版本在交接时核实 |
| 根 `pnpm verify` 包含 lint/typecheck/test:coverage/knip/build，PR 另跑受影响 E2E | 新包接入同一门禁；真实 DB 验证与微信真机证据分别保留 |
| 新三个包、对应路由、表、UI 均尚不存在；老产品无动态结构、去汤和本版分享能力 | 不把参考代码、原型或本次文档验收算成实现完成 |

技术基线：pnpm 10.2.0、TypeScript ^5.9.3、Node 22；后端 `pg ^8.20.0`、`tsx ^4.22.4`，契约 `zod ^4.4.3`，前端沿用仓库的 Taro/React 固定版本。后端和契约使用仓库已有 Vitest 4，前端沿用现有 Taro 工程兼容的 Vitest 1.6 与 Playwright；不为统一测试版本顺带升级其他产品。复用 `@cfp/typescript-config` 和 `@cfp/eslint-config`，不引入 ORM、消息队列或新的 Web 框架。

## 2. 实现边界

- 菜品分类预览在客户端用简单关键词生成建议，由桃子纠正并确认；输入和分类必须在服务端再次校验。没有分类服务或 AI 依赖。
- `GET /dishes` 返回该账号完整菜池，包含停用项，上限 1000 条。客户端筛选同类可用换菜候选；服务端保存时重新验证，不增加候选接口。
- 周生成调用服务端纯函数，只返回预览。客户端修改后，通过一个 `PUT /weeks/{weekStart}` 携带版本、重建标记、确认标记、周结构和 14 个餐次保存；确认不新增接口。
- 请求和响应结构由共享 schema 承载，HTTP 事实以 OpenAPI 为准。菜品与周菜单写入通过 UUID `Idempotency-Key` 保留 24 小时成功重放结果，数据库事务内完成业务与重放记录写入；登录不复用这个机制。
- 经营身份取自服务端会话，不接受客户端指定 owner。只允许配置的桃子微信 OpenID 登录，AppSecret 和微信 session_key 不进入小程序或日志。
- 内存编辑与服务端保存状态分开。重新打开或换设备读服务端；复制时使用已保存的餐次，不能拿待保存输入冒充保存结果。
- Q1～Q3 已按用户 1A、2A、3A 确认：改结构提示覆盖后重生成，取消/失败保留旧结果；不足一餐整次不生成；确认或分享后均可编辑保存并重新复制，提醒自行通知邻居，不建设公布锁。具体规则见 [spec.md](spec.md)。

上线使用规模、时间预算和输入限制以技术规格及接口中的明确值为准；单人 MVP 不引入并发扩容设计。运行数据在试用中记录，不宣称已有性能结果。

## 3. PR 拆分与依赖

故事是最终验收单位，以下 PR 是实现和审查单位。每片只实施本行目标；完整文件清单和 Task ID 在 [tasks.md](tasks.md)。估算包括手写源码、测试与随片必要文档，不含 lockfile、生成产物；实际超预算时先重拆并同步两份表，不直接形成超过 800 行的切片。

| PR | 单一目标 / 核心不变量 | 关联故事 / 验收 | 主要路径 | 明确非目标 | 独立验证 | 人工 diff | 依赖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PR1 | 建立唯一可执行契约 | 全部首版故事；AC-01～05、24、25 | packages/kith-inn-contracts/；knip.json；pnpm-lock.yaml | 不实现服务或页面 | 合法/非法 DTO 与 OpenAPI 示例一致 | 350～500 | 无 |
| PR2 | 建立独立、可迁移的持久化基础 | US-01、03c；AC-25 | apps/kith-inn-api/ 配置、数据库、migration；turbo.json；.github/workflows/ci.yml；pnpm-lock.yaml | 不开放业务 HTTP | 真实 PG17 上重复 migration、约束与事务回滚 | 350～500 | PR1 |
| PR3 | 只有桃子可取得和使用会话 | 全部首版故事；AC-25 | apps/kith-inn-api/ 会话、HTTP、运行入口、测试及包配置；turbo.json；pnpm-lock.yaml | 不自动注册经营者或接入其他产品账户 | 非白名单拒绝、过期/撤销拒绝、日志无凭据 | 400～650 | PR2 |
| PR4 | 菜池写入原子且安全重试 | US-01；AC-01 | apps/kith-inn-api/src/ 菜池、幂等及路由测试 | 不在服务端分类，不实现菜单生成 | 重名整批回滚、版本冲突、同键重放与异体拒绝 | 400～600 | PR3 |
| PR5 | 生成仅返回符合约束的预览 | US-02；AC-02、04 | apps/kith-inn-api/src/generate.ts、generate.test.ts | 不保存，不调用 AI 或外部菜谱库 | 固定随机源检查同餐不重复、跨餐复用、跳过餐 | 250～400 | PR2 |
| PR6 | 周菜单原子保存、确认并可回看 | US-02、03a、03b、03c；AC-02～05 | apps/kith-inn-api/src/ 周菜单存储、服务、路由和测试 | 不增加 confirm/share/candidates 接口 | 并发覆盖拒绝、响应丢失重试、快照稳定及重开读取 | 450～600 | PR4、PR5 |
| PR7a | 小程序工程和安全重试客户端可用 | US-01；AC-01、25 | apps/kith-inn-miniapp/ 工程、客户端和入口占位；knip.json；turbo.json；.gitignore；pnpm-lock.yaml | 不实现菜池编辑页面，不声称真实微信联调 | H5/weapp 构建、会话恢复、未知结果重试保持原键及请求体 | 450～700 | PR3 |
| PR7b | 桃子可在小程序维护菜池 | US-01；AC-01、25 | apps/kith-inn-miniapp/ 分类、菜池页面、样式及验证配置；pnpm-lock.yaml | 不建设顾客端或订单 | 分类循环纠正、未确认不写入、失败保留输入、改名/改类/停用/恢复 | 350～550 | PR4、PR7a |
| PR8a | 周菜单客户端安全重试与纯编辑状态 | US-02、03a、03b、03c；AC-02～05 | apps/kith-inn-miniapp/src/lib/ API扩展、week-editor及测试 | 不实现页面或复制 | 周写未知结果只能原请求重试、对应周读取核对；局部编辑不变性 | 300～550 | PR6、PR7b |
| PR8b | 原型周设置、调整与历史页面 | US-02、03a、03b、03c；AC-02～05 | apps/kith-inn-miniapp/src/ 页面、样式及H5验证 | 不将草稿当作保存结果，不实现复制 | 生成失败留稿、冲突恢复、重开历史及同尺寸原型截图 | 450～750 | PR8a |
| PR9 | 复制文字与已保存的一餐一致 | US-12；AC-24；联合路径 | apps/kith-inn-miniapp/src/ 菜单文字；tests/e2e/；playwright.config.ts | 不代发微信，不提供公开订单入口 | 固定日期/午晚餐/菜名快照、复制失败及重开链路 | 350～550 | PR8 |
| PR10 | 具备可验证的独立运行和交接条件 | 全部首版故事；AC-25 | apps/kith-inn-api/Dockerfile；deploy/ 专用配置与运行手册；CI；本规格验证证据 | 不自动部署或恢复其他产品，不预建运营后台 | 容器启动/就绪、目标识别、隔离恢复、退出删除和微信真机证据 | 450～600 | PR9 |

PR1 在独立审查后补充 UUID 身份去重和按错误码要求必要详情，并同步 OpenAPI 与反例，预算调整至 350～500 行，仍保持单一契约目标。PR2 的数据库约束、迁移和真实事务反例需要一起证明持久化边界；PR3 的令牌生命周期、真实 socket 拒绝路径及真实 PG 就绪反例共同构成权限边界，预算调整为 400～650 行；PR4 的原子批量写与幂等重放必须在同一事务验证，真实PG的并发/CAS/回执写入失败回滚与HTTP边界使实际预算调整为400～600行。PR6 将快照、版本和幂等归于一个周保存事务，PR7b/PR8 把页面及其独有状态转换配套验证；PR10 包含运行配置、恢复流程与实际交接证据。因此这些片允许超过 400 行参考值，目标控制在各行预算内。没有用“跨层闭环”合并前后端，独立算法已放在 PR5；公共配置或边界继续增长时应再拆。

PR7 在接入核查后拆为两个原任务切片：Taro 工程、微信/H5 两种密码学随机源、会话恢复和未知写入结果重试需独立验证，叠加完整菜池维护页面会超过原 600 行预算。PR7a 承接 T013/T014，依赖已完成的 PR3 和共享契约；PR7b 承接 T015，等 PR4 真服务后整合页面。独立审查补充未知结果不可因早读/退出提前解除、过期后须重新核对以及限流冷却反例，PR7a预算相应调整至450～700行。未增加业务范围或任务 ID。

可并行部分：PR2 完成 API 包与测试脚手架后，可并行完成 PR3 和 PR5；PR3 后可独立准备 PR7a；PR4 后可并行准备 PR6 和 PR7b。其余按依赖列执行，不在依赖未完成时把 Mock 联调视作生产验收。


2026-09-21 用户试用指出确认后下一步被藏在逐餐入口，PR9按原型补齐“去复制菜单→独立确认与分享状态→选日期/午晚餐→主动复制”，复用T018/T019及同一PR，不增加业务范围。独立状态与移动/桌面主动作可见性回归须一起验证，原250～400行预算调整为350～550行；继承的week测试文件改名按实际修改行计，不把未改测试重复计入。

## 4. 未来源码布局

以下是实施目标，当前文档提交不创建这些文件。各文件归属在 tasks.md；不得借新功能改写 `apps/community-cooking`、`apps/weekly-menu-be`、`packages/menu-core`、`packages/weekly-menu-shared` 或旧原型。

```text
apps/kith-inn-api/
  package.json, tsconfig.json, eslint.config.mjs, vitest.config.ts, Dockerfile
  migrations/0001_initial.sql
  scripts/migrate.mjs
  src/config.ts, database.ts, auth.ts, sessions.ts, http.ts, runtime.ts, main.ts
  src/idempotency.ts, dishes.ts, generate.ts, weeks.ts
  src/*.test.ts
apps/kith-inn-miniapp/
  package.json, config/index.ts, project.config.json, tsconfig.json
  eslint.config.mjs, vitest.config.ts, playwright.config.ts
  src/app.tsx, app.config.ts, app.css
  src/lib/api.ts, classify.ts, week-editor.ts, menu-text.ts
  src/lib/*.test.ts
  src/pages/dishes/index.tsx, index.config.ts
  src/pages/week/index.tsx, index.config.ts
  src/pages/history/index.tsx, index.config.ts
  tests/e2e/menu.spec.ts
packages/kith-inn-contracts/
  package.json, tsconfig.json, eslint.config.mjs, vitest.config.ts
  src/index.ts, index.test.ts
```

根配置只因新包运行而调整 `knip.json`、`turbo.json`、`.github/workflows/ci.yml`、`.gitignore` 和 `pnpm-lock.yaml`。`pnpm-workspace.yaml` 现有 `apps/*`、`packages/*` 已覆盖新包，无需取消归档排除项。部署路径限定于任务中列出的独立 compose、环境示例、Nginx 示例、API Dockerfile、部署目标解析、测试和运行手册；当前工作不配置真实密钥或执行上线。

## 5. 宪法与完成门槛

本功能跨共享契约、持久化、服务与 UI，按全套功能规格管理。仓库现状、允许路径、独立验收、依赖和预算已列明；原有订餐、资金及配送不作为实现依赖。三份总文档仍留在 `docs/kith-inn`，细节只维护于本规格目录，旧 `specs/001～021` 不作为本版实现合同。

每个实现 PR 都要完成独立验证、适用的文档与契约检查、`git diff --check`、`pnpm verify`、最新提交的 CI 和审查收敛；发布和合并按当时仓库规则与用户授权执行。保持 PR 代码和文档描述一致，不为每片另建重复的“开 PR/等 CI/合并”任务。

只有代码验证和真机、恢复、退出删除的证据都实际完成，才可宣称首版可交付。本次准备文件的完成不勾选任何实现任务。业务决定已登记；真实 AppID、合法请求域名、桃子身份绑定及数据承诺的落实分别留证，未取得的外部条件不能写成已满足。

2026-09-21 #358 接手核查：现有客户端仅实现菜池操作；周 PUT 响应、按目标周读取解除过期未知结果和跨页面共享 pending 状态需要独立反例，不能只接页面。PR8 据此拆为 PR8a（T016 状态与客户端）和 PR8b（T017 原型页面及浏览器验证），任务 ID 与业务范围不增加；预计合并实施会超过800行。PR9依赖完整PR8b。

2026-09-21 用户反馈迭代：#358 复用 T015/T017/T019 的界面与联合验收，在完整 PR #373 基线之上以增量 PR 实现[规格 1.1](spec.md#11-本轮界面验收)。允许修改小程序页面、共享导航/样式、原型资产和必要回归/视觉证据，协调者同步本规格及 PRD；不改 API、数据表或既定业务规则。人工增量目标 500～750 行，含必要文档；若超过 800 行须沿用现有任务映射拆成可独立验证的切片。补验导航取消不丢草稿、未知写入请求保持、历史重新进入可见最新记录，以及确认后的文字复制链路；不新增任务 ID 或第二套开发计划。

随后用户纠正原型版本：以最新工程原型为统一依据，客户版退出当前验收。#358 同一主任务继续从 `7ca12b5` 校正首页/编辑层级、两列表格、独立候选与可搜索手选、只读检查及历史表；最终保存仍一次写入。原 T017 及 T019 回归覆盖这轮纠正，代码路径仍限小程序，必要共享组件可放 `src/lib/`。新的视觉证据须对照工程版，旧客户版截图仅保留追溯；单片预算及 800 行上限继续适用，超出即按原映射拆增量切片，不增加 Issue 或任务 ID。
