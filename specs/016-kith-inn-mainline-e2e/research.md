# Research: kith-inn 主链路真实 E2E 与 CMS 集成验证

## R1：保留快速 SQLite 回归，新增独立 PostgreSQL mainline config

**Decision**: 保留 #185 的 `playwright.config.ts` 与 `menu-swap.spec.ts`，新增 `playwright.mainline.config.ts`。package 的 `test:e2e` 先后运行两个 config，PostgreSQL config 使用独立端口、输出目录和报告目录。

**Rationale**: #185 的场景已经稳定覆盖小池换菜，直接改成 PostgreSQL 会丢失 SQLite 文本日期回归环境；#157 又明确要求真实 PostgreSQL。独立 config 可以同时保存两种证据，并避免不同 webServer/数据库生命周期混在一个 Playwright config 中。

**Alternatives considered**:

- 把所有 E2E 迁移到 PostgreSQL：编排更少，但削弱 #185 已暴露的 SQLite 回归证据。
- 在一个 config 用 Playwright projects 切数据库：全局 `webServer` 不能按 project 隔离，端口、seed 和报告生命周期更复杂。
- 继续只用 SQLite：不满足 #157 的 PostgreSQL 验收。

## R2：复用仓库 PostgreSQL 服务和项目级安全 reset

**Decision**: CI 复用现有 PostgreSQL 17 service；本地标准入口先用根 `pnpm db:up`。每次 mainline suite 用 `KITH_INN_ALLOW_DEV_SEED_RESET=1` 调用 `seed:kith-inn:reset:dev`，只清理/重建旧 kith-inn 数据，并以 v1 sentinel 证明另一项目零变化。

**Rationale**: #014 已把 reset 收敛为项目级、local-only、显式授权入口。复用它比新增全库 drop 或无项目名脚本更安全，也能直接验证 seed isolation。CI 的 verify 与 E2E 串行，E2E 之间已 `--concurrency=1`，不会并发破坏数据库。

**Alternatives considered**:

- 每次创建/删除独立 PostgreSQL database：隔离更强，但需要新增数据库管理权限、client 依赖和清理逻辑。
- 全库 truncate/drop schema：可能破坏 v1/其他项目数据，违背 #014。
- seed 不 reset：会受上一轮失败或 verify fixture 遗留影响，无法重复。

## R3：固定外部模型 HTTP 响应，不替换生产 parser

**Decision**: mainline Playwright 编排启动一个只在测试目录中的 DeepSeek-compatible 固定 HTTP 服务，通过现有 `DEEPSEEK_BASE_URL` 指向它。服务根据确定的对话阶段返回受支持的 tool call/结构，后续继续经过生产 chat route、订单 parser/校验、preview、reconcile 与 CMS。

**Rationale**: 门禁不能依赖第三方额度、网络或随机输出，但 #157 也不能用测试专用 parser 冒充生产。项目已有 fetch 边界和 base URL 配置，固定上游响应是最窄的不确定性替换点。

**Alternatives considered**:

- CI 调真实 DeepSeek：慢、收费、可能抖动且无法稳定制造失败边界。
- Playwright 直接调 CMS 写订单：绕过 H5、chat 和生产解析，不满足主链路。
- 在 BE 增加 E2E-only parser 分支：形成平行业务实现，违反 FR-014。

## R4：用户动作走 H5，fixture 和最终不变量允许用 API 观测

**Decision**: 验收链路中的登录、粘贴、确认、菜单操作、标已付和批量送达均通过 H5 交互。测试 API 只用于准备与用户旅程无关的固定数据、读取最终状态和制造精确并发/重试，不代替要求中的用户动作。

**Rationale**: 纯 API 场景无法证明页面绑定、确认卡和调用顺序；完全靠 UI 读取所有底层不变量又脆弱且无法证明重复行/跨租户零变化。两者分工后，UI 证明旅程，API/数据库证明精确结果。

**Alternatives considered**:

- 全部只走 UI：难以精确断言数据库唯一性和另一租户零变化。
- 全部只走 API：不属于 H5 E2E。

## R5：CMS/PostgreSQL 租户矩阵先于 H5 主链路交付

**Decision**: PR2 先用真实 Payload/PostgreSQL 与 internal route handler/HTTP client 建立双 seller 读写、批量操作、relationship 与 v1 sentinel 矩阵；PR3 以后才接 H5 主链路。

**Rationale**: 租户证据是安全不变量且可独立 review。先固定 fixture 与断言 helper，可以让后续 Playwright 专注用户旅程，避免一个 PR 同时引入 DB harness、页面操作和安全矩阵。

**Alternatives considered**:

- 全部放进 Playwright：单文件过大、失败定位差且安全矩阵难单独 review。
- 只保留 mock route 单测：无法证明真实 Payload access、relationship guard 与 PostgreSQL 行为。

## R6：相关路径显式触发，CMS-backed suite 串行

**Decision**: 延续 #185 的 `origin/main` range filter 与 `--concurrency=1`；把旧 kith-inn 订单、顾客、履约、餐次、chat、order lifecycle、seed/helper 路径纳入 H5 E2E 显式 trigger，并用 dry-run fixture 验证相关/无关代表性 diff。

**Rationale**: CMS package 没有 Turbo dependents，单靠 package graph 会漏跑；多个 CMS dev server 共享 `.next`，并发存在竞态。显式路径 + 串行是当前仓库最小可靠策略。

**Alternatives considered**:

- 给 FE 声明 CMS/BE package dependency：会扭曲生产依赖图，仍无法表达共享 app 内的精确 route。
- 所有 PR 都跑全仓 E2E：增加无关项目耗时并重现端口/资源竞争。

## R7：失败证据分离且可上传

**Decision**: mainline config 使用独立 `test-results/mainline`、`playwright-report/mainline` 和服务日志目录；CI `always()` 上传现有通配产物并补 service log 路径。trace 使用 retain-on-failure，成功前清理旧结果。

**Rationale**: 两个 config 若复用默认目录会互相覆盖；旧产物未清理可能让失败诊断误读。独立目录让一个场景失败时可以直接关联 trace、HTML report 与 CMS/BE/fake-LLM 启动日志。

**Alternatives considered**:

- 只依赖 Actions console：并发/启动失败时信息易被截断，无法下载 trace。
- 所有运行保留 trace：产物体积和 CI 成本不必要增加。
