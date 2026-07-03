# Tech Spec：街坊味（kith-inn）

> 状态：草稿 v0.13 ｜ 最近更新：2026-07-02
> v0.13 变更：**订单三表定稿**——`orders` 改为一人一日一餐，餐次上移到 `orders.occasion`；`order_items` 不再有 `mealOccasion/timeWindow`；`fulfillments` 改为挂 `order`，地址从 `orders.address` 读取，履约状态收口为 `pending/done/canceled`。
> v0.12 变更：**同步 PRD v1.10 数据模型决策分层**——已确认：地址用单个 string、不再建 customer_addresses/楼栋地址模型、自家单不设 self/onsite 特例、不做奶奶协同字段、菜品池 M1 只维护菜名 + 主料且 `offerings.recipe` 仅预留；`orders` / `order_items` / `fulfillments` 于 v0.13 定稿。
> v0.11 变更：**架构从 C′ 调整为「官网单独 + 共享 cms」**——`apps/cms` 升为 kith-inn 及未来小 app 的【共享 Payload host】（schema `"cms"`，不再 kith-inn 专属、schemaName 不再是 `kith_inn`）；各 app 的集合/类型/逻辑拆进自己的包（kith-inn → `packages/kith-inn-payload` 依赖 `payload`；零依赖领域内核 `packages/kith-inn-shared` 存枚举/类型/契约供 FE+BE+cms 共享）。官网 `apps/website` 仍单独。§1 图与表、§3.4 同步。**多租户插件 no-go**（弃，单走 §3.1 自家 `tenantScoped()` 工厂，详见 apps/cms/SPIKE.md）。
> v0.10 变更：**codex #66 P2 三项修正**：§3.3⑤ 订阅物化 idempotencyKey 含 occurrence 坐标；§3.3③ 搬单回退兼顾 menu_plan（仍有已发菜单则保持 open）；§3.2 idempotencyKey 撞键返回现存 order（不论状态）。
> v0.9 变更：**审查 issues spec 补全**：§3.1 增"job 信任根"小节（#63 安全前置）；§3.2 补 `(seller,paymentStatus)` 跨日未付索引（#62）；§3.3 ② 级联完整性、③ 回写加终态守卫 + 搬单幽灵 slot（#61）、⑤ subscription 物化子流程（#63）。
> v0.8 变更：**对抗审查落地**：① §3 增"时区基准=Asia/Shanghai"（修"今天/0点"未定义的 critical gap）；② §3.2 补 `orders (seller,idempotencyKey)` partial unique（挡重复提交 + 订阅物化 job 幂等）；③ §3.3 归档 archived→open force 守卫**下沉 cms beforeChange hook**。
> v0.7 变更：**slot 命中键 granularity-aware**（Codex P2 复审）：slot 归属 / 确认 upsert 键 / 反范式回写随 `service_slots.granularity` 取餐次或未来时段坐标；订单明细字段已在 v0.13 重定稿。
> v0.6 变更：**架构 C′**——§1 改为"各自 Payload、同库分 schema"；§3.4 M0 不再迁 website、大幅变轻；§7 cms spike 复杂度降 S；§2 DeepSeek 客户端 kith-inn-be 自带不抽 website。**§3 镜像 PRD 主链路状态模型**：索引加 `orders.status`、`fulfillments.serviceDate`、`chat_messages`；§3.3 加写侧状态机（draft 生命周期、slot upsert 开餐、chat 留存）；§3.4 加 `chat_messages` 集合。订单/履约字段细节已在 v0.13 重定稿。
> v0.5 变更：通审/Codex 修正——补回 §3 标题(P1-A)；明确 **legacy(menu-core/community-cooking/recipes)不复用、从 0 新建**；§5 后端合法域名需 ICP 备案(给桃子真机用 = 备案 or 微信云托管)、§7 加该决策项。
> v0.4 变更：§3 重写——租户隔离升级为硬机制（tenantScoped access 工厂 + 写侧 seller 覆写 + 跨租户引用校验 + 聚合禁裸 SQL）、索引清单、快照/派生/归档、M0 数据层任务（装 multi-tenant 插件、recipes 后门审计）。对应 PRD §7 v1.1 的数据模型。
> v0.3 变更：§4 把「今天」主对话 agent 抬为 **MVP 唯一 agent**（"MVP 零 agent"作废）；去掉防漏校验、买菜助手并入主 agent；新增 §4.1（一个 agent 多工具、范围外挡回、三层记忆 + 滚动 2 天会话、地址补全、agent 的 100% 覆盖策略）。对应 PRD §5.5。
> v0.11 及更早条目是历史记录；与 v0.13/PRD v1.11 冲突时，以 v0.13/PRD v1.11 为准。
> **本文是技术架构的唯一权威来源（source of truth）**；PRD 只做产品层面的简述并指回本文。
> 配套 PRD：[PRD](./PRD.md)
> **估算口径**：按复杂度 / 风险分级（S / M / L）+ 关键风险，墙钟只作松提示，基准"1 人主导 + AI 编码"。

