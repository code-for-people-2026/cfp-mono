# Feature Specification: kith-inn 桃子体验版部署与真机发布

**Feature Branch**: `017-kith-inn-trial-deployment`

**Created**: 2026-07-14

**Status**: Draft

**Input**: GitHub issue #158：打通可供桃子白名单真实试用的生产部署、体验版上传、部署验证与真机验收链路。

## 项目作用域

本功能把现有 `kith-inn` MVP 从仓库内可验证状态交付为桃子可在微信体验版白名单中真实试用的版本。生产主路径复用现有 ECS、RDS、ACR 和 GitHub Actions 基线，并使用已备案主体下、已在微信后台配置的 HTTPS 请求域名；微信云托管仅作为主路径因外部政策或资质无法落地时的备选，本功能不实施云托管迁移。

当前生产 Compose、部署工作流和 smoke 仅覆盖 website；CMS 与 BE 没有 Dockerfile；FE 未配置 `BE_BASE_URL` 时会回退到 `http://192.168.31.120:3310`；GitHub 当前也没有 kith-inn JWT、CMS internal token、BE API URL、微信登录与小程序上传凭据。这些均是待交付缺口，不得在验收记录中假定已满足。`demo.codeforpeople.cn` 仅供内部测试且未备案，不能作为真机合法域名证据。

范围仅限旧 `kith-inn`。H5 只供内部验证，不作为桃子正式入口；不得把 #161 的数据导出/删除、`kith-inn-v1`、客户侧 UI、在线支付、AI 新能力或正式版发布并入本功能。任何真实 secret、桃子 OpenID、上传私钥和可复用登录凭据不得进入仓库、日志、构建产物、PR 或验收截图。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 部署可回滚的体验环境 (Priority: P1)

作为维护者，我希望从同一个提交构建并部署 CMS、BE 和内部 H5，使它们通过 HTTPS 协同访问共享 RDS 的 `cms` schema，并能在失败时安全回滚。

**Why this priority**: 没有可重复、失败关闭且可回滚的生产环境，体验版即使上传成功也无法完成登录和业务操作。

**Independent Test**: 在隔离生产等价环境注入完整的非敏感配置和临时 secret，构建并启动三个服务，验证数据库初始化、HTTPS、健康检查和回滚；再分别移除关键配置，确认构建或启动在对外服务前失败。

**Acceptance Scenarios**:

1. **Given** 版本化产物、合法域名、共享 RDS 和完整 secret 已就绪，**When** 维护者执行部署流程，**Then** CMS、BE 与 H5 启动在预期版本，CMS 只使用 `cms` schema，website 现有服务不受影响。
2. **Given** 生产 `BE_BASE_URL` 缺失、为空、不是 HTTPS 或仍指向局域网，**When** 构建 H5/小程序或启动生产服务，**Then** 流程失败关闭且不产出可发布版本。
3. **Given** schema 初始化、seed、服务健康或部署后 smoke 任一步失败，**When** 流程进入回滚，**Then** 恢复到上一个已知可用应用版本，数据兼容性按 runbook 处置且不执行破坏性 reset。

---

### User Story 2 - 部署后自动证明可用 (Priority: P2)

作为发布者，我希望部署完成后自动验证 CMS/BE 健康、登录信任链和只读业务查询，避免把“进程启动”误当成“可试用”。

**Why this priority**: 仅探测端口无法发现数据库、内部 token、卖家映射或前端 API 配置错误。

**Independent Test**: 对已部署候选执行标准 smoke，确认两个服务健康、认证上下文可建立、目标卖家的只读经营数据可读取且数据写入数为零；制造失效 token、缺失 operator 和数据库不可用负例，确认发布失败。

**Acceptance Scenarios**:

