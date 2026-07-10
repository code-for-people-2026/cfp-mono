# 功能规格：kith-inn-v1 共享 CMS 骨架与数据层

**功能分支**: `codex/kith-inn-v1-m0-plan`

**创建日期**: 2026-07-10

**状态**: 草稿（计划评审中）

**输入**: 审阅 `docs/kith-inn-v1/` 下的 user stories、tech spec、data model，并规划首个里程碑 M0“骨架与数据层”。补充约束：除 `website` 外，monorepo 中的小项目共用 `apps/cms` 这一套 Payload 实例和 PostgreSQL `cms` schema，通过 collection 前缀隔离，以控制 ECS 常驻资源。

## 项目作用域

**项目**: `kith-inn-v1`

**允许触碰的源码路径**:

- `packages/kith-inn-v1-shared/**`
- `packages/kith-inn-v1-payload/**`
- `apps/cms/payload.config.ts`（只聚合 v1 collections）
- `apps/cms/package.json`（只增加 v1 payload package 依赖）
- `apps/cms/seed/**`（只编排 v1 seed/reset）
- `apps/cms/tests/**`（只增加共享 schema、装配和 seed 回归验证）
- `docs/kith-inn-v1/**`（只同步本轮 review 确认的长期产品/技术决策）
- `pnpm-lock.yaml`（新 workspace 依赖变化）

**明确不触碰**:

- `apps/kith-inn-be/**`
- `apps/kith-inn-fe/**`
- `packages/kith-inn-shared/**`
- `packages/kith-inn-payload/**`
- `apps/cms/src/app/api/internal/**` 的旧 kith-inn route
- `apps/website/**` 和 PostgreSQL `website` schema

## 用户场景与测试

### 用户故事 1：在现有 CMS 中装配 v1（优先级：P1）

作为仓库维护者，我希望 kith-inn-v1 复用现有 `apps/cms` Payload 进程，而不是再启动一套 Payload，这样小规格 ECS 只承担一个共享 CMS 常驻进程。

**优先原因**: 共享运行时是明确的部署资源约束；M0 的结构必须先服从它。

**独立测试**: 只启动 `apps/cms`，确认旧 kith-inn 和 v1 collections 同时完成装配，且没有新增第二个 Payload app、端口或进程。

**验收场景**:

1. **Given** 现有 `apps/cms` 可以独立启动，**When** 装配 v1 数据 package，**Then** 同一个 Payload config 同时注册旧 kith-inn 和 v1 collections。
2. **Given** ECS 只启动 `apps/cms`，**When** v1 collections 被访问，**Then** 不依赖另一套 Payload/Next 服务。
3. **Given** v1 M0 完成，**When** 检查 workspace，**Then** 本里程碑没有创建空的 `apps/kith-inn-v1-be` 或 `apps/kith-inn-v1-fe` 骨架。

---

### 用户故事 2：同 schema 内无碰撞共存（优先级：P1）

作为仓库维护者，我希望 v1 的表、API slug 和后台分组与旧项目清楚区分，这样两个项目可以共用 PostgreSQL `cms` schema，而不会覆盖或误查彼此数据。

**优先原因**: 同一 schema 下，命名碰撞会直接破坏旧项目；前缀是共享 host 的硬边界。

**独立测试**: 在空的 `cms` schema 启动 Payload，检查旧表和全部 `kiv1_` 表同时存在；旧 collection 清单、slug 和约束保持不变。

**验收场景**:

1. **Given** 旧 kith-inn collections 已注册，**When** 注册 v1 collections，**Then** 每个 v1 slug/table 都以 `kiv1_` 开头且没有重名。
2. **Given** 同一个 `cms` schema，**When** Payload 完成 schema push，**Then** 旧表仍存在且字段、索引、数据不被 v1 初始化修改。
3. **Given** Payload Admin 展示多个项目，**When** 查看导航，**Then** v1 collections 使用“街坊味 v1”分组，不与旧菜单/订单分组混在一起。

---

### 用户故事 3：身份与数据边界不混用（优先级：P1）

作为产品维护者，我希望共享 CMS 的管理员身份与 v1 产品身份明确分开，这样不会误把旧 kith-inn 的 operator token 当作 v1 商家或顾客权限。

