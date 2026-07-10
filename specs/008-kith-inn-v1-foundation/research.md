# 技术研究：kith-inn-v1 共享 CMS 骨架与数据层

## 决策 1：v1 复用现有 `apps/cms` Payload 实例

**Decision**: v1 collections 装配进现有 `apps/cms`，与旧 kith-inn 共用 Payload config、端口 3304、PostgreSQL 连接和 `cms` schema；隔离依靠 `kiv1_` collection/table 前缀。

**Rationale**:

- 用户明确说明 ECS 较小，无法长期运行多套 Payload/Next 进程。
- `apps/cms` 本来就是为 kith-inn 和后续小项目准备的共享 host；按它的原始职责扩展比新建服务更直接。
- v1 的 collection、schema、hook、seed 仍在自己的 package，host 只聚合数组和 seed，业务代码不会混入旧 package。

**Alternatives considered**:

- **独立 Payload app + 独立 PG schema**: 隔离最完整，但增加一套常驻 Next/Payload 进程，违反 ECS 资源约束。
- **在同一 Payload config 中把不同 collection 放到不同 PG schema**: Payload Postgres adapter 的 `schemaName` 作用于整个 config，标准配置不支持按 collection 路由 schema。
- **复用旧 kith-inn collection**: 进程更少但数据模型和业务演进互相污染，违反 v1 独立代码/数据要求。

## 决策 2：使用前缀而不是跨项目 relationship

**Decision**: v1 每个 collection slug 使用 `kiv1_`；v1 关系只能指向 `kiv1_` collection，不关联旧 sellers/operators/customers。

**Rationale**:

- 同 schema 下，slug 同时决定 REST 路径和主要表名，是最便宜、最可测试的碰撞边界。
- 不跨项目关系，旧模型改名或删除不会破坏 v1 数据完整性。
- Admin group 统一用“街坊味 v1 / ...”，解决共享 Admin 导航辨识问题。

**Alternatives considered**:

- **仅靠 Admin group 区分**: UI 可区分，但数据库/API slug 仍可能碰撞。
- **复用旧 seller/operator 作为共享身份**: 少两张表，却让 v1 权限和生命周期依赖旧项目。

## 决策 3：共享 Admin 身份与 v1 产品身份分离

**Decision**: `apps/cms.admin.user` 保持旧 `operators`；`kiv1_operators` 是普通 collection，不设为 Admin user。共享 CMS 已认证用户是可信运维身份；未来 v1 商家/顾客 API 使用 v1 自有 JWT 和 internal routes。

**Rationale**:

- 一个 Payload Admin 只能配置一个 user collection；切换到 v1 operator 会破坏旧 Admin 登录。
- Payload Admin 是内部运维面，不是顾客或商家小程序 API；允许它检查多个项目数据不等于产品权限共享。
- v1 internal routes 可以像旧项目一样在验 JWT 后用 local API，但必须使用独立 header、secret、route 前缀和 seller/openid 校验。

**Alternatives considered**:

- **把 `kiv1_operators` 设为第二个 Admin user**: 同一 Admin config 不支持两个 user collection。
- **按 openid 把旧 operator 映射到 v1 operator**: 能做 seller-scoped Admin，但每次访问需要异步映射并造成跨项目身份耦合，当前只有可信运维用户，收益不足。
- **新增全局 CMS admin collection 并迁移旧 Admin**: 长期更整洁，但会改旧认证和 access，超出 M0。

## 决策 4：核心模型收敛为七个 collection

**Decision**: 只建立 sellers、operators、customer profiles、offerings、meal slots、booking batches、orders。

**Rationale**:

- 一份菜单天然属于一个日期 + 餐次，放在 meal slot 可消除 `menu_plan ↔ meal_slot` 一对一同步。
- MVP 一个订单只有套餐份数和一次送达，把付款与送达状态直接放在 order 可删除 `order_items`、`fulfillments`。
- booking batch 直接 has-many meal slots，Payload 自己维护关系，不需要业务连接 collection。
- 这些合并不删任何已确认 user story，只删中间记录和同步 hook。

**Alternatives considered**:

- **保留 11 个 collection**: 与旧项目形状接近，但共享 host 会额外承担四组表、关系和一致性逻辑。
- **全部塞进 orders JSON**: 文件更少，但会失去餐次唯一性和关系完整性。

## 决策 5：顾客资料允许暂不绑定 openid

**Decision**: `customer_profiles.openid` 可空；顾客自己创建时由会话写入，桃子手动创建时可空。未绑定资料和订单默认只在商家侧可见。

**Rationale**:

- 私聊顾客可能从未进入小程序，系统不可能拥有其 openid。
- 仅凭相同称呼或地址自动认领会泄露个人信息。
- 订单保存 `customerOpenid` 快照，资料未来绑定不会自动暴露历史手工订单。

**Alternatives considered**:

- **profile 强制 openid**: 无法承载私聊补单。
- **拆 customer 与 address 两张表**: 超出“称呼 + 地址一体”的确认规则。

## 决策 6：业务日期存日历日字符串

**Decision**: meal slot 的 `date` 使用经 schema 校验的 `YYYY-MM-DD` 文本；deadline、paidAt、deliveredAt 等时刻使用 ISO datetime。

**Rationale**:

- 午餐/晚餐属于上海日历日，不是 UTC 瞬间。
- 文本键适合 `(seller, date, occasion)` 唯一约束，不会因时区序列化偏移一天。

**Alternatives considered**:

- **Payload datetime 存午夜**: 每个边界都要约定 UTC/上海转换。
- **整数 epoch day**: 可行但不利于 Admin 检查和人工排障。

## 决策 7：使用普通复合唯一约束

**Decision**:

- meal slot unique `(seller, date, occasion)`。
- offering unique `(seller, name)`。
- 有 profile 的 order unique `(seller, mealSlot, customerProfile)`；null profile 留给后续接龙兜底。
- canceled 后再次登记复用同一记录并显式回到 draft。

**Rationale**:

- 全部常规坐标字段必填，不需要 partial predicate 或 `onInit` SQL。
- 数据库 unique 消除并发竞态；复用记录符合“重复提交更新而非新增”。

**Alternatives considered**:

- **只靠 beforeChange 查询防重**: 并发下有竞态。
- **active-status partial unique**: 能保留多条 canceled 历史，但需额外 SQL 和选择逻辑，当前无审计需求。

## 决策 8：沿用共享 schema push 生命周期

**Decision**: M0 沿用 `apps/cms` 当前 push 模式，v1 表落在 `cms` schema；首批需保留的真实数据进入前，由整个 shared CMS 建立 migration baseline。

**Rationale**:

- 同一 Payload config 必须统一选择 push 或 migrations，不能给 v1 单独设生命周期。
- 当前旧 CMS 和 v1 都尚未形成需要保留的生产迁移链。
- 同 schema 集成测试能证明旧表与 `kiv1_` 表共存且不泄漏到 `website`。

**Alternatives considered**:

- **只为 v1 维护 migration**: 同一个 adapter/config 下无法独立执行一个项目的迁移链。
- **永远使用 push**: 有真实数据后风险不可接受，必须设置转 migration 的止损点。
