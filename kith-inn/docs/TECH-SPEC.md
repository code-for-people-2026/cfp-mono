# Tech Spec：街坊味（kith-inn）

> 状态：草稿 v0.4 ｜ 最近更新：2026-06-25
> v0.4 变更：§3 重写——租户隔离升级为硬机制（tenantScoped access 工厂 + 写侧 seller 覆写 + 跨租户引用校验 + 聚合禁裸 SQL）、索引清单、快照/派生/归档、M0 数据层任务（装 multi-tenant 插件、recipes 后门审计）。对应 PRD §7 v1.1 的数据模型。
> v0.3 变更：§4 把「今天」主对话 agent 抬为 **MVP 唯一 agent**（"MVP 零 agent"作废）；去掉防漏校验、买菜助手并入主 agent；新增 §4.1（一个 agent 多工具、范围外挡回、三层记忆 + 滚动 2 天会话、地址补全、agent 的 100% 覆盖策略）。对应 PRD §5.5。
> **本文是技术架构的唯一权威来源（source of truth）**；PRD 只做产品层面的简述并指回本文。
> 配套 PRD：[PRD](./PRD.md)
> **估算口径**：按复杂度 / 风险分级（S / M / L）+ 关键风险，墙钟只作松提示，基准"1 人主导 + AI 编码"。

---

## 1. 架构总览（应用拆分 = 方案 C）

```
apps/kith-inn-fe      ──HTTPS──►  apps/kith-inn-be          ──REST/GraphQL──►  apps/cms          ──►  Postgres
(Taro+React, NutUI)               (Node/TS, 独立)                               (唯一 Payload          (一个共享 RDS)
weapp + H5                        ├─ 微信登录 / 业务 API                         + admin 后台)
                                  ├─ DeepSeek 代理 + 确定性逻辑                   └─ 集合 sellers/orders/
                                  └─ (可选/非MVP) 应用内 ASR                         dishes…(可来自共享包)
                                                                                       ▲
apps/website (官网前端) ───────────────────────────────────────────────────────────────┘ 也消费同一 cms
```

**各 app 职责：**

| App | 栈 | 职责 |
|---|---|---|
| **`apps/cms`** | Next + Payload | **唯一 Payload 宿主**：数据模型、CRUD/GraphQL/REST API、admin 后台、鉴权、租户 access control、迁移。连**唯一的 RDS**。由方案 C 从 website 抽出（见 §7）。 |
| **`apps/kith-inn-be`** | **Node / TS（独立）** | 业务/领域逻辑：确定性选菜/分组/聚合、订单结构化、DeepSeek 代理、微信登录。经 cms 的 HTTP API 读写。除非 Node 覆盖不了需求才考虑换栈。 |
| **`apps/kith-inn-fe`** | **Taro + React**，UI=**NutUI React** | 老板侧小程序（weapp + H5）。经 HTTPS 调 kith-inn-be。**不复用 `packages/ui`（shadcn 仅 Web、小程序跑不了）**。 |
| **`apps/website`** | Next（前端） | 官网。方案 C 后改为**消费 `apps/cms`**，不再自带 Payload。 |
| `packages/*`（可选） | TS | kith-inn 的 Payload 集合可抽成共享包，被 `apps/cms` 引入（模块化，非必须）。 |

**为什么这么拆**：① 复用同一个 Payload / 同一个 RDS（不另开实例）；② kith-inn 代码与 website 解耦，前端用小程序最佳实践（Taro + NutUI），不被官网 Web 栈拖累；③ CMS 单一事实源，未来加 app 也干净。

## 2. 后端 ↔ Payload

- **Payload 的定位**：它不只是内容 CMS，而是"schema 驱动的数据 + API + admin + 鉴权 + access control"层。我们用它当 **数据 / CRUD / 鉴权 / 后台** 层——这是正当且常见的用法，且租户隔离正是它的强项。
- **边界（重要）**：**业务/领域逻辑放 `kith-inn-be`，不塞进 Payload**。确定性选菜、聚合、AI 编排都在后端。
- **访问方式**：kith-inn-be 经 cms 的 **REST / GraphQL HTTP API** 读写（跨进程，标准做法），**不**为了用 Payload Local API 而与 cms 同进程耦合。
- **不绕过 Payload**：写数据一律走 Payload API（让校验 / hooks / 租户 access control 生效），**禁止 kith-inn-be 直连同一个库写裸 SQL**（否则隔离/校验全失效）。
- **LLM host**：DeepSeek 调用一律走 kith-inn-be（**API key 只在服务端**）。复用现有客户端模式（现位于 `apps/website/src/lib/deepseek`），抽到共享包供后端调用。

## 3. 数据模型与租户隔离

- **集合定义（字段级）见 PRD §7**（主干 spine + 模块表 + 组合机制 + 治理铁律）。本节定**租户隔离的硬机制、索引、迁移注意、派生策略**——这些是经对抗性审查后的实现要求，不是可选项。

### 3.1 租户隔离（multi-tenant，第一天就建对，MVP 单租户也照建；必测 100%）