---

## 1. 架构总览（官网单独 Payload + 共享 cms host + 按 app 分模块包；同库分 schema）

```
apps/kith-inn-fe      ──HTTPS──►  apps/kith-inn-be          ──REST/GraphQL──►  apps/cms            ──┐
(Taro+React, NutUI)               (Node/TS, Hono)                              (共享 Payload host,  │
weapp + H5                        ├─ 微信登录 / 业务 API                         schemaName="cms",   ├─►  一个 Postgres 实例（同一 RDS）
                                  ├─ DeepSeek 代理 + 确定性逻辑                   薄壳、不含业务集合)  │      ├─ schema "cms"      ← apps/cms（kith-inn + 未来小 app 共用）
                                  └─ (可选/非MVP) 应用内 ASR                                          │      └─ schema "website" ← apps/website
apps/website (官网，单独 Payload，schemaName="website") ─────────────────────────────────────────────┘

各 app 的集合/类型/逻辑在自己的包里（cms 只装配、不含业务集合）：
  packages/kith-inn-shared   零依赖领域内核（枚举/类型/契约）—— FE、BE、cms 都 import
  packages/kith-inn-payload  kith-inn 的 Payload 集合 + 租户 access/hooks —— 只 cms import（依赖 payload + shared）
  apps/kith-inn-be / -fe     import shared（不拖入 payload）
```

> **架构演进**：v0.6 定 C′（kith-inn 自己一个 Payload、schema `kith_inn`）。**v0.11 调整为「官网单独 + 其余共享 cms」**：`apps/cms` 升为 kith-inn 及未来小 app 的共享 Payload host（schema `"cms"`）；各 app 的集合/类型/逻辑放自己的包（`packages/<app>-payload`，依赖零依赖内核 `packages/<app>-shared`），cms 只做装配。**website 仍完全不动**（自带 `schemaName="website"`）。省 RDS 目的不变（共用一个 Postgres 实例），且官网与业务 app 进程/schema/迁移全隔离、未来加 app 不新增 Payload 进程（一台 ECS docker-compose 多容器，4G 够跑数个）。

**各 app / 包职责：**

| App / 包 | 栈 | 职责 |
|---|---|---|
| **`apps/cms`** | Next + Payload | **共享 Payload host**：装配各 app 集合、CRUD/GraphQL/REST API、admin 后台、鉴权、迁移。`schemaName="cms"`，连与 website 同一个 RDS（省实例），schema 独立。**薄壳——不含业务集合**，从各 app 的 payload 包 import（kith-inn → `@cfp/kith-inn-payload`）。 |
| **`packages/kith-inn-payload`** | TS（依赖 `payload`） | kith-inn 的 Payload 集合 + 租户 access/hooks（`tenantScoped`、`stampSeller`…）。只 cms import。 |
| **`packages/kith-inn-shared`** | TS（**零依赖**） | 领域内核：枚举（一次列全）+ 实体类型 + API 契约。FE、BE、cms 共用，FE/BE 不致拖入 payload。 |
| **`apps/kith-inn-be`** | **Node / TS（Hono）** | 业务/领域逻辑：确定性选菜/分组/聚合、订单结构化、DeepSeek 代理、微信登录。经 cms 的 HTTP API 读写。 |
| **`apps/kith-inn-fe`** | **Taro + React**，UI=**NutUI React** | 老板侧小程序（weapp + H5）。经 HTTPS 调 kith-inn-be。**不复用 `packages/ui`（shadcn 仅 Web、小程序跑不了）**。 |
| **`apps/website`** | Next + Payload（`schemaName="website"`） | 官网，**单独、原封不动**——自己的 Payload，与 cms 共用一个 Postgres 实例（各自 schema）。 |

