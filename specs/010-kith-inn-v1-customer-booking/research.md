# Research：街坊味 v1 顾客预订登记

## 1. M2 交付与 PR 切分

**Decision**: 一个全套规格继续覆盖 M2。M2-A/B 与 C1 strict contract、C2 profile persistence、C3 order persistence、C4 BE domain/clients、C5 BE HTTP 已合并。C6 前先以 C5R 原子纠偏 shared reservation contract、BE domain 和既有 HTTP route，再按 C6 FE/E2E、D1 strict contract、D2 persistence、D3 BE、D4 FE/E2E 顺序实施。后一个只在前一个 rebase merge 后从最新 `main` 开始。

**Rationale**: 旧计划低估了测试与信任边界成本：PR #152 实际 `+2136/-19`，PR #153 实际 `+1861/-42`。宪法 1.2.0 与 `AGENTS.md` 现要求默认人工 diff `<400` 行，因此继续用跨 shared/CMS/BE/FE 的 C/D 纵向片会重复产生千行级 review。C5R 虽同步三个已存在层，但只切换一个 live endpoint 的坐标不变量；拆开会让 `main` 类型不一致或留下不可执行的半契约，且不改 CMS/FE。其余每片继续锁定一个可独立验证的契约、安全或状态不变量。

**Alternatives considered**:

- 一个 M2 PR：review 面过大，拒绝。
- 继续按原 C/D 纵向切片：有用户价值但已由 #152/#153 证明不可审查，拒绝。
- 每个文件或每个 endpoint 单独拆：会割裂同一 owner/状态不变量，拒绝；按可独立验证的边界拆。
- 把 customer auth 单独做基础设施 PR：无可见入口，拒绝；与只读分享页合并。
- 堆叠 PR：仓库 review/rebase 机制收益有限，拒绝。

## 2. 现有数据模型是否足够

**Decision**: M2 不修改七个 collection 或索引。直接使用 booking batch、meal slot booking fields、profile openid/active 和 order customerOpenid/source/snapshots/status。

**Rationale**: M0 已按最终 M2 流程设计字段；没有新的持久化业务事实。customer session、share path、批次可写状态和提交结果均可派生或短期签名，不应落表。

**Alternatives considered**:

- session collection：无服务端 session 需求，增加清理/过期状态，拒绝。
- batch-slot 连接 collection：existing hasMany 足够，拒绝。
- order item/fulfillment：当前只有套餐份数和单次送达，拒绝。
- M2 单独 migration：共享 CMS migration baseline 由 M4 统一建立，拒绝。

## 3. Customer JWT 与身份隔离

**Decision**: 扩展现有 Web Crypto helper，新增 `kind=customer` claims：`sellerId`、`openid`、`role=customer`、`iat`、`exp`。不包含 operatorId 或 batch id；默认有效期与 operator session 同为 7 天。operator/customer token verifier 必须检查 kind。

**Rationale**: batch 只用于解析 seller 和每次订单写的来源门禁；顾客“我的预订”属于 seller+openid，不能绑定单一 batch。明确 kind 可防 token 跨入口复用，且无需服务端 session store。

**Alternatives considered**:

- 把 batchId 写进 customer JWT：会阻止从另一张同 seller 卡片继续查看历史，并产生 token 频繁替换，拒绝。
- 复用 operator claims：权限混淆，拒绝。
- 匿名 cookie/session：weapp/H5 行为不一致，且不能稳定表达微信身份，拒绝。

## 4. Customer 登录 bootstrap 与 dev login

**Decision**: weapp 把 `wx.login` code 与 batch publicId 交给 BE；BE 先用独立 service-auth CMS lookup 验证 batch 存在并解析 active seller，再且仅再调用一次 code2Session 得到 openid，最后签 customer JWT。closed/archived batch 可签发，invalid publicId 不消费一次性 code、也不签发 token。H5 e2e 提供 customer dev login，但必须同时满足非 production 与既有 `KITH_INN_V1_ALLOW_DEV_LOGIN=1`；weapp 失败不得 fallback。

**Rationale**: 登录前没有 customer token，只能使用窄 service bootstrap；H5 无法调用真实 `wx.login`，双开关沿用已验证的 operator 测试模式。

**Alternatives considered**:

- public endpoint 直接返回 sellerId 后让 FE 登录：暴露可伪造 tenant 坐标，拒绝。
- closed batch 不签 session：顾客无法查看历史，违反规格。
- 自动 dev fallback：生产/预览绕过风险，拒绝。