**优先原因**: 共用 Payload 不等于共用产品账号；这里混淆会造成越权和后续认证返工。

**独立测试**: 检查 Payload config 和 collection access：Admin user 仍是旧 `operators`；`kiv1_operators` 只是 v1 业务身份；未认证请求无法访问 v1 collections。

**验收场景**:

1. **Given** 共享 CMS 已有 Admin user collection `operators`，**When** 装配 v1，**Then** `admin.user` 不改变，旧 Admin 登录保持可用。
2. **Given** v1 需要自己的商家身份，**When** 创建 `kiv1_operators`，**Then** 它不成为 Payload Admin user，也不复用旧 seller/operator 数据。
3. **Given** 未认证请求，**When** 直接访问任意 v1 Payload collection，**Then** 请求被拒绝。
4. **Given** 未来 v1 业务 API 访问 CMS，**When** 执行 seller/customer 数据操作，**Then** 必须先验证 v1 自有 JWT，并从 JWT 推导 seller/openid；共享 Admin token 不作为产品 token。

---

### 用户故事 4：可重复初始化桃子资料（优先级：P2）

作为开发者，我希望现有 CMS seed 一次完成旧项目和 v1 的初始化，并可以安全重复执行，这样本地与体验环境有稳定起点。

**优先原因**: 共享 host 应只有一个 seed 入口，但不同项目仍各自拥有 seed 逻辑和数据。

**独立测试**: 在空库连续执行两次 `@cfp/cms` seed；第二次不新增 v1 seller/operator，也不覆盖旧项目或已有 v1 业务数据。

**验收场景**:

1. **Given** v1 数据为空，**When** 执行共享 CMS seed，**Then** v1 创建一条桃子 seller 和一条绑定的 v1 operator。
2. **Given** v1 桃子 seller/operator 已存在，**When** 再次执行 seed，**Then** v1 seed 幂等跳过。
3. **Given** v1 seed 失败，**When** 再次执行共享 seed，**Then** 可以从已有旧项目数据继续恢复，不要求清空整个 `cms` schema。
4. **Given** 执行显式本地 reset，**When** reset 通过现有安全守卫，**Then** 两个项目只删除各自列出的 collection，顺序满足各自外键关系。

### 边界情况

- 任意 v1 collection 忘记 `kiv1_` 前缀时，装配测试必须失败。
- v1 collection 数量或顺序变化时，不得改变旧 collection 对外 slug。
- `kiv1_operators.wechatOpenid` 与旧 `operators.wechatOpenid` 可以值相同，但记录、seller 和 token 语义完全独立。
- 桃子手动建立的顾客资料可能尚无 openid；此类资料只能通过商家业务 API 使用，不能被顾客自动认领。
- 顾客资料停用后，历史订单快照仍可读。
- 餐次日期必须按 Asia/Shanghai 的 `YYYY-MM-DD` 日历日解释，不能因 UTC 转换偏移一天。
- 共享 CMS schema push 或 seed 发生错误时，不能自动 drop/reset 整个 `cms` schema。

## 需求

### 功能需求