**为什么这么拆**：① 共用一个 RDS（不另开实例）+ 一台 ECS docker-compose 多容器（不每 app 一台机）；② 各 app 集合/逻辑在自己的包、不混在 cms，未来加 app 干净（新包 + cms import）；③ 官网与业务 app 进程/schema/迁移全隔离、互不带入风险；④ 零依赖 `kith-inn-shared` 让 FE/BE 共享领域定义却不拖入 Payload。

> **共享 `cms` schema 的 slug 约定**：所有非官网 app 的表**都进 `cms` 这一个 schema**。Payload 同实例 collection slug **全局唯一**、且 **slug = 表名 = API 路由**（`/api/<slug>`）三合一，无法只前缀表名而留干净 API。故约定：**kith-inn 作为首个 app 保持干净 slug**（`sellers`/`operators`/`offerings`…），**未来进 cms 的 app 自命名空间 slug**（如 `alpha_*`）避免撞名。代价是同 schema 内前缀不一致（kith-inn 无前缀、后来 app 有）——可接受，kith-inn 是 cms 的主 app；若日后想统一，再给 kith-inn 补 `kith_inn_` 前缀（属破坏性改名、需迁移）。

## 2. 后端 ↔ Payload

- **Payload 的定位**：它不只是内容 CMS，而是"schema 驱动的数据 + API + admin + 鉴权 + access control"层。我们用它当 **数据 / CRUD / 鉴权 / 后台** 层——这是正当且常见的用法，且租户隔离正是它的强项。
- **边界（重要）**：**业务/领域逻辑放 `kith-inn-be`，不塞进 Payload**。确定性选菜、聚合、AI 编排都在后端。
- **访问方式**：kith-inn-be 经 cms 的 **REST / GraphQL HTTP API** 读写（跨进程，标准做法），**不**为了用 Payload Local API 而与 cms 同进程耦合。
- **不绕过 Payload**：写数据一律走 Payload API（让校验 / hooks / 租户 access control 生效），**禁止 kith-inn-be 直连同一个库写裸 SQL**（否则隔离/校验全失效）。
- **LLM host**：DeepSeek 调用一律走 kith-inn-be（**API key 只在服务端**）。kith-inn-be **自带一份客户端**（可参考 website 现有写法 `apps/website/src/lib/deepseek`，但**不抽取、不改 website**——C′ 下 website 原封不动）。

## 3. 数据模型与租户隔离

- **集合定义（字段级）见 PRD §7 / DATA-MODEL**（主干 spine + 模块表 + 组合机制 + 治理铁律）。本节定**租户隔离的硬机制、索引、迁移注意、派生策略**。

**时区基准（v0.8 增，对抗审查 critical gap）**：所有"今天 / 0 点 / order.date 查询 / chat_messages 留存裁剪 / 最近一餐聚焦 / slot 开餐归属 / 订阅物化"的日期判定一律以 **Asia/Shanghai** 为准（DB 存 UTC、查询/裁剪/物化按此时区算）——凌晨边界（清前天会话、单算哪天、今晚的单不算进明天）尤其依赖。

### 3.1 租户隔离（multi-tenant，第一天就建对，MVP 单租户也照建；必测 100%）