1. **Given** 候选版本已启动且桃子卖家基线已安全准备，**When** 自动 smoke 运行，**Then** 它验证 CMS、BE、认证信任链及至少一个只读业务接口，并把结果绑定到该版本。
2. **Given** 自动化无法安全复用一次性微信 code，**When** 验证认证链，**Then** 使用部署环境内生成的短时、最小权限验证上下文，不新增公开登录旁路；真实微信登录仍由真机验收证明。
3. **Given** 任一 smoke 失败，**When** 部署流程收口，**Then** 候选不得标记为可试用，并保留脱敏诊断和明确回滚指引。

---

### User Story 3 - 可重复上传微信体验版 (Priority: P3)

作为发布者，我希望用可审计命令把指定提交的小程序产物重复上传为体验版候选，并由桃子白名单访问正确的生产 HTTPS API。

**Why this priority**: 手工开发者工具上传无法稳定关联代码版本、配置和证据，也容易把本地地址或私钥带进产物；上传必须以已通过部署 smoke 的候选为输入。

**Independent Test**: 在不展示私钥的环境中对固定提交执行上传流程，核对构建前置校验、上传版本、提交标识与产物摘要；用缺少凭据和非法 API URL 的负例确认上传不会开始。

**Acceptance Scenarios**:

1. **Given** AppID、代码上传私钥、CI IP 白名单和合法 HTTPS API URL 已安全配置，**When** 发布者执行标准上传入口，**Then** 平台产生可识别的体验版候选，并记录与提交和构建产物的对应关系。
2. **Given** 上传凭据、域名前置或生产构建任一未满足，**When** 执行上传，**Then** 流程在调用微信上传前失败，日志只显示脱敏诊断。
3. **Given** 桃子已加入体验成员且请求域名已配置，**When** 她打开指定体验版，**Then** 所有业务请求使用该 HTTPS 域名，且真机未关闭域名校验。

---

### User Story 4 - 桃子完成白名单真机试用 (Priority: P4)

作为桃子，我希望在微信真机体验版中成功登录，并完成记单、确认订单、生成/换菜/发布菜单、标已付和批量送达的核心链路。

**Why this priority**: 只有真机、真实微信登录、合法域名校验与生产数据链路共同通过，才达到本功能的最终交付目标。

**Independent Test**: 清理到约定的试用基线后，让白名单中的桃子在真机打开指定体验版并执行完整核心链路；按验收模板记录版本、时间、步骤与最终状态，不采集敏感内容。

**Acceptance Scenarios**:

1. **Given** 桃子已加入体验成员、真实 OpenID 已安全映射到桃子卖家且域名校验开启，**When** 她首次进入体验版，**Then** 微信登录成功且只能访问自己的经营数据。
2. **Given** 桃子已登录，**When** 她从接龙记单走到批量送达，**Then** #157 已验证的核心步骤在生产环境全部成功，最终订单、菜单、收款与履约状态一致。
3. **Given** 真机步骤失败或证据不完整，**When** 发布者评估候选，**Then** 该版本不得标记为“桃子体验版已交付”，并按 runbook 回滚或重新部署后完整复验。

### Edge Cases

