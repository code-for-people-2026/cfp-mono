# 研究：kith-inn 生产接龙解析与订单对账

## Brownfield 事实

- `apps/kith-inn-be/src/agent/tools.ts` 的生产 `record_orders` 让主 agent 直接生成结构化 `items`；`date` 非必填并描述为“默认今天”，非法/缺失餐次会被兜底成午餐。
- `apps/kith-inn-be/src/agent/services.ts` 的 preview/record/create 都会把无日期项补成 Asia/Shanghai 的今天，因此缺日期仍可得到可执行确认卡。
- `apps/kith-inn-be/src/domain/orders/parse.ts` 是另一条 DeepSeek 解析链路，只输出顾客、份数、餐次；目前只有 `eval/run-parse.ts` 使用，生产聊天不调用。
- 真实样本已有 15 段，包含菜单编号、示例行、午晚双标题和一处历史标题日期/周几冲突，但 ground truth 尚无日期。
- `operation-confirm` 已通过 `pendingOps` 把不可变预览保存在服务端；每位 operator 只保留最新 opId，旧卡点击返回 409。该机制能继续承载解析和对账确认。
- #154 已把单订单草稿创建、确认和取消收进 CMS 事务，并建立 active 业务坐标唯一约束；当前重复坐标仍只会冲突，不会更新。
- CMS `GET /api/internal/orders` 已按 seller/date/occasion/status 读取订单与 items；写侧没有替换 items 或跨多订单对账端点。
- `orders.source` 已区分 `chat-paste`、`manual` 等内部审计值，但产品确认完整快照覆盖目标范围全部订单，卡片和对账不展示、不判断录入来源，也无需按来源保存独立数量分量。

## 决策 1：生产工具传原文，唯一解析器做结构化

**Decision**: `record_orders` 工具参数改为原始 `rawText`；工具执行时调用与 eval 相同的订单解析入口，主 agent 不再直接提供可信 items。

**Rationale**: 主 agent 仍负责判断何时记单，但日期、模式和候选只由一条可评测链路产生，消除生产与 eval 分叉。把原文原样传入也避免主 agent 在工具参数阶段丢菜单标题或日期证据。

**Alternatives considered**:

- 继续评测主 agent 直接生成的 items：拒绝。难以稳定抽取单个工具调用做四字段评测，且现有宽松 schema 仍允许静默默认。
- 在聊天 route 用正则抢先识别接龙：拒绝。会形成 agent 外的第二套路由规则，自然语言和接龙边界也更脆弱。
- 新增第二个专用 agent：拒绝。一次普通结构化调用足够，且 PRD 只允许一个产品 agent。

## 决策 2：LLM 抽取语义，确定性代码验证日期证据

**Decision**: 解析结果携带模式、覆盖范围、四字段候选、原文日期证据和未知片段；LLM 负责从软格式中抽取，确定性校验负责 ISO 日期、正整数、证据确实存在于原文、年份解析、周几一致性和候选是否落在范围内。

**Rationale**: 仅靠 prompt 不能证明模型没有补写“今天”。保留原文证据并二次验证，才能让缺日期/冲突日期真正 fail closed，同时仍利用 LLM 区分菜单行与订单行。

**Alternatives considered**:

- 完全用正则解析接龙：拒绝。真实样本的人名、中文数字、午晚餐位置和软格式变化不适合纯正则。
- 完全信任 LLM 的标准日期：拒绝。无法阻止缺日期时幻觉默认，也无法确定性校验周几冲突。
- 把周几作为订单字段存库：拒绝。周几只是输入一致性证据，可由日期推导，不是领域数据。

## 决策 3：完整接龙是 snapshot，自然语言是 increment

**Decision**: 解析器显式输出 `snapshot` 或 `increment`。snapshot 声明日期/餐次范围并给出最终数量；increment 只允许一个业务坐标，并区分相对 `add` 与绝对 `set`。

**Rationale**: “最后一次接龙为准”需要把未出现订单列为退出项，而自然语言补单绝不能据未提及项推导删除。模式成为确认卡和写入契约的一等字段后，两者不会误用同一删除语义。

**Alternatives considered**:

- 所有输入都做逐条 upsert：拒绝。新版接龙中已撤回的顾客会永远残留。
- 按 `orders.source` 区分覆盖范围：拒绝。产品已选择完整接龙覆盖范围内全部订单；来源分量还会要求新增持久化模型。
- 自然语言一律设置总数：拒绝。产品明确“已有订单时加两份”表示追加；确认卡必须展示计算结果。

