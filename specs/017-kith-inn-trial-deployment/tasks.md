# Tasks: kith-inn 桃子体验版部署与真机发布

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/release-contract.md](./contracts/release-contract.md)、[quickstart.md](./quickstart.md)

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 包含任务 | 独立验证 | 依赖 |
|----|-------------------|----------|----------|------|
| PR1 | 固化 #158 范围、部署决策、契约与依赖有序任务 | T001–T005 | checklist、analyze、`git diff --check` | 无 |
| PR2 | 生产 H5/weapp 只含显式合法 HTTPS BE URL 且无 dev-login 降级 | T006–T010 | URL 负例、H5/weapp build、FE coverage、`pnpm verify` | PR1 |
| PR3 | CMS/BE 缺生产配置时 fail closed，并提供真实依赖 readiness | T011–T016 | env/route 测试、PG readiness、两端 build、`pnpm verify` | PR2 |
| PR4 | 生产 `cms` schema 只走 migration，桃子基线幂等且真实 OpenID 不进证据 | T017–T022 | fresh/existing PG、seed 重跑/恢复、零 reset、`pnpm verify` | PR3 |
| PR5 | CMS/BE/H5 形成同 SHA 可追踪、非 root、可启动镜像 | T023–T027 | 三镜像 build/health/secret scan、`pnpm verify` | PR4 |
| PR6 | Compose/Nginx/runbook 与无后门 smoke 证明完整栈可部署回滚 | T028–T034 | config/env 模板静态检查、health+auth+read-only、失败回滚、`pnpm verify` | PR5 |
| PR7 | 生产工作流只对受影响且配置完整的 kith-inn 执行备份/迁移/部署/smoke/回滚并持久化通过凭据 | T035–T038 | affected/缺 secret/备份/失败演练、marker、action lint、`pnpm verify` | PR6 |
| PR8 | 独立手动工作流只在校验同 SHA 持久化 smoke 凭据后可重复上传体验版 | T039–T044 | uploader/marker 负例、dry-run、测试上传、`pnpm verify` | PR7 |
| PR9 | 实际云环境与桃子白名单真机完整通过并留下脱敏证据 | T045–T050 | 生产 smoke、版本关联、核心链路、回滚演练 | PR8 |

## Phase 1: 规格与规划（PR1）

**Goal**: 在实现前固定范围、合规主路径、接口契约、证据和小 PR 执行顺序。

- [x] T001 审计 issue #158、`docs/kith-inn/PRD.md`、`docs/kith-inn/TECH-SPEC.md`、`deploy/**`、`.github/workflows/deploy-production.yml` 与 CMS/BE/FE build/env/secret 现状
- [x] T002 使用 speckit-specify 完成 `specs/017-kith-inn-trial-deployment/spec.md` 与 `checklists/requirements.md`
- [x] T003 使用 speckit-plan 完成 `plan.md`、`research.md`、`data-model.md`、`contracts/release-contract.md`、`quickstart.md` 与 PR1–PR9 切片
- [x] T004 使用 speckit-tasks 生成本 `tasks.md`，确保任务 ID、story、PR、精确路径与依赖完整
- [x] T005 只读执行 speckit-analyze，处理所有 CRITICAL/HIGH 与 actionable MEDIUM 后运行文档链接检查、`git diff --check` 与人工 diff 预算

## Phase 2: User Story 1 - 可构建、可初始化的生产候选（P1，PR2–PR5）

**Goal**: 先让各 app 在合法配置和受控 schema 上生成可追踪镜像，不触碰真实云环境。

**Independent Test**: 对同一 SHA 构建 CMS/BE/H5/weapp；合法配置成功，缺失/非法配置全部失败；fresh/existing PG schema 与 seed 收敛；三个镜像以非 root 启动并通过本地 health。

### PR2：前端生产 URL 与登录边界

- [x] T006 [P] [US1] 先在 `apps/kith-inn-fe/src/services/api.test.ts` 增加生产 URL 的缺失、IANA 文档/测试保留域、HTTP、IP、localhost、局域网、查询/片段负例与合法 HTTPS 正例
- [x] T007 [US1] 在 `apps/kith-inn-fe/config/production.ts`、`config/index.ts` 与 `src/services/api.ts` 实现构建期/运行期同源校验，非生产保留本地默认而生产禁止回退
- [x] T008 [US1] 先新增 `apps/kith-inn-fe/src/pages/login/index.test.tsx`，再修改 `apps/kith-inn-fe/src/pages/login/index.tsx`，保证生产 weapp 微信登录失败不调用 dev-login且 H5 内部状态明确失败
- [x] T009 [US1] 在 `apps/kith-inn-fe/.env.example` 与 `package.json` 记录生产 build 前置，并连续验证合法 URL 的 `build:h5`、`build:weapp` 与非法 URL 的零产物
- [x] T010 [US1] 运行 `@cfp/kith-inn-fe` test/coverage/lint/typecheck、`pnpm verify`、`git diff --check`；PR2 人工 diff 310 行（258 insertions + 52 deletions，<400）