- 已备案域名尚未完成微信后台配置、证书链不完整、证书过期或域名与证书不匹配时，真机发布必须阻断。
- `demo.codeforpeople.cn`、IP、localhost、局域网 URL 或通过“关闭域名校验”才能访问的地址不得被验收为生产请求域名。
- 共享 RDS 可达但 `cms` schema 不存在、只完成部分初始化或迁移版本不匹配时，服务不得以健康状态接收业务流量。
- 首次 seed 中途失败或重复执行时，不得留下半套桃子卖家数据、重复 operator 或跨卖家关系；不得调用开发 reset。
- CMS/BE 进程存活但数据库、internal token 或卖家映射不可用时，readiness 与 smoke 必须失败。
- 小程序上传成功但体验成员、请求域名或上传版本关联错误时，不得进入真机验收。
- 自动 smoke 的短时认证材料生成失败、过期或出现在日志中时，部署必须失败并轮换相关凭据。
- 新 schema 与旧应用不兼容时，应用回滚不得盲目回退数据库；runbook 必须选择向前修复或从已验证备份恢复。
- 微信 code 交换或外部 API 临时不可用时，自动 smoke 不得启用开发登录兜底；真机复验应在外部服务恢复后重试。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 交付 MUST 构建并运行旧 `kith-inn` 的 CMS、BE、H5 生产产物和微信小程序产物；H5 仅限内部验证，小程序体验版是桃子的唯一试用入口。
- **FR-002**: 生产 CMS MUST 使用共享 RDS 的 `cms` schema，并与现有 website schema 隔离；不得修改、重置或依赖 `kith-inn-v1` 业务数据。
- **FR-003**: 生产配置 MUST 对数据库 URL、Payload secret、JWT secret、CMS internal token、CMS/BE 地址、微信登录凭据及前端 API URL 逐项校验；缺失、空值或占位值必须在接收流量前失败关闭。
- **FR-004**: H5 与小程序生产构建 MUST 要求显式 HTTPS `BE_BASE_URL`，拒绝 HTTP、IP、localhost、局域网地址和隐式默认值；现有 `192.168.31.120` 回退不得进入任何发布产物。
- **FR-005**: CMS、BE 与 H5 MUST 形成可版本化、可重复构建的发布产物，并记录源提交和不可变产物标识；构建日志与镜像层不得包含 secret。
- **FR-006**: 生产编排 MUST 复用现有 ECS、RDS、ACR 基线，通过 Nginx 提供有效 TLS 终止和最小公网暴露；微信云托管仅记录为未实施备选。
- **FR-007**: 系统 MUST 区分 liveness 与可验证数据库/依赖的 readiness；部署只有在 CMS、BE 和必要前端入口均通过后才可进入 smoke。
- **FR-008**: 首次生产初始化 MUST 使用可审计、幂等且不可破坏既有数据的 schema/迁移与 seed 策略；后续部署不得依赖自动 push 或开发 reset 改写生产 schema。
- **FR-009**: 桃子 seller/operator 基线 MUST 可幂等准备；真实 OpenID 只能由受控 secret 或人工受控步骤注入，不得硬编码、输出或提交到仓库。
- **FR-010**: 部署 MUST 使用已备案主体下的有效 HTTPS 子域名，并在微信后台配置为请求合法域名；不得通过开发者工具或真机关闭域名校验完成验收。
- **FR-011**: 项目 MUST 提供可重复的小程序构建与上传入口，校验 AppID、代码上传私钥、CI IP 白名单、项目配置、版本说明与提交标识，并在缺失时于上传前失败。
- **FR-012**: 上传私钥、AppSecret、JWT/CMS token、数据库凭据和真实 OpenID MUST 仅存在于受控 secret 存储或目标主机权限受限文件中，且不得进入仓库、日志、PR、普通构建产物或验收截图。
- **FR-013**: 部署后自动 smoke MUST 验证 CMS/BE 健康、认证信任链、operator 与 provisioning 输出的目标 seller ID 一致，以及该 seller 的只读业务查询，并证明业务写入数为零；不得增加生产公开 dev-login 或永久 smoke 后门。
- **FR-014**: 真机验收 MUST 使用白名单中的桃子微信、指定体验版和开启的域名校验，成功覆盖微信登录、记单、确认订单、菜单生成/换菜/发布、标已付和批量送达。
- **FR-015**: 每次候选发布 MUST 产生脱敏证据，至少包含源提交、产物标识、部署时间、目标环境、域名/TLS 前置、自动 smoke、体验版版本和真机核心步骤结果。
- **FR-016**: 中文 runbook MUST 覆盖环境变量与 secret 注入、DNS/HTTPS/Nginx、RDS `cms` 初始化、seed/迁移、健康与 smoke、上传/白名单、故障诊断和应用/数据回滚。
- **FR-017**: 任一构建、初始化、部署、smoke、上传或真机验收失败 MUST 阻止候选被标记为可试用，并给出不泄密的诊断与明确恢复步骤。
- **FR-018**: 生产部署改动 MUST 保持现有 website 部署和健康检查可独立运行；kith-inn 未受影响时不得要求其他项目 PR 提供 kith-inn 生产 secret 或执行真实上传。
- **FR-019**: 实现 MUST 通过相关窄测试、生产构建验证和全仓 `pnpm verify`，并按单一核心不变量拆成可独立 review 的 PR。
- **FR-020**: 本功能 MUST NOT 实现 #161、`kith-inn-v1`、客户 UI、在线支付、正式版发布或新 AI 能力；外部白名单扩大前另行完成数据权利工作。

