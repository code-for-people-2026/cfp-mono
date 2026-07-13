# 研究：kith-inn 配送地址选填与自动带出

## Brownfield 事实

- `ChatCard` 只为 `newCustomer` 显示地址输入，输入没有 required 约束；提交空白时，BE route 会 trim 为 `undefined` 并继续 reconciliation。
- `reconcileOrdersAtomic` 创建新顾客时可保存可选地址，同批次为该顾客创建的订单都复制该值。
- `reconcileOrdersAtomic` 为既有顾客创建新订单时，从当前 `customers.address` 复制到 `orders.address`；接龙候选不需要重复携带地址。
- `createDraftAtomic` 同样在订单创建时复制顾客地址，顾客无地址时仍可创建 draft。
- `confirmOrderAtomic` 没有地址前置条件；缺地址 draft 可正常打开餐次、创建 fulfillment 并转为 confirmed。
- 送餐派生逻辑把空地址归入“（无地址）”，不会过滤订单或 fulfillment。
- BE 通用 `PATCH /orders/:id` 运行时只删除 `status`，CMS 通用 PATCH 又把 body 原样传给 Payload，因此客户端仍可用 `{address: ...}` 改写订单快照。
- Agent system prompt 仍要求新顾客“填好地址”再确认，会把选填字段说成事实上的必填项。
- `customers.address` 和 `orders.address` 都已经是可空自由文本，无需 schema、migration 或新 collection。
- 当前真实行为缺少两条集中回归证据：缺地址 draft 的完整确认，以及首次保存地址后下一次独立下单自动带出。

## 决策 1：地址是选填便利信息，不是确认前置条件

**Decision**: 新顾客、既有顾客和订单都允许没有地址；确认生命周期不新增 `missing-address` 或等价守卫。

**Rationale**: 接龙不会每次包含地址，桃子在系统外也记得住址。强制补录只会增加重复劳动，与真实操作相反。

**Alternatives considered**: 缺地址只允许 draft、确认前补地址、只在 FE 禁用确认；三者都会错误阻断合法订单。

## 决策 2：默认地址只在新订单创建时复制

**Decision**: 桃子选填地址时保存为顾客默认地址；之后匹配到同一顾客的新订单在创建时复制它为 `orders.address`，输入无需重复提供。

**Rationale**: 一次记录即可服务未来订单，同时保持每张订单对当次送餐信息的独立快照。

**Alternatives considered**: 每次接龙要求地址不符合输入事实；展示时动态读取 customer 会让历史订单随资料变化。

## 决策 3：空地址与历史快照都保持显式语义

**Decision**: `null`、空字符串和纯空白统一视为未填写；无地址 fulfillment 进入“（无地址）”分组。顾客默认地址变化只影响之后创建的订单，不追溯更新旧快照。

**Rationale**: 无地址不是坏数据，只表示系统没有记录；快照不追溯才能还原当次订单。

**Alternatives considered**: 过滤无地址任务会漏单；追溯回填会改写历史。

## 决策 4：只修两个现有边界缺口

**Decision**: BE 与 CMS 的通用订单 PATCH 都改为普通字段白名单，禁止 address/status/customer/seller/未知字段；Agent prompt 明确地址选填。删除原方案中的确认守卫、补地址 API、待补状态和地址补全 UI，其余运行时保持不变，并新增最小真实 PG 回归测试与长期文档。

**Rationale**: 快照旁路会真实破坏历史不变量，prompt 会直接误导用户，必须修；两处都可在现有边界内用极小改动完成。其余生产改动没有用户价值。

## 未采用的新能力

- 不新增地址结构化、地址历史、地址选择器、强制补录或专用 order-address endpoint。
- 不自动猜测地址，不从其他顾客复制，不追溯修改既有订单。
- 不修改任何 kith-inn-v1 路径。