## 5. CMS customer persistence boundary

**Decision**: 在 `/api/internal/kiv1/customer/*` 建独立 customer-scoped routes，header 使用 `x-kith-inn-v1-customer`；CMS 验证 customer JWT、seller active，并从 claims stamp/filter seller+openid。所有 customer 写还要求 `x-kith-inn-v1-internal`，保证状态/截止/重提决策只能由 BE 发起。operator routes 和旧 routes 不改身份语义。

**Rationale**: customer token 位于客户端，单独验证它不足以阻止直调 internal write；service secret 证明写入来自 BE。customer namespace 避免在一个 handler 中混合 operator/customer owner 规则。

**Alternatives considered**:

- 复用 operator route 加 role 分支：每个 handler 混合两套 owner/字段白名单，易越权，拒绝。
- 让 BE 直连 Payload REST：无法安全映射 product JWT/access，拒绝。
- 把订单状态机放 CMS：重复业务层，拒绝。

## 6. 餐次开放与 batch 状态

**Decision**: BE 允许桃子修改 priceCents、orderDeadline、orderStatus；转为 open 时必须已有完整菜单、deadline>now，price 允许空并使用 seller default。batch 创建只接收 1–20 个去重 slot id，BE 在写前验证每个 slot seller-owned、open 且未截止。batch close 只改 batch；slot close 影响所有 batch。

**Rationale**: meal slot 是跨 batch 的真实预订控制点，batch 是一次分享范围。把两者合并会让同一餐次在多张卡片下状态不一致。

**Alternatives considered**:

- batch 自带每餐开放状态：重复 meal-slot truth，拒绝。
- 允许 draft slot 入 batch，访问时再判断：制造不可用分享卡片，拒绝。
- price 必须单独填写：seller default 已有明确回退，拒绝。

## 7. PublicId 与分享 path

**Decision**: BE 使用运行时 Web Crypto 生成随机 UUID publicId，数据库 unique 作为并发兜底；冲突时有限重试。share path 固定为 `/pages/booking/index?batch=<encoded-publicId>`，不落库。标题由日期范围/餐次生成，允许桃子在 1–120 字内修改。

**Rationale**: UUID 不可顺序枚举、无需新依赖；固定 path 可确定性测试。数据库 unique 仍是最终保障。

**Alternatives considered**:

- 使用数据库 id：可枚举且泄露内部标识，拒绝。
- 自建短码编码/计数器：需要碰撞与长度协议，没有收益。
- 持久化 sharePath：可由 publicId 完全派生，拒绝。

## 8. 微信分享与 H5 验证

**Decision**: M2-A 的 batches 页面只显示并复制确定性的 title/path，供 contract 和 H5 自动化验证，不发出指向尚未注册页面的真实卡片。M2-B 注册 `/pages/booking/index` 并完成只读入口后，才在同一 batches 页面启用 weapp 平台分享按钮和页面分享回调；不调用用户资料授权。正式微信行为由 M2-B 真机 smoke 验证。

**Rationale**: Playwright 能验证 path/title 数据流但不能证明微信平台转发；把 H5 mock 当作真实分享会给出错误保证。现有 Taro 原生组件已足够。

**Alternatives considered**:

- 引入分享 SDK：平台原生能力足够，拒绝。
- 自动化微信开发者工具：CI 认证和稳定性不足，留真机 smoke。

## 9. 顾客资料与订单快照

**Decision**: 顾客只 list/create/soft-disable active profiles。选择已有 profile 后可为本次修改 displayName/address；不保存时只进入 order snapshot，选择保存时创建新 profile。M2 不原地编辑 profile，也不认领 openid=null 手工资料。profile 创建成功但订单失败时保留资料。

**Rationale**: “称呼+地址”是一个整体；新建比静默覆盖常用资料更安全，历史订单本来就使用快照。profile 是独立有效实体，不需要跨 HTTP 补偿。

**Alternatives considered**:

- 原地编辑历史 profile：可能影响后续选择且需要更强确认语义，M2 不做。
- 按称呼/地址匹配手工资料：会错误绑定个人数据，拒绝。
- profile+orders 分布式事务：当前量级和数据独立性不需要，拒绝。

## 10. 多餐次提交与幂等