- **统一 `tenantScoped()` access 工厂**：所有 kith-inn 业务集合**必须经它包裹才注册**，access 默认"空约束/拒绝"而非放行。配集合遍历单测：断言每个带 `seller` 字段的集合 4 个 access 都引用该工厂——把"漏写第 N 张表"从运行期串户降级为 **CI 失败**。
- **写侧 `seller` 服务端钉死**：`beforeChange` hook 对所有租户集合**强制覆写 `seller = 当前 operator.seller`**（忽略请求体）；update/delete access 带 `where:{seller:{equals:tenantId}}`，挡"改不属于我的行"。
- **跨租户 relationship 校验（最隐蔽的越租户读）**：每个指向 spine 的 relationship 加 `filterOptions: ({user}) => ({seller:{equals:user.seller}})` + `beforeChange` 断言"被引用记录的 seller == 当前租户"。否则 A 把 `order.customer` 填成 B 的 id，`depth>0` populate 时直接读穿 B 的顾客地址、绕过 customers 自己的 access。
- **读侧聚合禁裸 SQL/where**：派生聚合经 Payload API 带 tenant 上下文取数后内存分组；若必须下推 SQL，经强制注入 `seller=:tenant` 的统一 query builder（纯函数 100% 覆盖，断言每条 SQL 含 seller 谓词）。把 seller 放索引最左是性能、不是访问控制——漏 seller 的 query 反而高效跑出全租户结果，更危险。
- **登录信任根**：`wx.login → code → kith-inn-be 换 openid → operator → seller`；tenant 解析层断言"token 携带的 seller == openid 链解析出的 seller"，否则 401。kith-inn-be 调 cms **以登录商家身份透传**，**严禁 admin/万能 key 直连**（订阅物化 job 也按租户带 token）。
- **多租户插件**：`@payloadcms/plugin-multi-tenant` **当前未安装**——M0 装它并显式声明 `sellers` 为 tenant 集合；它覆盖不到的（跨租户引用校验、写侧覆写）用上面的工厂/hook 补。

### 3.2 索引（手写 migration；Payload `CompoundIndex` 只支持 `{fields, unique?}`，**无 DESC、无 partial 谓词**）

| 索引 | 服务的查询 |
|---|---|
| `orders (seller, date, paymentStatus)` | 今天订单、谁没付款 |
| `orders (seller, customer, placedAt)` | 张阿姨上次点啥（ASC 索引 + `ORDER BY placedAt DESC LIMIT 1` 走 backward scan，**别写 DESC**） |
| `fulfillments (seller, addrBuilding, status)` | 26B 送了、谁没送、缺口对账 |
| `service_slots (seller, date, occasion)` unique | 唯一约束 + 最近一餐定位 |
| `offerings (seller, mainIngredient, lastUsedAt)` | 菜单主料去重扫描（component 型） |
| `order_items (seller, order)` | "今天订单"的 join 走索引 |
| `subscriptions (seller, status)` [V1] | 这周有哪些预定 |

> partial unique（如 time-slot 的唯一性）Payload config 表达不了，**手写 SQL**，属"库外资产"、drift 检测不认，迁移清单单列。

### 3.3 快照 / 派生 / 归档

- **快照**（`beforeChange` create 时定格）：`order_items.unitPriceCents`(落值时)、`fulfillments.addrBuilding/addrUnit`——归档可回放（"张阿姨上次点啥"靠快照非现状）。
- **派生不落表**（kith-inn-be 确定性纯函数，§4 阶梯0、§6 单测 100%）：送餐分组、采购聚合、"最近一餐"聚焦、未付汇总、`getTodayGaps(seller,date)`("今天还差什么"=跨表逐项查 menu_plan/采购/未付/未送，`slot.status=open` 才进"今天该做"范围)。
- **归档软删**：`service_slots.status=archived` 时，其下 order/item/fulfillment 写操作经 access.update + hook 拦截，要求显式 `force`（对应二次确认）；不真删；保护范围含 menu_plans。

### 3.4 M0 数据层任务（随方案 C 的 cms 迁移一起做）

- 装 `@payloadcms/plugin-multi-tenant`，声明 `sellers` 为 tenant。
- 实现 `tenantScoped()` access 工厂 + 写侧 seller 覆写 hook + 跨租户引用校验 + 集合遍历断言测试。
- **审计 `recipes` 后门**：`apps/website` 的 `recipes` 是 `read:()=>true`、无 seller；搬进 cms 后与 kith-inn 租户表同库 = 隔离边界内的后门。kith-inn **只复用其字段约定（枚举/`active`），不复用集合本身**；`offerings` 是带 seller 的独立新集合。
- seed 桃子一条 `sellers`（enabledModules = menu-planning/delivery/purchasing）+ 菜品池（`offerings` kind=component）。

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
| 送餐分组（工具） | **0 确定性** | MVP | 按楼栋分组 / 排序 |
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

- **【决策】给桃子真机试用的后端域名**：备案提前（先备案 `kith-inn-be` 域名，数周）vs 微信云托管/云开发（免单独备案、最快上真机）。直接决定 MVP 能不能在不备案下让桃子真用（§5）。
- **cms 抽取调研（复杂度 M / 风险中）**：把 website 的 Payload 迁到 `apps/cms` 的具体步骤；风险点——website 已有 **100% 覆盖测试**要一起改不能破、Payload/DB 归属与迁移。
- **更新 DEPLOYMENT.md**：现写"website 承载 Payload + DB"，C 后改为 cms 承载、website 消费。
- 是否需要 MCP server 形态（取决于 §4 的 AI 形态；MVP 多为普通 LLM 调用，未必需要）。
- **ASR 选型（M2）**：微信同传插件 vs 云 ASR vs 自托管（MVP 不做，走系统输入法）。
- **DeepSeek v4 的 function-calling / tool-use 稳定性**（买菜助手 agent 的前提，M2+）。
- 数据模型字段级类型 / 索引（补 §3）。