### PR3：CMS/BE fail-closed 与 readiness

- [x] T011 [P] [US1] 先在 `apps/cms/src/config/production.test.ts` 覆盖 PostgreSQL、Payload/JWT/internal token 缺失或占位值及非生产 SQLite 正例
- [x] T012 [P] [US1] 先在 `apps/kith-inn-be/src/config/env.test.ts` 覆盖 JWT、CMS URL/token、微信与 DeepSeek 配置，并在 `src/routes/readiness.test.ts` 覆盖 CMS/DB 依赖失败
- [x] T013 [US1] 在 `apps/cms/src/config/production.ts`、`apps/cms/payload.config.ts`、`apps/cms/src/app/api/ready/route.ts` 与 `apps/cms/src/app/api/health/route.test.ts` 实现生产启动校验和脱敏 PG/schema readiness
- [x] T014 [US1] 在 `apps/kith-inn-be/src/config/env.ts`、`src/app.ts`、`src/index.ts` 与 `src/routes/readiness.ts` 实现生产启动校验、`GET /ready` 和稳定 503 类别
- [x] T015 [P] [US1] 同步 `apps/cms/.env.example` 与 `apps/kith-inn-be/.env.example` 的变量名、secret/非 secret 边界和 fail-closed 说明
- [x] T016 [US1] 已通过 CMS/BE env/readiness 窄测、真实 PostgreSQL `cms` schema readiness、两端 build/coverage、`pnpm verify` 与 `git diff --check`；PR3 人工 diff 386 行（370 insertions + 16 deletions，<400）

### PR4：生产 migration 与桃子基线

- [ ] T017 [US1] 先在 `apps/cms/tests/migration-production.test.ts` 固定 fresh DB、已迁移 DB、重复 migrate、禁止 push/reset 与 migration head 不匹配场景
- [ ] T018 [US1] 在 `apps/cms/migrations/**` 生成并审阅 baseline，修改 `apps/cms/payload.config.ts` 与 `package.json` 使生产只执行显式 migration、本地开发仍可 push
- [ ] T019 [US1] 先在 `packages/kith-inn-payload/src/seed/taozi.test.ts` 与 `apps/cms/tests/seed-production.test.ts` 覆盖半成品恢复、重复收敛、事务失败、稳定键和 secret OpenID不输出
- [ ] T020 [US1] 在 `packages/kith-inn-payload/src/seed/taozi.ts` 与 `apps/cms/seed/run.ts` 实现事务化幂等收敛和 `KITH_INN_TRIAL_OPENID` 受控覆盖，不修改 fixture 的 dev OpenID
- [ ] T021 [US1] 在 `apps/cms/tests/seed-production.test.ts` 增加同库 v1 sentinel，证明 migration/旧 kith seed 不 seed、reset 或改写 v1 业务数据
- [ ] T022 [US1] 对 fresh/existing PostgreSQL 各跑 migration+seed 两次和受控中断恢复，运行 CMS/payload coverage、`pnpm verify`、`git diff --check` 并区分生成/人工 diff

### PR5：生产镜像

- [ ] T023 [P] [US1] 在 `apps/cms/next.config.ts` 启用 standalone，并新增 `apps/cms/Dockerfile` 构建可运行、非 root 的 CMS 镜像
- [ ] T024 [P] [US1] 新增 `apps/kith-inn-be/Dockerfile`，只携带生产编译输出/依赖，以非 root 用户运行 `dist/index.js`
- [ ] T025 [P] [US1] 新增 `apps/kith-inn-fe/Dockerfile` 与 `apps/kith-inn-fe/nginx.conf`，用显式 `BE_BASE_URL` 构建 H5并以只读静态 Nginx 提供 SPA fallback
- [ ] T026 [US1] 在 `deploy/verify-kith-inn-images.sh` 验证三镜像 SHA label、非 root、health、H5 fallback、只读文件系统可行性与常见 secret/局域网字符串零命中
- [ ] T027 [US1] 对同一 SHA 连续构建 CMS/BE/H5 三镜像和 weapp 产物各两次并比对追踪信息，再运行 `deploy/verify-kith-inn-images.sh`、相关 app coverage、`pnpm verify` 与 `git diff --check`

## Phase 3: User Story 2 - 部署后自动证明可用（P2，PR6–PR7）

**Goal**: 把候选编排到生产等价栈，并以无公开后门的认证+只读 smoke 阻断坏发布。