- **统一 `tenantScoped()` access 工厂**：所有 kith-inn 业务集合**必须经它包裹才注册**，access 默认"空约束/拒绝"而非放行。配集合遍历单测：断言每个带 `seller` 字段的集合 4 个 access 都引用该工厂——把"漏写第 N 张表"从运行期串户降级为 **CI 失败**。
- **写侧 `seller` 服务端钉死**：`beforeChange` hook 对所有租户集合**强制覆写 `seller = 当前 operator.seller`**（忽略请求体）；update/delete access 带 `where:{seller:{equals:tenantId}}`，挡"改不属于我的行"。
- **跨租户 relationship 校验（最隐蔽的越租户读）**：每个指向 spine 的 relationship 加 `filterOptions: ({user}) => ({seller:{equals:user.seller}})` + `beforeChange` 断言"被引用记录的 seller == 当前租户"。否则 A 把 `order.customer` 填成 B 的 id，`depth>0` populate 时直接读穿 B 的顾客地址、绕过 customers 自己的 access。
- **读侧聚合禁裸 SQL/where**：派生聚合经 Payload API 带 tenant 上下文取数后内存分组；若必须下推 SQL，经强制注入 `seller=:tenant` 的统一 query builder（纯函数 100% 覆盖，断言每条 SQL 含 seller 谓词）。把 seller 放索引最左是性能、不是访问控制——漏 seller 的 query 反而高效跑出全租户结果，更危险。
- **登录信任根**：`wx.login → code → kith-inn-be 换 openid → operator → seller`；tenant 解析层断言"token 携带的 seller == openid 链解析出的 seller"，否则 401。kith-inn-be 调 cms **以登录商家身份透传**，**严禁 admin/万能 key 直连**（订阅物化 job 也按租户带 token）。
- **job 信任根（审查 #63，V1 安全前置）**：订阅物化 job 的 `seller token` 是第二条信任根（区别于交互式 wx.login 链）——必须服务端签发、**绑定单个 seller_id**、短 TTL、`jti` 防重放；cms 侧校验时**三层相等**才放行 `bypassPublicClose`：`token.seller == 被物化 subscription.customer.seller == 被写集合的 seller`，任一不等或跨租户即 401；并给 token 泄露的检测/吊销路径（黑名单 + kid 轮换）。
- **多租户插件**：`@payloadcms/plugin-multi-tenant` **当前未安装**——M0 装它并显式声明 `sellers` 为 tenant 集合；它覆盖不到的（跨租户引用校验、写侧覆写）用上面的工厂/hook 补。

### 3.2 索引（Payload `CompoundIndex` 只支持 `{fields, unique?}`，**无 DESC、无 partial 谓词**；未部署→push 落地，见 §3.4）

| 索引 | 服务的查询 |
|---|---|
| `orders (seller, date, occasion, status, paymentStatus)` | 今天某餐确认订单(status=confirmed)、谁没付款；draft/canceled 同表靠 status 过滤掉 |
| `orders (seller, customer, date, occasion)` partial unique `WHERE status IN ('draft','confirmed')` | active 业务唯一坐标；重复粘贴同一天同餐同顾客时更新现存 order；canceled 历史单不占坑 |
| `orders (seller, customer, status, placedAt)` | 张阿姨上次点啥（**只看 status=confirmed**，排除草稿/取消；ASC 索引 + `ORDER BY placedAt DESC LIMIT 1` 走 backward scan，**别写 DESC**） |
| `fulfillments (seller, serviceDate, occasion, status)` | 谁没送、缺口对账；地址从 populated `order.address` 读取后内存相似度排序 |
| `service_slots (seller, date, occasion)` unique | 唯一约束 + 最近一餐定位 + 首单 upsert 命中 |
| `offerings (seller, mainIngredient, lastUsedAt)` | 菜单主料去重扫描（component 型） |
| `order_items (seller, order)` | "今天订单"的 join 走索引 |
| `chat_messages (seller, operator, createdAt)` | 展示对话分页拉取 + 留存裁剪（§5.5；ASC 索引 backward scan 取最近，删最旧 200 走正向）|
| `subscriptions (seller, status)` [V1] | 这周有哪些预定 |
| `orders (seller, idempotencyKey)` partial unique **WHERE NOT NULL** | 技术幂等：防同一次提交/订阅物化 job 重复写。业务上的“重复粘贴更新”不要暴露成“撞键”，而是在确认卡展示新增/更新/跳过 |
| `customers (seller, displayName)`、`customers (seller, address)` | 记单时名字→顾客、默认地址带出；地址是 string，不建 customer_addresses |
| `orders (seller, paymentStatus)` | 跨日"谁没付款/未付汇总"（paymentStatus 在 `(seller,date,status,paymentStatus)` 第 4 列、跨日查询命中不了，故单列；MVP 量级可全表扫）|

> 原手写 migration 里的 partial unique + 复合查找索引 drizzle push 都不会从 collection 重建——前者带 WHERE 谓词（Payload `indexes` 不支持），后者虽非 partial 但为审计统一也并入。**全部由 cms `onInit` 的 `ensureConstraints` 每次启动幂等重建**（`CREATE [UNIQUE] INDEX IF NOT EXISTS`，见 `apps/cms/src/db/ensureConstraints.ts`）：三个 partial unique（`service_slots (seller,date,occasion) WHERE occasion IS NOT NULL`、orders active 业务坐标 `WHERE status IN ('draft','confirmed')`、orders `idempotency_key WHERE ... IS NOT NULL`）+ 三个复合查找索引（`orders (seller,date,occasion,status,paymentStatus)`、`orders (seller,customer,status,placedAt)`、`fulfillments (seller,serviceDate,occasion,status)`）。其余常规（单字段）索引自走 push 同步。