**Decision**: 一个 customer submit request 携带 batchPublicId、profile/newProfile、本次 displayName/address 和最多 20 个去重 `{target:{date,occasion},quantity,resubmitCanceled}`。`target` 只复用 `BookingBatchView` 已公开的日期与午/晚餐，不接受内部 `mealSlotId`。完全相同的重复项按首次位置处理一次；同一公开坐标的 quantity 或规范化后的 resubmitCanceled 不同则整请求 422。BE 在指定 batch 的已验证 slot 快照中唯一解析每个 target，再用内部 ID 调用既有 CMS client；逐项结果用同一公开 target 关联页面餐次。BE 串行 create/update/resubmit，返回 created/updated/resubmitted/failed；单项失败不回滚。数据库 unique 和冲突后重读保证重试幂等。

**Rationale**: FR-009 明确禁止公开内部关系标识，而 C5 合并后的写 contract 要求 FE 提交未出现在公开读模型中的 `mealSlotId`，使 C6 无法构造合法请求。seller 内日期+餐次是既有领域唯一坐标，限定在 `batchPublicId` 后既可稳定解析，也不会扩大公开数据。微信网络下部分失败必须可解释、可安全重试；最多 20 项不需要 bulk transaction。

**Alternatives considered**:

- 全局事务：跨内部 HTTP 边界复杂且失败体验差，拒绝。
- 每餐由 FE 单独请求：确认摘要与结果聚合更复杂，且无法统一 profile 创建，拒绝。
- 并行写 20 项：当前规模无性能收益，冲突/权限错误更难解释。
- 在公开 view 暴露 `mealSlotId`：违反 FR-009 的零内部关系标识边界，拒绝。
- 由 FE 根据数组位置或菜单内容猜测餐次：重排或同菜单时不稳定，拒绝。

## 11. 顾客订单状态门禁

**Decision**: 顾客 create/update/resubmit/cancel 全部要求来源 batch open、slot 属于 batch、slot open、deadline>now。重复 draft 更新同一 id；canceled 重登记必须显式确认并清理确认/取消/付款/送达时间；confirmed 永远拒绝 customer 写。own-order list 仅按 seller+customerOpenid，读取不受 batch/slot关闭影响。

**Rationale**: 每次写重查消除 stale FE 绕过；读取与写入分离保证历史可见。显式重登记与 M1 resubmit 语义一致，避免静默复活被取消订单。

**Alternatives considered**:

- 只在页面加载时检查：并发关闭后仍可写，拒绝。
- customer 可覆盖 confirmed：破坏商家锁单，拒绝。
- batch close 后不允许取消 draft：长期文档明确任何写入都锁定，顾客联系桃子处理。

## 12. 验证策略

**Decision**: 每片只补本层不变量的失败测试，再实现对应最小范围；shared/BE/FE 继续 100% coverage，CMS persistence 片同时跑 SQLite/PostgreSQL，FE 片用 `CI=1` 无头 H5 E2E 并构建 weapp。每片最后运行 `pnpm verify`。M2-B 的原生分享卡片 → 目标页 → 真实 `wx.login`/query 恢复只能由维护者真机验证，T028 在此之前保持未完成；H5 自动化不得替代该门禁。

**Rationale**: 纯逻辑、真实 persistence boundary、H5 装配和 weapp 平台能力分别需要不同验证层；任何单层都不能替代其他层。分层小 PR 允许 review 聚焦当前不变量，同时用完整门禁证明中间状态仍可构建和回归。

**Alternatives considered**:

- 只 mock API 的 FE 测试：不能证明 JWT/tenant/persistence，拒绝。
- 只做 E2E：失败定位慢且无法穷举 owner/state 分支，拒绝。

## 13. Review 预算与发布标记

**Decision**: 每片开 PR 前按 `origin/main` 统计人工编写 diff，默认 `<400` 行。`>400` 必须先尝试继续拆分；确实不可拆时，在 PR 说明写明不可拆原因、额外风险与独立验证。`>800` 不开 PR。C6 可以完成实现与合并，但 T028 和维护者负责的发布结论未完成前，不把顾客写入 UI 标记为“可发布”或“已交付”。

**Rationale**: 预算是可执行的 review 风险门禁，不是事后说明；实现完成与允许发布是两个独立状态。真机平台能力和发布结论不应被无头 H5 结果替代。

**Alternatives considered**:

- 只在 PR 超大后补解释：失去“先拆再写”的约束，拒绝。
- 用 H5 dev login/share path 测试代替真机：无法证明微信一次性 code、原生卡片和 query 恢复，拒绝。
