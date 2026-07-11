# 研究：kith-inn 订单写入与生命周期原子性

## 决策 1：事务边界放在 CMS

**Decision**: 草稿、确认、取消分别由一次 CMS 请求和一次数据库事务完成；BE 不再用多个 CMS HTTP 请求拼接确认/取消。

**Rationale**: 只有 CMS 持有 Payload/Postgres 连接。跨 HTTP 调用无法共享本地事务，把补偿写在 BE 仍会留下崩溃窗口并形成第二套状态恢复逻辑。

**Alternatives considered**:

- BE 失败后做补偿：拒绝。补偿自身也可能失败，且未知结果不能可靠判断该撤销什么。
- 通用批处理/事务 API：拒绝。会暴露过宽写能力，增加校验面，超出三个明确生命周期动作。
- 分布式事务或消息队列：拒绝。单数据库场景没有必要。

## 决策 2：使用 Payload request 传播事务

**Decision**: 用 Payload 公开的 `createLocalReq`、`initTransaction`、`commitTransaction`、`killTransaction` 建立 request；事务内所有 Local API 调用传同一个 `req`。

**Rationale**: Payload 3.85.1 的 Local API 会复用 `req.transactionID`；内层操作发现已有事务时不会自行提交，由外层统一 commit/rollback。这与 Payload 自己的事务使用模式一致，并同时适配 PostgreSQL 与 SQLite fallback。

**Alternatives considered**:

- 直接使用 Drizzle transaction：拒绝。会绕开 Payload collection hooks、字段转换与关系处理。
- 手写 SQL 完成所有写入：拒绝。同样绕开 Payload 语义并复制 schema 细节。
- 给每次 Local API 单独开事务：拒绝。无法保证整个业务动作原子。

## 决策 3：确认/取消由粗粒度内部端点承载

**Decision**: 新增 `POST /api/internal/orders/:id/confirm` 与 `POST /api/internal/orders/:id/cancel`。确认在事务中校验 seller/order/items、处理 slot、创建 fulfillment、更新 order；取消在事务中更新 fulfillment 与 order。

**Rationale**: 端点名称对应现有 BE API 和领域动作，调用方权限仍由 operator JWT 推导 seller，不引入可任意组合写入的接口。已确认/已取消返回 2xx 等价完成结果，支持网络超时后的安全重试。

**Alternatives considered**:

- 继续调用现有 slot/fulfillment/order 细粒度端点：拒绝。跨请求无法原子。
- 把所有逻辑放进 order collection hook：拒绝。hook 难以返回 slot/fulfillment 契约，并会让普通 PATCH 意外触发生命周期。

## 决策 4：数据库唯一索引兜住并发确认

**Decision**: 增加 `fulfillments (seller_id, order_id)` 唯一索引，不区分状态。

**Rationale**: 当前订单一旦取消不会复活，fulfillment 也随订单终态取消，因此一张订单生命周期内只需要一条记录。唯一索引能在两个确认事务同时越过读取检查时让其中一个回滚，是应用层 find-then-create 之外的最终约束。

**Alternatives considered**:

- 只做应用层“先查再建”：拒绝。并发下有竞态窗口。
- 仅对 pending/done 做 partial unique：拒绝。取消后重建 fulfillment 会掩盖生命周期错误，也没有产品需求。
- 给 fulfillment 增加 idempotency key：拒绝。order id 已是天然幂等键。

## 决策 5：保留现有外部成功语义，细化 CMS 错误码

**Decision**: BE 的 `/orders/:id/confirm`、`/cancel` 成功仍返回 200；草稿创建仍返回 201。CMS 409 body 用稳定错误码区分 `slot-archived`、`empty-order`、`not-draft`，BE 映射到既有 `OrderStateError`。

**Rationale**: FE 和 agent 不需要增加步骤；明确错误码避免把所有 409 都误报成归档餐次。网络/并发冲突若返回未完成错误，调用方可原样重试。

**Alternatives considered**:

- 把所有冲突都返回通用 409：拒绝。无法满足业务拒绝与可重试结果可区分。
- 新增生命周期状态：拒绝。事务已消除对 `confirming/canceling` 中间态的需要。

## Brownfield 事实与范围收口

- `apps/cms/src/app/api/internal/orders/route.ts` 当前先建 order、再循环建 order_items，无共享事务。
- `apps/kith-inn-be/src/domain/orders/service.ts` 当前确认依次调用 slot upsert、fulfillment create、order update；取消依次改 fulfillment、order。
- `apps/cms/src/db/ensureConstraints.ts` 通过 `onInit` 补建 drizzle push 无法表达的索引；适合继续承载新的 fulfillment 唯一索引。
- `docs/kith-inn` 描述了 active 业务坐标“更新现单”，当前创建 route 实际依赖唯一索引拒绝重复。#154 不改变该行为，只确保失败不会留下占位半成品。
- 当前未正式部署，既有异常开发数据修复不在范围内。
