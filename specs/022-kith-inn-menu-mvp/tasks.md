# 街坊味菜单 MVP 开发任务

日期：2026-09-20 · 状态：#357 菜池实现与验证完成，待评审/合并及真机验收 · 依据：[spec.md](spec.md)、[plan.md](plan.md)、[data-model.md](data-model.md)、[接口契约](contracts/openapi.json)

GitHub 成果入口：[#357 菜品池](https://github.com/code-for-people-2026/cfp-mono/issues/357) → [#358 周菜单](https://github.com/code-for-people-2026/cfp-mono/issues/358) → [#359 复制](https://github.com/code-for-people-2026/cfp-mono/issues/359) → [#360 运行交接](https://github.com/code-for-people-2026/cfp-mono/issues/360)。复用下表，不新增任务拆分。T001/T002 已实现并通过37个测试及独立审查；T003～T005 已实现并通过26个含真实PG17的测试及独立审查。T006/T007 会话与原生HTTP已实现，API累计54个测试（真实PG17及socket）及独立审查通过。T008/T009 菜池API已实现，累计67个API测试及独立审查通过。各片尚未合并，暂不勾选完成；T013/T014客户端基础已实现，24个测试、H5/weapp构建和独立审查通过；T015菜池页面已实现，累计33个前端单测、6条H5浏览器回归及双构建通过，真实API/PG17联调通过；按指定原型修正录入/预览视觉，同尺寸成对截图及独立复核通过（见小程序 design-qa.md），待用户视觉验收。其余Issue任务未开始。Q1～Q3 已按用户选择 1A、2A、3A 写入功能规格；以下任务执行已确认的重排、缺菜失败和分享后编辑规则。

## 1. 实现 PR 与唯一任务映射

| PR | 单一目标 | 关联故事 / 验收 | 包含任务 | 允许路径 / 非目标 | 独立验证 | 人工 diff | 依赖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PR1 | 建立唯一可执行契约 | 全部首版故事；AC-01～05、24、25 | T001、T002 | packages/kith-inn-contracts/；knip.json；pnpm-lock.yaml；不实现服务或页面 | 合法/非法 DTO 与 OpenAPI 示例一致 | 350～500 | 无 |
| PR2 | 建立独立、可迁移的持久化基础 | US-01、03c；AC-25 | T003、T004、T005 | apps/kith-inn-api/ 配置、数据库、migration；turbo.json；.github/workflows/ci.yml；pnpm-lock.yaml；不开放业务 HTTP | 真实 PG17 上重复 migration、约束与事务回滚 | 350～500 | PR1 |
| PR3 | 只有桃子可取得和使用会话 | 全部首版故事；AC-25 | T006、T007 | apps/kith-inn-api/ 会话、HTTP、运行入口、测试及包配置；turbo.json；pnpm-lock.yaml；不自动注册经营者或接入其他产品账户 | 非白名单拒绝、过期/撤销拒绝、日志无凭据 | 400～650 | PR2 |
| PR4 | 菜池写入原子且安全重试 | US-01；AC-01 | T008、T009 | apps/kith-inn-api/src/ 菜池、幂等及路由测试；不在服务端分类，不实现菜单生成 | 重名整批回滚、版本冲突、同键重放与异体拒绝 | 400～600 | PR3 |
| PR5 | 生成仅返回符合约束的预览 | US-02；AC-02、04 | T010 | apps/kith-inn-api/src/generate.ts、generate.test.ts；不保存，不调用 AI 或外部菜谱库 | 固定随机源检查同餐不重复、跨餐复用、跳过餐 | 250～400 | PR2 |
| PR6 | 周菜单原子保存、确认并可回看 | US-02、03a、03b、03c；AC-02～05 | T011、T012 | apps/kith-inn-api/src/ 周菜单存储、服务、路由和测试；不增加 confirm/share/candidates 接口 | 并发覆盖拒绝、响应丢失重试、快照稳定及重开读取 | 450～600 | PR4、PR5 |
| PR7a | 小程序工程和安全重试客户端可用 | US-01；AC-01、25 | T013、T014 | apps/kith-inn-miniapp/ 工程、客户端和入口占位；knip.json；turbo.json；.gitignore；pnpm-lock.yaml；不实现菜池编辑页面 | H5/weapp 构建、会话恢复、未知结果重试保持原键及请求体 | 450～700 | PR3 |
| PR7b | 桃子可在小程序维护菜池 | US-01；AC-01、25 | T015 | apps/kith-inn-miniapp/ 分类、菜池页面、样式和测试配置；pnpm-lock.yaml；不建设顾客端或订单 | 分类循环纠正、未确认不写入、失败保留输入、改名/改类/停用/恢复 | 350～550 | PR4、PR7a |
| PR8 | 一周排菜调整与保存回看可用 | US-02、03a、03b、03c；AC-02～05 | T016、T017 | apps/kith-inn-miniapp/src/ 周编辑状态、菜单及历史页面；不将内存状态或缓存当作已保存 | 指定位置换菜、逐餐去汤、保存失败保留编辑、冲突提示 | 450～600 | PR6、PR7b |
| PR9 | 复制文字与已保存的一餐一致 | US-12；AC-24；联合路径 | T018、T019 | apps/kith-inn-miniapp/src/ 菜单文字；tests/e2e/；playwright.config.ts；不代发微信，不提供公开订单入口 | 固定日期/午晚餐/菜名快照、复制失败及重开链路 | 250～400 | PR8 |
| PR10 | 具备可验证的独立运行和交接条件 | 全部首版故事；AC-25 | T020、T021、T022、T023、T024 | apps/kith-inn-api/Dockerfile；deploy/ 专用配置与运行手册；CI；本规格验证证据；不自动部署或恢复其他产品，不预建运营后台 | 容器启动/就绪、目标识别、隔离恢复、退出删除和微信真机证据 | 450～600 | PR9 |

依赖及预算与 plan.md 相同。表内目录是审查范围，下面每个任务给出可写的具体文件；已有文件如需因同一功能调整，仅限任务明确列出的文件。任务 ID 在表内恰好归属一个 PR；小节按交付能力组织，不能替代依赖顺序。

## 2. 契约、持久化和权限

- [ ] T001 [PR1] 建立 `packages/kith-inn-contracts/package.json`、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.ts`，依赖已有公共配置和 Zod；同步根 `knip.json`、`pnpm-lock.yaml`，提供 build/lint/typecheck/test/test:coverage 脚本。
- [ ] T002 [PR1] 在 `packages/kith-inn-contracts/src/index.ts`、`src/index.test.ts` 实现本版请求、响应、错误 schema 和类型；以 `specs/022-kith-inn-menu-mvp/contracts/openapi.json` 和 `contracts/examples.json` 为一致性样本，覆盖日期、14 餐位置唯一、数量、版本及非法额外字段；跨字段服务规则明确留在服务端，不假装都由基础 JSON Schema 保证。
- [ ] T003 [PR2] 建立 `apps/kith-inn-api/package.json`、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.ts`、`src/config.ts`、`src/config.test.ts`，提供与 quickstart 对应的脚本，使用独立 `KITH_INN_DATABASE_URL`，校验必需配置而不输出密钥；同步 `pnpm-lock.yaml`。
- [ ] T004 [PR2] 按数据模型编写 `apps/kith-inn-api/migrations/0001_initial.sql`、`scripts/migrate.mjs`、`src/database.ts`；建立经营账号、菜品、周菜单、会话及幂等记录，事务、唯一约束和索引保持同一迁移；专用 migration 记录与 advisory lock 不与另一个产品冲突，数据库已有成功迁移不得被静默改写。
- [ ] T005 [PR2] 在 `apps/kith-inn-api/src/persistence.integration.test.ts` 用隔离 PG17 数据库验证重复 migration、同周唯一、异常事务回滚及约束；调整 `.github/workflows/ci.yml` 创建独立 `cfp_kith_inn_test` 数据库，调整 `turbo.json` 传递本产品测试配置。真实数据库测试缺配置或目标库名不以 `_test` 结尾时明确失败，不对开发/生产库执行测试清理，也不能跳过后声称持久化通过。
- [ ] T006 [PR3] 在 `apps/kith-inn-api/src/auth.ts`、`src/sessions.ts`、`src/auth.test.ts` 实现微信 code 交换、唯一桃子 OpenID 白名单、随机会话与哈希存储、到期/撤销、跨设备同一经营者映射。测试使用注入的时钟和微信响应，接受合法的缺省错误码或 `errcode: 0`，拒绝非零错误码；不靠固定日历日期避免测试日后过期。
- [ ] T007 [PR3] 在 `apps/kith-inn-api/src/http.ts`、`src/http.test.ts`、`src/runtime.ts`、`src/runtime.test.ts`、`src/main.ts` 提供原生 HTTP 外壳、`POST /sessions/wechat`、`DELETE /sessions/current`、health/ready、请求限制、统一错误、脱敏日志和优雅关闭；所有业务路由继承服务端鉴权，未知身份不得查到内部内容。

## 3. 菜池与纯生成能力

- [ ] T008 [PR4] 在 `apps/kith-inn-api/src/idempotency.ts`、`src/idempotency.test.ts`、`src/dishes.ts`、`src/dishes.test.ts` 实现菜品批量原子新增、完整菜池读取、按 baseVersion 修改，以及成功写入和 24 小时重放记录的同事务处理；覆盖批内/库内重名、超限、同键同体重放、同键异体冲突、成功响应丢失、记录到期处理。
- [ ] T009 [PR4] 在 `apps/kith-inn-api/src/http.ts`、`src/http.test.ts` 接入 `GET /dishes`、`POST /dishes`、`PATCH /dishes/{dishId}`；验证未经授权、非法分类、过期版本和重复名称均不部分写入，停用/恢复不改写已保存周快照。菜品分类预览留在客户端。
- [ ] T010 [PR5] 在 `apps/kith-inn-api/src/generate.ts`、`src/generate.test.ts` 实现可注入随机源的纯生成函数。执行不足一餐时整次失败并返回分类/所需/可用数量的规则，不返回缺位预览；覆盖任意允许周结构、14 餐位置、跳过餐、同餐不重复、够整周时不重复及不足整周时合理复用；算法不读写数据库，不访问网络，不附带自动保存。

## 4. 周菜单保存与回看

- [ ] T011 [PR6] 在 `apps/kith-inn-api/src/weeks.ts`、`src/weeks.test.ts` 实现按周读取/游标列表、生成预览组装、按 baseVersion 保存和确认；在同一事务内处理快照、确认状态、幂等重放和并发冲突。服务端按最新菜池验证新选择，历史保留项按数据模型处理，不接受客户端伪造菜名；结构变更要求 rebuild=true；所有保存要求完整菜位；确认后允许修改，普通保存清除确认时间，保存并确认在同一事务完成。
- [ ] T012 [PR6] 在 `apps/kith-inn-api/src/http.ts`、`src/http.test.ts`、`src/persistence.integration.test.ts` 接入 `GET /weeks`、`GET /weeks/{weekStart}`、`POST /weeks/{weekStart}/generate`、`PUT /weeks/{weekStart}`，验证生成不写入、确认与保存原子完成、失联重试不重复、旧设备不能覆盖新版本、更新菜池不改写已保存内容。保存失败后重新读取应保持最近成功版本。

## 5. 小程序入口、排菜与菜单分享

- [ ] T013 [PR7a] 建立 `apps/kith-inn-miniapp/package.json`、`config/index.ts`、`project.config.json`、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.ts`、`src/index.html`、`src/app.tsx`、`src/app.config.ts`、`src/app.css` 及菜池路由占位页，提供 H5/weapp 构建和测试脚本；同步 `knip.json`、`turbo.json`、`.gitignore`、`pnpm-lock.yaml`。用户确认微信小程序已创建，沿用该现有小程序；核对后以构建环境变量 `TARO_APP_ID` 注入真实 AppID，再导入 `apps/kith-inn-miniapp/dist`，示例 touristappid 不能作为联调证据。
- [ ] T014 [PR7a] 在 `apps/kith-inn-miniapp/src/lib/api.ts`、`src/lib/api.test.ts` 实现 Taro 平台适配、登录/退出、会话恢复、共享响应校验、稳定写入幂等键、超时与版本冲突错误。重试同一保存重用原键；成功后清除待发请求；真实模式无服务地址应明确报错，不静默进入 Mock。
- [ ] T015 [PR7b] 在 `apps/kith-inn-miniapp/src/lib/classify.ts`、`src/lib/classify.test.ts`、`src/pages/dishes/index.tsx`、`src/pages/dishes/index.config.ts` 实现每行录入、关键词建议、荤素汤循环纠正、返回修改、确认新增及改名/改分类/停用/恢复；同步 `src/app.css`、`tsconfig.json`、`package.json`，在 `playwright.config.ts`、`tests/e2e/dishes.spec.ts` 验证本片菜池交互（不替代 T019 的整周联合路径），`config/index.ts` 的 H5 原生 hash 路由使静态验证入口可直接重开；未确认不提交，重名错误保留可编辑输入，不补做 AI 分类。按指定桃子端原型还原视觉，复用原图标资产；录入及预览页须做同尺寸、同状态截图对照，结果记录在 `apps/kith-inn-miniapp/design-qa.md`，功能测试不能替代视觉验收。
- [ ] T016 [PR8] 在 `apps/kith-inn-miniapp/src/lib/week-editor.ts`、`src/lib/week-editor.test.ts` 实现周结构、跳过餐、随机/手选换菜、去汤/恢复和编辑/保存版本分离。候选从完整菜池过滤同类可用且本餐不重复；无候选明确返回结果；重生成先提示会覆盖换菜和去汤，确认才执行，取消/失败保留旧编辑，成功仅替换预览；缺菜不返回部分结果；恢复汤按规格验证。
- [ ] T017 [PR8] 在 `apps/kith-inn-miniapp/src/pages/week/index.tsx`、`src/pages/week/index.config.ts`、`src/pages/history/index.tsx`、`src/pages/history/index.config.ts`、`src/app.config.ts` 接入按日期组织午晚餐的周编辑、确认总览、按周回看与再次编辑。保存失败保留本地调整并标未保存；冲突时保留调整供核对，不能直接覆盖服务端；新设备从 API 恢复。
- [ ] T018 [PR9] 在 `apps/kith-inn-miniapp/src/lib/menu-text.ts`、`src/lib/menu-text.test.ts`、`src/pages/week/index.tsx` 实现重新读取保存周后的单餐文字预览、主动复制和失败重试；读取失败不使用旧缓存宣称最新；文字含日期、午晚餐、菜名，遵守去汤快照；复制不改菜单、不等于已发送，复制或发群后允许编辑保存并重新复制；再次编辑已保存菜单时提醒如已发群需自行通知，旧文字不会更新；不加公布或解锁动作。
- [ ] T019 [PR9] 在 `apps/kith-inn-miniapp/playwright.config.ts`、`tests/e2e/menu.spec.ts`、`package.json` 验证“建菜池→生成→换菜/去汤→保存确认→重开→复制”H5 链路，覆盖结构修改取消/失败不丢原编辑、缺菜无部分预览、保存失败、复制失败和分享后换菜重新复制；测试明确使用的测试会话/服务边界，不能把 H5 剪贴板结果写成微信真机验证。

## 6. 独立运行与真实交接证据

- [ ] T020 [PR10] 编写 `apps/kith-inn-api/Dockerfile`、`deploy/docker-compose.kith-inn.yml`、`deploy/.env.kith-inn.example`、`deploy/nginx.kith-inn.example.conf`：不可变版本镜像、非 root 运行、专用端口 3305、HTTPS 反向代理、health/ready、独立数据库与受限角色，真实密钥不进仓库。
- [ ] T021 [PR10] 调整 `deploy/resolve-deploy-targets.sh`、`deploy/tests/production-targets.test.sh`、`.github/workflows/ci.yml`，补充 `deploy/tests/kith-inn-deploy.test.sh`；新后端/契约变更能进入独立镜像构建，单纯菜单小程序与文档变更按实际依赖判断；未知部署文件保留可靠兜底，回归确保其他产品的现有目标识别不被破坏。
- [ ] T022 [PR10] 编写 `deploy/KITH_INN_RUNBOOK.md`：首次数据库和桃子身份绑定、环境配置、迁移前专库备份、重复 migration、隔离恢复、应用版本回退、失败停止点、数据保留与退出删除流程。提供可检查的 pg_dump/pg_restore 步骤，不假设列出备份目录等于恢复成功，不提前建设运营后台。
- [ ] T023 [PR10] 在 `specs/022-kith-inn-menu-mvp/checklists/release-evidence.md` 记录真实 AppID、合法 HTTPS request 域名、经营身份绑定和微信真机登录、拒绝另一身份、保存/重开、跨设备读取、剪贴板复制证据；记录构建提交、日期、设备和脱敏结果。未提供凭据或未测试的项标未完成，不以 touristappid 或 H5 替代。
- [ ] T024 [PR10] 在 `specs/022-kith-inn-menu-mvp/checklists/release-evidence.md` 记录专库备份→隔离库恢复→应用读取同一菜单的演练，以及退出删除后主库、会话和备份处置的验证、失败修正和责任人；依据最终确认的数据保留/删除承诺执行。使用隔离样本检验，涉及真实资料时按已确认操作范围执行，不恢复共享实例覆盖其他产品。

## 7. 每片统一完成定义与检查

不重复分配 Task ID：对应独立验证通过；变更所及的 PRD、用户故事或技术规格与实际行为一致；必要时同步本功能契约；`git diff --check`、人工 diff 审查、`pnpm verify`、最新提交 CI、审查问题收敛全部完成。本轮实施分支与 PR 按协调任务授权发布，合并和部署仍遵守相应授权；当前尚未合并或部署街坊味。

开始实施前核查全部 T001～T024 在映射表各出现一次，依赖无环并与 plan.md 相同。任务完成只依据对应产物和证据勾选；“已写步骤”“测试 Mock 通过”“部署配置已提交”都不能代替真实恢复和微信验证。
