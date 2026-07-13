# 研究：kith-inn 缺地址确认守卫

## Brownfield 事实

- `createDraftAtomic` 与 `reconcileOrdersAtomic` 会把 `customers.address` 快照到 `orders.address`，顾客地址为空时仍允许创建 draft，符合“先记单后补地址”。
- `confirmOrderAtomic` 已用 PostgreSQL 事务和 `lockOrderReconciliationWrites` 串行化确认/对账，事务内依次打开餐次、创建 fulfillment、写 confirmed，但未检查 `order.address`。
- CMS 通用 `PATCH /api/internal/orders/:id` 只改一张订单；customers 没有可与订单更新合并的写端点，因此前端连续两次写无法满足原子补全。
- BE 的订单 service/route 和 Agent 口头确认最终都调用同一个 CMS confirm 端点；稳定 `OrderLifecycleError`/`OrderStateError` 已能传递 `409` 生命周期错误。
- `record_orders` preview 已加载完整 customer 和 active order，但 shared 差异行没有地址状态；确认卡只给 `newCustomer` 显示可选地址输入。
- 订单页会显示 `order.address`，缺失时只是省略地址并仍显示“确认订单”；所有非 2xx 写入都只提示“操作失败”。
- `orders.address` 已存在且可空，无需 schema/migration；其注释称“不可改”，需要收窄为“创建后冻结，缺失草稿可显式补齐一次”。

## 决策 1：确认守卫只在 CMS 原子入口判定

**Decision**: `confirmOrderAtomic` 在任何 slot/fulfillment/status 写入前，以 `!order.address?.trim()` 判定缺地址并抛出 `409 missing-address`；BE route 和 Agent 只把该错误翻译为“请先补地址再确认订单”。

**Rationale**: 点击、口头和未来入口最终都经过 CMS，单点守卫不会因界面遗漏而绕过；检查位于现有事务内，可证明拒绝时经营数据零变化。

**Alternatives considered**: 只禁用 FE 按钮会被聊天或直接 API 绕过；BE 先 GET 再确认存在竞态；数据库把 `orders.address` 改成 required 会破坏允许缺地址 draft 的需求。

## 决策 2：用专用原子端点完成一次性补地址

**Decision**: 新增 seller-scoped `PATCH /orders/:id/address`（BE 与 CMS 各一层），body 仅 `{address}`。CMS 在现有写锁和同一事务内校验非空、目标订单属于 seller 且为 draft，然后同时更新目标 `orders.address` 与关联 `customers.address`。

**Rationale**: 两个字段表达不同时间语义但必须一次成功；专用端点比扩张通用 PATCH 更小，也不会让客户端任意改 customer 或已冻结快照。

**Alternatives considered**: 连续 PATCH customer/order 会部分成功；把补地址塞进 confirm 会违反“补全后再独立确认”；新增 address service/表没有额外价值。

## 决策 3：地址快照只允许从缺失变为非空

**Decision**: 补全仅用于 draft 且当前快照为空。成功后同地址重试返回既有结果并标记 `alreadyCompleted`；不同地址再次调用返回 `409 address-present`。顾客已有默认地址也不在 confirm 时静默回填，必须显式提交目标订单的地址。

**Rationale**: 既保持历史订单快照语义，也让响应丢失后的直接重试安全。显式值可同时纠正顾客默认地址；同一顾客其他订单不参与写入。

**Alternatives considered**: 允许任意改非空快照会悄悄改写履约事实；自动复制 customer 默认值无法证明桃子确认了旧草稿地址；追溯更新全部订单违反快照语义。

## 决策 4：补地址与确认复用现有写锁串行化

**Decision**: `completeOrderAddressAtomic` 与 confirm/reconcile 共用 `lockOrderReconciliationWrites`，不新增 version 字段或另一套锁。

**Rationale**: 并发时只有两种合法结果：确认先读到空值而失败，随后补全；或补全先提交，随后确认成功。不存在 confirmed+空地址中间态。

**Alternatives considered**: 乐观版本字段需要 migration 且现有全局事务锁已覆盖本写域；进程内 mutex 不能保护多实例 CMS。

## 决策 5：确认卡用展示字段，订单页用现有行内操作

**Decision**: reconciliation row 增加向后兼容的 `addressMissing?: boolean`。三类候选互斥判定：已有 active order 时只看该订单快照，不回退 customer 默认地址；将新建既有顾客订单时看 customer 默认地址；新客看确认卡输入。FE 显示“待补地址”。订单页在缺地址 draft 行内显示一个 Input 和“保存地址”，成功刷新后再使用既有“确认订单”。

**Rationale**: row 字段只服务预览，不进入 CMS reconcile 写请求；订单页无需新页面、弹窗或全局 store，满足一次进入、一次保存。

**Alternatives considered**: 把地址状态塞进 candidate 会把展示信息带入写契约；只标新客会漏掉无默认地址的既有顾客和旧空快照；新建地址管理页增加无关导航和状态。

## 决策 6：六个小 PR，规划独立 review

**Decision**: 规划、确认守卫、CMS 原子补全、BE 契约适配、订单页补全、确认卡状态分别成 PR；先完成 P1 的订单页补全闭环，再做 P2 确认卡提前提示；每片都在合并前完成 Codex review，#156 在 PR5 合并后关闭。

**Rationale**: 守卫、CMS 事务、BE 适配与两个 UI 入口有不同正确性边界；CMS 事务和 BE 适配合并后预计会超过 400 行，因此按现有内部 API 边界再拆一片，让每次运行时 diff 保持在默认 review 预算内，并让安全守卫最先上线。

## 未采用的新能力

- 不新增地址结构化、地址历史、地址选择器、通用 customer 编辑或历史 confirmed 数据修复。
- 不自动确认补全后的订单，不增加自取模式，不修改任何 kith-inn-v1 路径。
