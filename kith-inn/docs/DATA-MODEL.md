# 数据建模参考：街坊味（kith-inn）

> 本文是数据建模的**概念性参考资料**，便于通读理解每张表、每个字段的业务意义与相互关系。
> **字段级、索引级、状态机的权威定义以 [`PRD.md`](./PRD.md) §7 与 [`TECH-SPEC.md`](./TECH-SPEC.md) §3 为准**。
> **本文反映最新设计**（含在审 PR [#57](https://github.com/code-for-people-2026/cfp-mono/pull/57)/[#66](https://github.com/code-for-people-2026/cfp-mono/pull/66) 的修订，如 `order_items.timeWindow?`、self/onsite 不建 fulfillment、`orders.idempotencyKey` 取值规则、时区基准 Asia/Shanghai 等）。本分支基于 main、其 PRD 暂为较早版本——这些字段在 #57/#66 合并后即与本文一致；**以合并后的 PRD/Tech Spec 为最终权威**，实现以它们为准、勿据本文单独建字段。
> 面向读者：刚接手 kith-inn、想快速建立数据模型心智模型的人。

---

## 0. 一句话与设计哲学

为社区做饭生产者（首位用户桃子）做"老板侧经营大脑"。数据模型围绕一条主线：**承诺（订单/订阅）是事实，经营状态由它物化派生**。

三条贯穿性原则：

1. **承诺即事实、状态皆派生**：落表的是事实（订单、履约）和定格快照（价、地址）；送餐分组、采购聚合、缺口对账、"最近一餐"都是 be 的确定性纯函数，不落表。
2. **draft 零副作用、确认才物化**：贴接龙先落 `draft`（纯记录、不碰任何经营表）；「确认订单」才 `confirmed`（开 slot + 建 fulfillments + 快照价）；「取消」置 `canceled` 终态。
3. **多商家 schema、单商家 UX**：每张业务表都带 `seller`（租户键），MVP 单租户也照建；UI 只打磨桃子一个人。

---

## 1. 总览与关系图

```
sellers（租户根 / 一个商家 = 一个桃子）
 ├─ operators              谁能登录（桃子 / 预留帮手）
 ├─ customers ──< customer_addresses (1:N)        顾客 + 学来的地址
 ├─ offerings             菜/SKU/套餐/课时 的共享枢纽（自关联：combo→components）
 ├─ service_slots         时间桶：哪天 · 哪餐/时段（确认订单时开餐）
 │    └─ menu_plans       绑在某 slot 上的"这餐做什么菜"
 ├─ orders ──< order_items >── offerings           一次下单意图 → 明细行 → 菜
 │       │      └ (order.date, mealOccasion|timeWindow) 逻辑命中 service_slots（无 FK）
 │       └─ < fulfillments                         每个需配送/自取的 item 一条履约
 ├─ subscriptions (V1)    订阅 = 订单生成器，定时物化成 orders
 └─ chat_messages         主对话留存（2 天窗口 + 1000 上限）
```

**关键关系**：所有业务表带 `seller`；`order_items` 经 `(order.date, mealOccasion|timeWindow)` 逻辑命中 `service_slots`（不另设 FK）；`offerings.parentOfferings` 自关联（combo→components）；`fulfillments` 挂 `orderItem` 并反范式 `serviceDate/occasion/addrBuilding` 免回连。

---

## 2. 平台级（2 表）

### `sellers` — 商家 / 租户根
一个商家 = 一个"灶台"。M0 手动 seed 桃子一条。

| 字段 | 业务意义 |
|---|---|
| `name` | 商家名（桃子的健康早午餐） |
| `serviceArea` | 服务区域（哪些小区/楼栋） |
| `defaultPriceCents` | 兜底单价（桃子=3000=30 元/份）；定价解析链的最后一环 |
| `status` | active / paused / archived——软停用，不物理删 |
| `enabledModules` | **组合事实源**：勾选 menu-planning / delivery / purchasing / booking → 驱动 access 放行、tab 可见、agent 工具注册。这是"多商家 schema、单商家 UX"的开关 |
| `moduleSettings` | json，按模块命名空间存配置（如 `delivery.deliverers=["奶奶"]`、出餐结构 4 菜 1 汤）。"是数据不是 schema"——灵活适配异质生产者 |
| `profileFreeText` | 自由文本画像（§6.0 经营画像的近亲，非 MVP） |

> 经营画像 = `enabledModules` + `moduleSettings` + `profileFreeText` 的组合。

### `operators`(auth) — 登录主体
| 字段 | 业务意义 |
|---|---|
| `seller` | 归属哪个商家（租户键） |
| `wechatOpenid` | 微信登录唯一键；`wx.login → code → openid → operator → seller` 是登录信任根 |
| `role` | owner / helper——预留"帮手"角色（奶奶未来可能用手机） |
| `active` | 软停用 |

---

## 3. 核心实体 — spine（7 表）

### `customers` — 顾客（轻量、自动沉淀）
不做重型 CRM。绝大多数字段记单时自动沉淀。

| 字段 | 业务意义 |
|---|---|
| `displayName` | **识别键（不唯一）**——接龙里的称呼（王燕萍 / 小柠檬 / 李叔）。重名/昵称变体 MVP 靠解析时名字归一 + 人工合并 |
| `kind` | regular(固定客) / walk-in(散客) / **self(自家)**。self=桃子自家，onsite、不建 fulfillment，但份数/采购照算 |
| `defaultAddress` | → `customer_addresses` 单值外键，默认送餐地址 |
| `defaultServings?` | 默认份数（常点 2 份就记下） |
| `defaultOccasion?` | 默认餐次（常订晚餐的顾客） |
| `note?` | 备注（轻量，不做忌口引擎） |

不存电话——以接龙名字 + 默认地址为主键，脱敏。

### `customer_addresses` — 地址（1:N，学来的）
| 字段 | 业务意义 |
|---|---|
| `customer` | → customers |
| `building` | **楼栋——送餐分组键的来源**（26B / 3A）。整个分拣/送餐视图按它成批 |
| `unit` | 房号 |
| `lastUsedAt?` | 最近使用时间——"默认/最近地址"带出靠它排序 |

接龙里没地址；首次私信拿到录一次，之后自动带出（贴合"第二天同一个人下单，地址我早知道了"）。

### `offerings` — 菜 / SKU / 套餐 / 课时的**共享枢纽** ⭐
全模型最关键的表：**菜单 ↔ 订单 ↔ 采购都经过它**。用 `kind` 区分四类生意的东西，不单建 dish 表。

| 字段 | 业务意义 |
|---|---|
| `name` | 菜名 / 品类名 |
| `kind` | **combo-meal**(套餐：桃子的"4 菜 1 汤"是一份套餐) / **single-item**(单品：奶茶逐杯、烘焙周更 SKU) / **service-session**(课时：家教) / **component**(套餐的内容物：一道菜) |
| `parentOfferings?` | 自关联——**combo → 它含的 components**。采购聚合时 combo 走这一跳拿内容物（建议 hook 校验 combo 只能指向 component） |
| `unitLabel` | 单位标签（份 / 杯 / 课时） |
| `priceCents?` | 菜品定价 |
| `category?` | 荤 / 素 / 汤 / 主食 |
| `mainIngredient?`(index) | **主料（牛肉/鸡/鱼…）——菜单去重的真实约束**。"肉就那几样"，去重在主料层做而非菜名层 |
| `tags?` | 清淡 / 费工……（费工菜每日不超阈，避免一天全是麻烦菜） |
| `lastUsedAt?` / `useCount?` | 上次使用 / 频次——选菜加权（常做优先、冷门翻新）+ N 天不重复 |
| `recipe?`(json) | **采购聚合的输入**：`{ ingredients:[{name, qtyPerServing, unit}], yieldServings? }`，单位用买菜口径（斤/把/块）。只在 single-item / component 填；combo 不填（用量=内容物之和） |
| `active` | 上下架（烘焙周更靠它） |

> 一道菜 = `kind:component`；桃子的套餐 = `kind:combo-meal` + `parentOfferings` 指向若干 component。菜单生成只从池内选、绝不发明新菜。

### `service_slots` — 时间桶（哪天 · 哪餐/时段）⭐
**双职责**：通用时间桶（所有生意都有）+ 餐次/菜单锚（仅餐类）。"确认订单"时才把它开成 `open`。

| 字段 | 业务意义 |
|---|---|
| `date` | 用餐 / 服务日 |
| `granularity` | **occasion**(按餐次：桃子午/晚) / **time-slot**(按时段：烘焙取货、家教课时) |
| `occasion?` | 枚举 breakfast/brunch/lunch/dinner/**all-day**；granularity=occasion 时必填，time-slot 时留空。**all-day 是连续生意（奶茶）的退化**——"每天一个桶" |
| `startAt/endAt?` | time-slot 粒度的具体时段 |
| `status` | **draft**(预占) / **open**(确认即开餐) / **archived**(软删/归档)。archived 不自动重开、需 force |
| `capacity?` | slot 接单上限——MVP 不建（无公众下单通道），V1 booking 才用 |

> slot 不预设"是餐"——餐次语义（午/晚、绑 menu_plan）由 menu-planning 模块叠加。连续生意（奶茶=随时来单）= occasion=all-day 退化为"每天一个桶"，不存在"无 slot"。

### `orders` — 一次下单意图（一个人 · 这一天）
**日级**粒度——不存餐次/份数/价格/配送（那些在 item 和 fulfillment）。一个 order = 一个顾客一天的下单意图，跨午晚靠多个 item 表达。

| 字段 | 业务意义 |
|---|---|
| `customer` | → customers |
| `date` | **用餐日**（≠录入时间） |
| `status` | **draft / confirmed / canceled——记单生命周期**。draft=纯记录零副作用；确认才物化经营状态；取消作废履约 |
| `source` | 审计枚举 chat-paste / chat-voice / manual / subscription / import（不控流，只标记从哪来） |
| `placedAt` | 录入时间（≠用餐日） |
| `note?` | 整单备注 |
| `totalCents` | 只读派生 = Σ(item.quantity × 解析单价)，经 hook 回写；canceled 单不计入 |
| `paymentStatus` | **unpaid / paid / reconciled——收款轴**（≠记单轴）。reconciled=她已核对入账 |
| `paymentMethod?` / `paidAt?` | 收款方式 / 时间（MVP 纯手动标） |
| `idempotencyKey?` | **幂等键**——粘贴/语音按 (seller,customer,date,source) 或接龙哈希取，撞键返回现存 draft；挡重复粘贴 + 订阅物化 job 幂等 |
| `createdBy?` | → operators（审计） |

### `order_items` — 订单明细行（餐次粒度）
跨午晚 = 同一 order 多个 item（桃子常 2 个：午餐 + 晚餐）。

| 字段 | 业务意义 |
|---|---|
| `order` | → orders |
| `offering` | → offerings（指向套餐 combo 或单品） |
| `mealOccasion?` | lunch / dinner / all-day……occasion 粒度商家**确认前必填**（all-day 填 all-day、不可空） |
| `timeWindow?` | time-slot 粒度商家才填（快照自 slot 的 startAt/endAt） |
| `quantity` | 份数 |
| `unitPriceCents?` | 空=派生默认价；确认时快照定格，历史价不随改价漂移 |
| `note?` | 这一项的备注 |

> **slot 归属是逻辑命中、不另设 FK**：occasion 粒度按 `(order.date, mealOccasion)`、time-slot 按 `(order.date, timeWindow)` 命中 service_slots 唯一键。

### `fulfillments` — 履约薄表（配送/自取专用）
**只为 delivery/pickup 的 item 建**；self/onsite 不建（份数/采购靠 order_items）——免 onsite 履约污染缺口对账。

| 字段 | 业务意义 |
|---|---|
| `orderItem` | → order_items（挂餐次粒度） |
| `serviceDate`(index) | 反范式用餐日——送餐视图按它成批，免回连 |
| `occasion?`(反范式) | 反范式餐次 |
| `mode` | **delivery / pickup**（onsite 不建 fulfillment） |
| `status` | **pending → handed-off → done**；订单取消置 **canceled**（终态，退出送餐口径）。桃子自送则 pending→done 直达；交给奶奶则经 handed-off |
| `addrBuilding`(index) | 地址定格快照——送餐视图按 (serviceDate,occasion,addrBuilding) 整栋成批 |
| `addrUnit` | 房号快照 |
| `assignee?` | 受控值（"奶奶"）——hook 校验 ∈ `moduleSettings.delivery.deliverers` |
| `timeWindow?` | time-slot 履约的时段 |

> 地址是**定格快照**（归档可回放），但 serviceDate/occasion/timeWindow **随 order 实时同步**（改餐次/改日经 hook 回写，非冻结）。缺口对账 = 数 `status ∈ {pending, handed-off}`（已取消不算、onsite 无行天然不算）。

---

## 4. 模块表（按 `enabledModules` 组合）

### `menu_plans`（menu-planning 模块）— 绑在 slot 上的菜单
| 字段 | 业务意义 |
|---|---|
| `slot` | → service_slots（这餐的菜单） |
| `offerings[]` | → offerings（选了哪几道菜；内容物经 parentOfferings） |
| `publishText?` | 发布文案 |
| `status` | draft / published（published ≠ 已发微信群——那是线下动作） |

> MVP 唯一的模块表。不持有 dishes（内容物在 offerings.parentOfferings）。

### `subscriptions`（booking 模块，V1）— 订单生成器
| 字段 | 业务意义 |
|---|---|
| `customer` / `offering` | 谁订、订什么 |
| `pattern`(json，必填) | **source of truth**——本订阅在哪些 `(date, occasion)` 或 `(date, timeWindow)` 上生成 order（随 granularity 取）。三类 shape：`specific-dates`(锁一串日期，最贴"预付某几天") / `recurring`(RRule 式如每周一三五，"一周一订"是其特例) / `open-ended`(长期默认) |
| `status` | active / paused |
| `pausedRanges?` | 暂停区间（出差那周跳过） |

> 订阅是定时 job、按租户物化、带 seller token。已弃 `cadence`(weekly/monthly) 死枚举——真实是任意命中坐标集合。

### `delivery` / `purchasing` — **无自有表**
- **delivery** 是 `fulfillments` 上的行为（assignee / status / addrBuilding）+ 派生视图（分拣、缺口对账）+ tab/工具。
- **purchasing**（M2）是 `订单 × offerings.recipe` 的确定性聚合，输出采购清单/用量。

两者都是"主干之上的派生行为，零自有表"。

---

## 5. 基础设施

### `chat_messages` — 主对话留存
按 `(seller, operator, createdAt)` 隔离 + 分页。**滚动 2 天窗口 + 1000 条硬上限（超出删最旧 200）**，0 点以桃子所在时区（Asia/Shanghai）为准。与业务订单（永久）解耦——是"展示的对话"载体，不是业务记忆（业务记忆在 orders/offerings，永久）。

---

## 6. 贯穿性机制（为什么这样设计能成立）

1. **租户隔离**（Tech Spec §3.1）：`tenantScoped()` access 工厂包所有业务表 + 写侧 `seller` 服务端钉死 + 跨租户引用校验（挡 depth>0 越权读）+ 聚合禁裸 SQL。
2. **记单状态机**（Tech Spec §3.3）：draft 零副作用 → 确认才物化（开 slot + 建 fulfillment + 快照价）→ 取消终态。错解析/没确认的草稿不污染"今天该做"。
3. **派生不落表**：送餐分组、采购聚合、缺口对账、"最近一餐"、未付汇总——全是 be 确定性纯函数（可单测 100%）。
4. **时区基准 Asia/Shanghai**：所有"今天/0点/留存裁剪/order.date"按此时区算。
5. **可组合**（PRD §7.3/§7.5）：`enabledModules` 驱动一切；模块表外键只指 spine；新增模块零改主干（唯一软扩展=枚举加值）。

---

## 7. 四种生意怎么落到同一套模型（PRD §7.4）

| | 桃子私房菜 | 奶茶宝妈 | 烘焙 | 家教(非食品) |
|---|---|---|---|---|
| enabledModules | menu-planning, delivery, purchasing | delivery / 仅 spine 自取 | menu-planning, booking, purchasing | booking |
| Offering | 1 combo-meal + N component | N single-item(逐杯 SKU) | N single-item(周更上下架) | 1 service-session |
| Order 记法 | 1 order/客/日，2 item(午/晚) | 1 order，多 item 逐杯 | 1 order，多 item | 1 order，1 item(qty=课时) |
| slot.granularity | occasion(午/晚) | occasion(all-day) | time-slot(取货) | time-slot |
| Fulfillment | delivery，按楼栋，奶奶分片 | delivery/pickup | pickup | onsite(可省) |

dish 收进 offerings 后，四类生意的 menu→order→采购全经 `offerings` + `service_slots` 两个枢纽；非食品（家教）靠 granularity=time-slot + booking 复用同一主干。