## 决策 4：差异预览在 BE，原子应用和新鲜度校验在 CMS

**Decision**: BE 用当前 seller-scoped customers/orders/offerings 构造差异卡和预览指纹；确认时把服务端 pending 中的不可变候选、范围和 expected active-order fingerprint 一次提交给 CMS。CMS 在事务内重新读取目标范围并比较 fingerprint；不一致返回 `stale-preview`，一致才计算并应用全部变化。

**Rationale**: BE 最适合生成用户文案与新客地址输入，CMS 才能在同一数据库快照中防止 preview 后数据变化并原子修改多张订单。指纹覆盖目标范围所有 active order 的 id/status/paymentStatus/updatedAt/items，能发现插入、取消、付款或数量变化；确认事务再用数据库写锁与当前 fulfillment 状态保护普通补单、送达和收款并发。录入来源不影响对账，无需进入指纹。

**Alternatives considered**:

- 只依赖 pending opId：拒绝。它只能证明卡片是该 operator 最新一张，不能证明数据库没被订单 tab 或并发请求修改。
- 逐张调用 create/update/cancel：拒绝。中途失败会让“最后一次快照”只应用一部分。
- 持久化 reconciliation/snapshot collection：拒绝。确认卡是短暂操作，现有 pending + fingerprint 足够，新增表属于 YAGNI。

## 决策 5：同次确认用 operation key 幂等，独立操作仍需重预览

**Decision**: 每张对账确认卡生成不可预测的 operation key；CMS 复用现有 `orders.idempotencyKey` 为本次变更写入坐标级派生键。同一 operation key 因重复点击、并发到达或响应丢失而重试时返回等价的已完成结果；不同 operation key 若基于陈旧 fingerprint 则返回 `stale-preview`。

**Rationale**: fingerprint 只能判断数据是否变化，单独使用会把“第一次其实成功但响应丢失”误报为陈旧，也无法区分另一笔独立追加。现有 idempotencyKey 已为技术幂等预留，无需新增表或依赖。

**Alternatives considered**:

- 自动循环 100 次作为正确性保证：拒绝。#154 已验证事务竞态；本功能用重复、同时到达和陈旧数据三个确定性场景覆盖新增语义。
- 只比较当前结果是否等于目标结果：拒绝。两个独立的“再加 2 份”可能得到相同预览，不能据结果相同把第二笔当成网络重试。
- 新增 reconciliation ledger：拒绝。MVP 单操作者、短确认窗口下复用现有 idempotencyKey 足够。

## 决策 6：复用现有订单状态机更新 confirmed

**Decision**: draft/confirmed 命中同坐标时保留 order id 和状态，原子替换唯一套餐 item 的数量与价格汇总；confirmed fulfillment 保持原记录和状态。snapshot 退出项走现有 cancel 语义，使 confirmed fulfillment 同步 canceled；新增项创建 draft。

**Rationale**: 用户需要更新现单而非制造重复。数量存在 order_item，送餐和汇总会读取更新后的订单；保留 confirmed 状态避免让已经进入经营口径的订单意外退回草稿。取消历史则符合现有审计和 active 唯一约束。

**Alternatives considered**:

- 取消旧单再建新单：拒绝。会丢失确认/付款语义并制造不必要历史记录。
- 更新 confirmed 后重新创建 fulfillment：拒绝。fulfillment 按 order 唯一，且现记录已表达同一送餐任务。
- 把 updated order 退回 draft：拒绝。与“同步影响经营口径”冲突，也增加人工再次确认订单步骤。

## 决策 7：两个 PR 共用一份全套 spec

**Decision**: PR 1 交付唯一生产解析、fail closed 和真实 eval；PR 2 交付快照/增量对账、CMS 事务和 FE 差异卡。#155 在 PR 2 合并后关闭。

**Rationale**: AI 解析与多订单事务可分别验证和 review；PR 1 独立消除日期静默默认，PR 2 依赖其明确的模式/范围契约。拆成两个 issue 会削弱同一验收目标的可追踪性。

**Alternatives considered**:

- 一个大 PR：拒绝。跨 LLM、BE、CMS、shared、FE 和真实数据库，review 面过大。
- 先做对账再做解析：拒绝。没有可信范围与模式就不应实现批量退出订单。

## 未采用的新能力

- 不新增 LLM SDK、日期库、消息队列、工作流引擎或通用 diff 框架。
- 不持久化原始接龙或每种来源的数量分量。
- 不根据菜单正文校验、恢复或重建菜单；订单始终是一份套餐商品的数量。