**目标 schema（v0.13 订单三表定稿；已实现，未部署→push 同步不走 migration）**：

- `orders` 加 `occasion`，枚举同 `OCCASIONS`，required + index。
- `orders` 加 `(seller, customer, date, occasion)` active 业务唯一索引，partial predicate: `status IN ('draft','confirmed')`。
- `order_items` 删除 `mealOccasion`、`timeWindow`。
- `fulfillments` 从挂 `orderItem` 改为挂 `order`。
- `fulfillments.status` 枚举收口为 `pending/done/canceled`。
- `fulfillments` 删除 `orderItem`、`mode`、`assignee`、`timeWindow`。
- `customers` 删除 `kind`。

### 3.3 快照 / 派生 / 归档

- **快照**（`beforeChange` create 时定格）：`order_items.unitPriceCents`、`orders.address`。fulfillment 不重复存地址，只通过 `order.address` 展示/排序；不拆 `addrBuilding/addrUnit`。
- **派生不落表**（kith-inn-be 确定性纯函数，§4 阶梯0、§6 单测 100%）：地址相似度排序、"最近一餐"聚焦、未付汇总、`getTodayGaps(seller,date)`("今天还差什么"=跨表逐项查 menu_plan/未付/未送，`slot.status=open` 才进"今天该做"范围)。采购聚合后置，`offerings.recipe` 可预留但 M1 不启用。
- **归档软删**：`service_slots.status=archived` 时，其下 order/item/fulfillment 写操作经 access.update + hook 拦截，要求显式 `force`（对应二次确认）；不真删；保护范围含 menu_plans。**archived→open 的 force 守卫下沉到 cms 侧 service_slots beforeChange hook**（status 从 archived 转 open 必须带 force 否则拒绝），让确认/菜单发布/订阅物化/未来工具所有写路径统一被挡，不靠 be 各调用点自觉。
- **写侧状态机（确定性 hook/服务，可单测）**：
  - **① draft = 纯记录**：记单确认卡确认后才写草稿数据；draft 与会话留存解耦，但**不触任何经营表**——不开 slot、不建履约。
  - **② 确认订单 = 物化事务**：draft→`confirmed` 时按 `(seller, order.date, order.occasion)` upsert `service_slots`→open，并为该 order 创建一条 fulfillment；`archived` slot 不自动重开，需 force / 二次确认。
  - **③ 取消/修改级联**：取消 order 时其 fulfillment 置 `canceled` 终态；修改 `orders.date/occasion` 时同步 pending fulfillment 的 `serviceDate/occasion`，跳过 done/canceled 终态；修改 `orders.address` 不需要同步 fulfillment，因为地址从 order 读取。
  - **④ `chat_messages`** 写时执行留存策略（2 天窗口 + 1000 条上限超删 200），与业务表无级联。
  - **⑤ subscription 物化（V1）**：定时 job 扫 `status=active` 订阅 → 按 `pattern` 命中 `(date,occasion)` 坐标（未来 time-slot 生意再扩展为 date + start/end slot 坐标）+ 排除 `pausedRanges` → 物化为已确认 order，并走与"确认订单"同一物化事务。`idempotencyKey` 需包含 subscription id + 本期坐标，防 recurring/open-ended 后续期数误撞第一期；目标 slot 若 archived 则该期跳过 + 告警（不自动 force）。job 经 §3.1 job 信任根带 seller token。

### 3.4 M0 数据层任务（共享 cms host + 按 app 分模块包；**不动 website**）