**Independent Test**: 本地生产等价 Compose 在 Nginx/TLS 占位配置下通过 readiness；内部 CLI建立短时认证并只读 offerings、写入为零；任一依赖失败触发非零、脱敏诊断和上一 digest 回滚。

### PR6：编排、smoke 与 runbook

- [ ] T028 [P] [US2] 扩展 `deploy/docker-compose.prod.yml`，加入 CMS/BE/H5、healthcheck、私网/loopback 端口、不可变镜像变量和 migration/provision one-shot 服务；新增仅含假值的 `deploy/.env.verify.example`，并新增/更新 `deploy/.gitignore` 以忽略本地 `.env.verify`
- [ ] T029 [P] [US2] 扩展 `deploy/nginx.example.conf`，提供 API HTTPS、CMS/H5 内部限制、80→443、代理 header 与证书/域名占位契约
- [ ] T030 [US2] 先在 `apps/kith-inn-be/src/smoke/deployed.test.ts` 覆盖 operator 缺失、seller ID 不匹配、TTL、只读请求、上游失败及 token/OpenID 零输出
- [ ] T031 [US2] 在 `apps/kith-inn-be/src/smoke/deployed.ts` 与 `apps/kith-inn-be/package.json` 实现容器内一次性 `smoke:deployed`，精确比对 provisioning seller ID、复用 CMS lookup/JWT/`GET /offerings` 且不新增 HTTP route
- [ ] T032 [US2] 扩展 `deploy/smoke-test.sh` 串行验证 CMS/BE liveness/readiness、H5、容器内认证+只读 CLI、零写入和 release SHA
- [ ] T033 [P] [US2] 更新 `deploy/RUNBOOK.md`、`DEPLOYMENT.md` 与 `docs/kith-inn/TECH-SPEC.md`，覆盖从 `deploy/.env.verify.example` materialize 本地覆盖、env/secret、RDS migration/seed、DNS/TLS、Nginx、smoke、上传前置和应用/数据回滚
- [ ] T034 [US2] 验证 compose/nginx 静态配置、成功 smoke、DB/token/operator/TLS 受控失败与 15 分钟回滚演练，再运行相关 coverage、`pnpm verify`、`git diff --check`

### PR7：生产部署工作流

- [ ] T035 [US2] 在 `.github/workflows/deploy-production.yml` 增加 kith-inn affected 输出、手动 target 与专用 secret/variable 存在性检查，无关项目/未配置环境不得执行真实部署
- [ ] T036 [US2] 在 `.github/workflows/deploy-production.yml` 增加同 SHA 三镜像 build/push、digest 记录、migration 前目标 RDS 可恢复备份创建/验证与非敏感 ID/时间记录、单次 migration/provision、provisioning seller ID 机器输出直传 smoke、Compose rollout；仅在部署后 smoke 成功末尾上传含 schema version/SHA/run/digest/migration/backup/status 且设 `retention-days: 30` 的 `smoke-passed.json` artifact
- [ ] T037 [US2] 在 `.github/workflows/deploy-production.yml` 与 `deploy/RUNBOOK.md` 实现 smoke 失败自动恢复上一镜像 digest、schema 不兼容时停止并转人工数据恢复的边界
- [ ] T038 [US2] 用 actionlint、synthetic git range/Turbo dry-run，以及缺 secret、备份缺失/不可恢复、migration/smoke 失败演练验证 workflow 全部 fail closed 且失败路径无 `smoke-passed.json`；确认成功 marker 字段完整、website 独立路径不变后运行 `pnpm verify` 与 `git diff --check`

## Phase 4: User Story 3 - 可重复上传微信体验版（P3，PR8）

**Goal**: 只把已部署且 smoke_passed 的指定 main SHA 上传为可追踪体验版。

**Independent Test**: uploader 对固定产物完成 dry-run；缺 AppID/私钥/HTTPS URL/版本或非 main SHA 时上传调用为零；受控测试凭据上传后微信版本可关联 SHA且日志脱敏。

- [ ] T039 [US3] 先在 `apps/kith-inn-fe/scripts/upload-weapp.test.ts` 覆盖参数、合法 URL、main SHA、按 SHA 查询/下载 `smoke-passed.json` 及字段/SHA/run/digest/migration/status 不匹配负例、临时私钥权限/清理、dry-run 与微信 SDK 错误脱敏
- [ ] T040 [US3] 在 `apps/kith-inn-fe/package.json`、`pnpm-lock.yaml` 与 `apps/kith-inn-fe/project.config.json` 锁定 `miniprogram-ci`、上传命令和 `urlCheck=true` 的非敏感项目配置
- [ ] T041 [US3] 在 `apps/kith-inn-fe/scripts/upload-weapp.ts` 实现 build digest、`ci.upload`、短 SHA 版本说明、0600 临时私钥和 finally 清理
- [ ] T042 [US3] 新增 `.github/workflows/release-kith-inn-weapp.yml`，仅 `workflow_dispatch` 选择 main SHA，通过 GitHub Actions API 查找并严格校验 PR7 为该 SHA 生成的未过期 `smoke-passed.json` 后，经 Environment 审批和 IP 白名单上传；不得把手填 SHA 本身视为通过证明
- [ ] T043 [US3] 运行缺凭据/非法 URL/非 main SHA/无 marker/marker 字段错配负例、同 SHA 两次 dry-run与一次受控测试上传，检查日志/产物无私钥、OpenID、token
- [ ] T044 [US3] 运行 uploader coverage、H5/weapp production build、`pnpm verify` 与 `git diff --check`，记录 PR8 人工 diff <400 行