### Key Entities

- **Release Candidate**: 绑定源提交、CMS/BE/H5/小程序产物、非敏感配置摘要与不可变版本标识的一次候选发布。
- **Deployment Record**: 候选在目标环境的部署状态、schema 版本、健康结果、回滚点和脱敏诊断。
- **Trial Operator Binding**: 桃子微信身份到既有 seller/operator 的受控映射；真实 OpenID 不属于可提交数据。
- **Smoke Evidence**: 绑定候选版本的健康、认证信任链和只读业务验证结果，且不包含可复用凭据。
- **Device Acceptance Evidence**: 指定体验版在桃子真机上的版本、域名校验状态、核心步骤与最终状态记录。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 从干净 checkout 对同一提交连续执行两次生产构建，CMS、BE、H5 与小程序产物成功率为 100%，每项都可追溯到同一提交。
- **SC-002**: 对生产前端 URL 的缺失、空值、HTTP、IP、localhost、局域网和占位值负例，构建或启动阻断率为 100%，产出可上传小程序数为 0。
- **SC-003**: 全新生产等价数据库和已初始化数据库各执行两次初始化/seed，第二次新增重复 seller/operator 数为 0，开发 reset 调用数为 0。
- **SC-004**: 部署后 smoke 对 CMS、BE、认证信任链和只读业务检查的覆盖率为 100%，业务数据写入数为 0，日志 secret 泄漏数为 0。
- **SC-005**: 标准入口上传的每个体验版都能核对到唯一源提交、构建配置摘要和微信版本说明；缺失凭据时微信上传调用数为 0。
- **SC-006**: 桃子在开启域名校验的白名单真机上成功登录并完整执行规定核心链路至少 1 次，规定步骤完成率为 100%，跨卖家数据暴露数为 0。
- **SC-007**: 对任一部署失败演练，维护者能在 15 分钟内按中文 runbook 恢复上一已知可用应用版本或明确进入数据恢复流程，误执行破坏性 schema/reset 次数为 0。
- **SC-008**: kith-inn 部署变更通过相关窄验证和 `pnpm verify`；代表性无关项目 diff 触发真实部署、上传或索取 kith-inn secret 的次数为 0。

## Assumptions

- #157 已交付 H5→BE→CMS→PostgreSQL 核心链路证据；本功能复用该业务契约，不重新设计订单、菜单、收款或履约。
- 继续复用现有阿里云 ECS、RDS、ACR 与 GitHub `Production` 环境；基础云资源已存在，但 kith-inn 专用 secret、域名、证书、微信凭据仍需在实施期由仓库外安全配置。
- 主路径会取得已备案主体下可用于微信请求域名的 HTTPS 子域名；如果该外部前置无法满足，发布保持阻断，云托管迁移需另行批准。
- 首轮体验仅开放桃子白名单，H5 只供团队内部诊断；#161 的数据导出/删除在扩大到外部用户前另行完成。
- 真机验收允许人工执行，但版本、域名校验状态和每个规定步骤必须按统一模板留下脱敏证据。