- **新建 `apps/cms`**（共享 Payload host，`schemaName="cms"`）+ **`packages/kith-inn-payload`**（kith-inn 集合/access/hooks）+ **`packages/kith-inn-shared`**（零依赖领域内核：枚举/类型/契约）。`DATABASE_URL` 指向与 website 同一个 Postgres 实例（省 RDS），schema 独立。website 不动。
- ~~装 `@payloadcms/plugin-multi-tenant`~~ **（no-go，已弃）**：插件以 `user.tenants` 数组 + `tenant` 字段为模型，与我们的单 `seller` 模型冲突，共存只能禁用其 access 逻辑沦为纯 admin 装饰（M0 交付物是 H5、零价值）。改单走下面的自家工厂。详见 apps/cms/SPIKE.md。
- 实现 `tenantScoped()` access 工厂 + 写侧 seller 覆写 hook + 跨租户引用校验 + 集合遍历断言测试（均在 `packages/kith-inn-payload`）。
- 定义全部 spine + 模块集合（PRD §7）+ 基础设施集合 `chat_messages`（展示对话留存，§5.5；同样经 `tenantScoped()`）；**全新写、不复用 legacy**（`packages/menu-core`、`apps/community-cooking`、website 的 `recipes` 都是 legacy，以后清理；kith-inn 的 schema 根本不引它们）。
- seed 桃子一条 `sellers`（enabledModules = menu-planning/delivery/purchasing）+ 菜品池（`offerings` kind=component）。

> 共享 cms 让 M0 仍轻：**不迁 website、不改 website、无迁移历史延续性风险**——只是新建共享 host + kith-inn 模块包。

> **消费者不是租户**（V1）：是挂在某 seller 下的顾客，下单只看该商家；跨商家下单是后话。

## 4. AI 形态与使用纪律（遵循 Anthropic《Building Effective Agents》）

> 核心原则：**用最简单够用的方案，只在确有必要时才加复杂度**——能不用 agent 就不用。工作流（写死路径）适合可预测任务；agent 只在"路径无法预先确定、需模型在循环中自主决策"时才用，并要权衡其成本/延迟/不确定性。

**复杂度阶梯（从低到高，默认从最低档起步）：**

0. **确定性代码（无 LLM）**：分组、排序、去重、聚合、按规则选——能写死就别上 LLM。
1. **普通 LLM 调用**：需要理解自然语言 / 语义抽取 / 润色；上下文由我们注入 prompt，单轮、出结构化结果。
2. **Augmented LLM**：当"该取什么数 / 调什么工具"本身要模型判断、且候选多到塞不进 prompt 时，让模型自调检索 / 工具 / 记忆。
3. **Workflow**：多个 LLM / 工具按预定义代码路径编排（链式 / 路由 / 并行）。
4. **Agent**：步数 / 路径不可预测，模型在循环里自主决策 + 调工具，靠反馈推进。

**升级触发（三者同时满足才往上爬一档）**：① 低一档明显做不到；② 任务价值够高，值得多花的成本 / 延迟；③ 有确定性兜底路径且可测。缺一不升级。

**全产品 AI 触点映射（每个取最简够用形态）：**

| 触点 | 形态 | 里程碑 | 说明 |
|---|---|---|---|
| **「今天」主对话 agent** | **4 Agent** | **MVP** | **全产品唯一 agent**：自然语言入口，编排下面这些工具 + 订单结构化；浅多轮、范围外挡回、确定性兜底。工具 = kith-inn-be 后端操作，与详情 tab 同一套（PRD §5.5） |
| 菜单选菜（工具） | **0 确定性** | MVP | 规则选菜，绝不用 LLM 决定选哪道 |
| 送餐排序（工具） | **0 确定性** | MVP | 按地址字符串相似度/自然排序 |
| 采购聚合 + 用量估算（工具） | **0 确定性** | M2 | 食材 × 份数；"今天买什么菜"问答调它 |
| 订单结构化（agent 内解析步） | **1 普通 LLM 调用** | MVP | 接龙/口述→结构化（名字+份数+餐次，智能分午/晚）；顾客名字匹配、带出默认地址 |
| 菜单润色 / 节令 / 群文案 | **1 普通 LLM 调用** | MVP | 在确定性菜单之后润色 |
| 沟通文案模板 | **1 普通 LLM 调用** | M2 | 场景→一段她口气的话 |
| 经营画像·配置初始化（onboarding） | **1 普通 LLM 调用 / 轻 workflow** | 非 MVP | 引导式问答出结构化配置，详见 PRD §6.0（留白） |

**结论：MVP 有一个核心 agent（「今天」主对话），它编排上面这些"确定性 / 单轮 LLM"工具。** 纪律不变——agent 只**编排**、工具**确定性可测**、答不了有**兜底**、范围外**礼貌挡回**。采购/买菜问答是它的一个能力（采购工具 M2 才齐）；它不是"满屏 agent"，绝大多数动作落到确定性工具上。