## Phase 5: User Story 4 - 桃子白名单真机交付（P4，PR9）

**Goal**: 在真实 ECS/RDS/合法域名/体验版上完成最终发布、真机核心链路和回滚证据。

**Independent Test**: 桃子在开启域名校验的白名单真机登录指定版本，完成 7 个核心步骤且跨 seller 暴露为零；候选证据可反查同一 SHA/digest/migration/smoke/upload，失败演练可恢复。

- [ ] T045 [US4] 新增 `specs/017-kith-inn-trial-deployment/evidence/trial-acceptance.md` 脱敏模板，字段与 `data-model.md`/发布契约一致并明确禁录内容
- [ ] T046 [US4] 在 GitHub Production Environment、阿里云与微信后台配置域名/TLS、专用 secret、请求合法域名、上传 IP 白名单和桃子体验成员，仅把名称/存在性结果写入 `evidence/trial-acceptance.md`
- [ ] T047 [US4] 从最新 main 运行 kith-inn production target，核对 RDS `cms` migration/seed、三镜像 digest、readiness 与 health+认证+只读 smoke，并记录脱敏 run 链接
- [ ] T048 [US4] 对同一 smoke_passed SHA 运行体验版上传 workflow，核对微信版本、构建摘要、请求域名与桃子白名单后更新 `evidence/trial-acceptance.md`
- [ ] T049 [US4] 由桃子真机在域名校验开启时完成微信登录、记单、确认订单、菜单生成/换菜/发布、标已付和批量送达，记录步骤布尔结果与脱敏最终状态
- [ ] T050 [US4] 演练上一 digest/数据恢复分支并完成最终 `pnpm verify`、证据 secret 扫描、`git diff --check`；全部通过后将 Release Candidate 标为 `device_accepted` 并关闭 #158

## Dependencies & Execution Order

- PR1 必须先 Ready review、CI 全绿、Codex 无 comment 并 rebase merge；之后 PR2→PR9 逐片从最新 main 开始，上一片未合并不得提前实现下一片。
- PR2/PR3 固定配置边界，PR4 才生成生产 migration/seed；PR5 只包装已验证 app。PR6 才组装 runtime/smoke，PR7 才赋予生产写权限，PR8 只上传 PR7 已验证 SHA，PR9 才操作真实云与真机。
- 每片先写会失败的窄测试/负例，再做最小实现；review 发现的当前不变量缺陷本片闭环，无关能力另开 issue。
- PR4 baseline migration 是机器生成 diff；人工 diff 仍按 400 行预算。任何 PR 人工 diff >800 必须先取得发起人同意。

## Parallel Opportunities

- PR3 的 CMS env 测试 T011 与 BE env/readiness 测试 T012 文件独立，可并行；实现仍依次收口。
- PR5 的三个 Dockerfile T023–T025 文件独立，可并行，T026 统一验证后再收口。
- PR6 的 Compose T028、Nginx T029 与文档 T033 可并行起草；T030→T031→T032 的 smoke 链必须顺序完成。

## Requirement Coverage

| 范围 | 任务 |
|------|------|
| FR-001–FR-005、SC-001–SC-002 | T006–T016、T023–T027 |
| FR-006–FR-010、SC-003、SC-007 | T017–T022、T028–T034 |
| FR-011–FR-012、SC-005 | T039–T044、T046、T048 |
| FR-013、SC-004 | T030–T038、T047 |
| FR-014–FR-015、SC-006 | T045–T050 |
| FR-016–FR-018、SC-008 | T033–T038、T050 |
| FR-019–FR-020 | 每个 PR 收口任务、T021、T050 |

## Format Validation

- 共 50 项任务，ID 连续为 T001–T050，每项只属于一个 PR。
- User Story 任务均带 `[US1]`–`[US4]`；Setup 任务不滥用 story 标签，`[P]` 只用于不同文件且无未完成依赖的任务。
- 所有实现任务给出精确仓库路径，外部操作只记录变量名称/存在性与脱敏证据，不记录真实值。