- **FR-001**: v1 M0 必须复用现有 `apps/cms` Payload config、进程、端口和 PostgreSQL `cms` schema；不得创建第二套 Payload app。
- **FR-002**: v1 代码不得导入旧 `kith-inn` 的业务 app 或 package；`apps/cms` 只能作为 collection/seed 聚合层。
- **FR-003**: 所有 v1 collection slug 必须以 `kiv1_` 开头，Admin group 必须以“街坊味 v1”开头。
- **FR-004**: M0 必须建立且只建立七个 v1 业务集合：商家、operator、顾客资料、菜品、餐次、预订批次、订单。
- **FR-005**: 共享 Payload Admin user 必须继续使用旧 `operators` collection；`kiv1_operators` 是普通 v1 业务 collection，不启用 Payload Admin auth。
- **FR-006**: v1 collections 必须默认拒绝未认证 Payload 请求；已认证共享 CMS Admin 是可信运维入口，可检查 v1 数据，但不代表 v1 产品权限。
- **FR-007**: 每个 seller-owned v1 collection 必须带 `seller`；所有关系写入必须校验引用记录属于同一 v1 seller。
- **FR-008**: 未来 v1 产品 route 使用 `overrideAccess` 时，必须从已验证的 v1 JWT 推导 seller/openid，并在写入前验证 owner 和跨 seller 引用；不得信任请求体 seller。
- **FR-009**: 顾客资料必须把称呼和地址保存为一个整体；openid 可以为空，以支持桃子替尚未进入小程序的顾客记单。
- **FR-010**: 未绑定 openid 的顾客资料不得通过顾客身份查询；系统不得仅凭称呼或地址自动绑定 openid。
- **FR-011**: 餐次必须同时承载日期、午/晚、菜单快照、预订状态、截止时间和价格，不建立一对一的独立菜单计划集合。
- **FR-012**: 预订批次必须直接关联多个餐次，不建立只用于连接批次与餐次的独立集合；分享 path 由公开 id 派生，不落库。
- **FR-013**: 订单必须直接保存套餐份数、单价快照、称呼/地址快照、确认状态、付款状态和送达状态，不建立订单明细或履约一对一集合。
- **FR-014**: 订单必须关联餐次；已绑定顾客资料的同一餐次只能存在一条订单记录，重复提交复用该记录。
- **FR-015**: 所有日历日必须使用 `YYYY-MM-DD` 保存和校验，并按 Asia/Shanghai 解释；时间点使用带时区的时间戳。
- **FR-016**: M0 只提供共享 CMS collection 装配、数据约束、seed 和验证；不提供 v1 业务 API、小程序页面或 AI 能力。
- **FR-017**: 共享 CMS seed 必须分别调用旧/v1 seed；v1 seed 只创建 v1 桃子 seller/operator，不覆盖旧数据。
- **FR-018**: 长期文档必须与本规格保持一致，包括分享路由、共享 CMS/same-schema 约束、顾客资料可空 openid 规则和精简后的 collection 清单。

### 核心实体

- **商家**: v1 的租户根，保存商家名、默认套餐价格和启用状态；不复用旧 seller。
- **Operator**: v1 商家侧产品身份，绑定一个 v1 seller 和唯一微信身份；不是 Payload Admin user。
- **顾客资料**: 一条“称呼 + 地址”的绑定资料，可选绑定一个 openid；订单保存其快照。
- **菜品**: 菜名、主料、类别和启用状态，是菜单生成候选池。
- **餐次**: 某个日历日的午餐或晚餐，包含菜单快照以及预订开放、截止和价格信息。
- **预订批次**: 一次分享所选择的一组餐次，拥有不可猜测的公开标识和开关状态。
- **订单**: 一个顾客资料在一个餐次的套餐份数及确认、付款、送达生命周期；可保留无地址的审核兜底订单。

## 成功标准

### 可衡量结果

- **SC-001**: 只启动一个 `apps/cms` 进程即可同时使用旧 kith-inn 和 v1 collections，M0 不增加 Payload 常驻进程。
- **SC-002**: `cms` schema 中七个 v1 主表全部以 `kiv1_` 开头，旧 kith-inn 主表和 `website` schema 均保持不变。
- **SC-003**: 未认证访问、缺前缀 collection、跨 v1 seller relationship 三类保护测试全部通过。
- **SC-004**: 共享 seed 连续执行两次后，旧 seed 结果不变，v1 桃子 seller/operator 数量仍各为 1。
- **SC-005**: M0 自动化验证覆盖共享 schema、collection 聚合、数据约束、关系守卫和 seed 分支，且仓库质量门禁全部通过。

## 假设

- “第一个 milestone”指 `TECH-SPEC.md` 中最先列出的 M0“骨架与数据层”。
- `website` 继续使用独立 Payload app 和 PostgreSQL `website` schema；本功能只调整共享 `apps/cms`。
- 共享 `apps/cms` 是可信运维面，目前由旧 kith-inn `operators` 登录；它不是任一产品的公网业务 API。
- MVP 只有桃子，但 v1 seller 仍独立建模；未来其他项目也必须使用自己的 collection 前缀。
- v1 尚无生产数据，沿用 `apps/cms` 当前 schema push 模式；出现需保留的真实数据后统一建立 migration baseline。
- `apps/kith-inn-v1-be` 和 `apps/kith-inn-v1-fe` 在出现第一个可运行商家功能切片时再创建，不在 M0 建空壳。