**克制复杂度的红线：**
- 能写死的逻辑（选菜 / 分组 / 聚合）不套 LLM；
- 单轮够用就不上多轮 / agent；
- LLM 只做"理解 / 润色 / 编排"，**不做"选哪道菜 / 买什么"这类需高可靠性的决策**（交确定性代码）；
- 数据量级允许就把上下文塞进 prompt，不让模型自调检索；
- 真要上 agent：浅工具环、确定性兜底、可测（呼应仓库 100% 覆盖门禁）。

### 4.1 「今天」主 agent 架构（对应 PRD §5.5）

- **一个 agent，多工具**：agent 不持有业务逻辑，只**编排** kith-inn-be 的后端操作（记单/改单/出菜单/换菜/标已送/切已付/查状态/查历史…）。**这些工具与"菜单/订单/送餐"详情 tab 调的是同一套操作**——两个前门、一套实现，无重叠。
- **范围外挡回**：agent 的 system prompt 限定职责（帮桃子经营私房菜）；无关问题礼貌拒绝 + 引导回经营。
- **三层记忆（别混）**：
  - 展示的对话（她能滚动看到的）：**滚动 2 天窗口**（今天+昨天，每天 0 点清前天）+ **硬上限 1000 条（超出删最旧 200）**；带时间戳；到顶提示"更早已清理"。（数字暂定，试用期调。）
  - LLM 工作上下文（喂模型的，≠ 展示历史）：只喂**最近 ~3–5 轮（≈ 6–10 条）** + **token 预算**截断（大段接龙、旧工具返回裁掉/概括）；**事实即时调工具重查**、不靠旧上下文；不喂整 2 天——省 token、浅环、防陈旧上下文带偏。
  - 业务数据（真记忆）：在库里、永久；**历史问题 = agent 调工具查数据**，不是翻聊天。
- **地址补全**：订单结构化时按"接龙名字 → 顾客默认/最近地址"带出（PRD §6.4）；新名字无地址 → 提示补录。
- **100% 覆盖策略**：**工具**是确定性纯函数、直接单测到 100%；**agent 编排**用 **mock 掉 LLM + 脚本化工具序列** 测路由/兜底/挡回；端到端行为用 **e2e / eval** 兜（不强求 agent 的随机输出进 100% 行覆盖，靠覆盖排除 + e2e）。

## 5. 部署（套现有阿里云模型，见 [DEPLOYMENT.md](../../DEPLOYMENT.md)）

第一阶段路线：**阿里云 ECS + Docker Compose + 一个 RDS Postgres + ACR 镜像 + GitHub Actions + Nginx/SSL**，不上 K8s。

| 组件 | 部署 |
|---|---|
| `apps/cms` | ECS 容器（仿 `cfp-website` 镜像），Nginx/SSL，连**那一个共享 RDS**；Payload + admin 的家 |
| `apps/kith-inn-be` | ECS 容器，HTTPS + **合法域名**（微信硬性要求），调 cms |
| `apps/kith-inn-fe`·weapp | `taro build --type weapp` → **`miniprogram-ci`** 推到微信平台 → 体验版/审核/发布 |
| `apps/kith-inn-fe`·H5 | `taro build --type h5` → Nginx 静态托管（子域），跑自动化 + 预览 |
| DB | **一个共享 RDS Postgres**（C 让 cms 接管） |

- **MVP 试用 = weapp 体验版（白名单）——但"后端域名"是隐藏前提，别只盯前端**：真机体验版会**校验合法域名**，`kith-inn-be` 的 API 域名必须是已在小程序后台配置的 **request 合法域名、且需 ICP 备案**。**只把前端从 H5 换成 weapp，绕不过后端域名这一关**——否则体验版装到桃子手机上、API 全调不通。
  - 给桃子真机试用的可行前提，二选一：① **先给 `kith-inn-be` 域名做 ICP 备案**（数周周期，等于把备案提前到 MVP 前置）；② 用 **微信云托管 / 云开发**（其域名由微信侧处理、免单独备案，最快上真机）。**关闭域名校验的开发者工具调试不算桃子真用**。
  - **H5 子域仅团队内部开发 / 自动化测试**，不对外（未备案 HTTPS 不得对外服务，见 RUNBOOK/DEPLOYMENT）。
  - ⚠️ **这把"MVP 不需备案"的旧假设推翻了**：真要桃子用上，备案或云托管是前置——见 PRD §10 与下方待议。
- **`miniprogram-ci`**：微信官方 Node 包，CI 里自动上传/预览小程序（替代手动开开发者工具）。需后台「代码上传密钥」+ AppID + CI 机 IP 白名单。

## 6. 测试与 100% 覆盖策略

仓库门禁：CI（[ci.yml](../../.github/workflows/ci.yml)）每个 PR 跑 `pnpm verify`（含 **100% 覆盖**：statements/branches/functions/lines）+ `pnpm test:e2e`（playwright），并起临时 postgres 给 Payload 测。三个新 app 都要过。

- **`kith-inn-be`**：业务逻辑写成**纯函数 + 依赖注入**（确定性选菜/聚合/订单结构化）→ 单测轻松 100%；**边界全 mock**（DeepSeek、微信 openid、cms 的 HTTP API）。这正是"确定性内核 + 薄 LLM"的回报——确定性=可测，LLM 只在边界 mock。
- **`apps/cms`（Payload 集合）**：重点测 **access control（租户隔离，安全攸关，必测）**、hooks、校验，对着 CI 的临时 postgres 跑。
- **`kith-inn-fe`（Taro）**：**逻辑（hooks/状态/调接口）与展示分离**；逻辑 vitest 测到 100%，集成靠 H5 的 playwright e2e，**weapp 第一阶段手动测**（PLAN.md 既定）。FE 的 100% 最难，靠"组件小 + 逻辑抽离"扛。
- **覆盖排除**：生成的类型、配置、Payload 生成物、纯展示（交 e2e）排除在外，让 100% 落在真逻辑上（PLAN.md：代码刻意小而清楚，让 100% 有意义）。
- **代价自觉**：100% 是真税，从第一天约束代码风格（小、纯、可 mock）——前述架构选择（确定性内核、数据/逻辑分离）部分就是为交得起这个税。

## 7. 仍待议 / 后续任务

- **【决策·进行中】给桃子真机试用的后端域名**：ICP 备案（`kith-inn-be` 域名，**在审**）vs 微信云托管/云开发免备案试用。后者的 `callContainer`/`callFunction` 走**微信内部信道、不过「合法域名」校验、免 ICP 备案**——可让 kith-inn-be 仍跑 ECS、前面架一个薄云托管服务做代理转发；备案下来后切回直连合法域名、前端调用层几乎不改。注意：**体验版真机仍强制校验合法域名**，DevTools 关「校验合法域名」只对开发版生效，故关开关绕不过——只云托管/云开发这条信道能真正免备案。**2026-06-25 决定**：备案在审，若 MVP 编码完成前下来则直连、连代理都省；没下来再走云托管代理。
- **✅ apps/cms spike（已完成，PR1）**：(a) 共享 cms host（schema `"cms"`）与 website 同库分 schema 互不干扰——`tests/spike-coexistence.test.ts` 起真实 postgres 验证 `cms`/`website`/`public` 三 schema 并存零污染；(b) `@payloadcms/plugin-multi-tenant` 与 `operators+wechatOpenid` 鉴权 **no-go**（插件以 `user.tenants` 数组 + `tenant` 字段为模型、与我们单 `seller` 冲突，共存只能禁用其 access 逻辑），弃插件、单走 §3.1 自家 `tenantScoped()` 工厂。结论见 `apps/cms/SPIKE.md`。
- **更新 DEPLOYMENT.md**：现写"website 承载 Payload + DB"，需补"一台 ECS docker-compose 多容器：`apps/cms`（schema `cms`）+ kith-inn-be + kith-inn-fe H5 + nginx，共一个 RDS"；website 部分不变。
- 是否需要 MCP server 形态（取决于 §4 的 AI 形态；MVP 多为普通 LLM 调用，未必需要）。
- **ASR 选型（M2）**：微信同传插件 vs 云 ASR vs 自托管（MVP 不做，走系统输入法）。
- **DeepSeek v4 的 function-calling / tool-use 稳定性**（买菜助手 agent 的前提，M2+）。
- 数据模型字段级类型 / 索引（补 §3）。
