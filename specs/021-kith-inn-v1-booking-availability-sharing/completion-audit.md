# Page 4 完成审计

**审计日期**：2026-07-27  
**结论**：商家 Page 4 核心工作流与后端能力已经交付，但本规格仍为进行中；打烊组合领域规则、成功页批次范围文案、SC-001/SC-005 自动化证据与微信真机 SC-004/T027 尚待完成。

## 需求证据矩阵

| 需求 | 实现证据 | 自动化证据 | 状态 |
|------|----------|------------|------|
| FR-001–FR-003 默认价与逐餐配置 | seller settings、MealSlot booking config、Page 4 配置表单 | `kiv1-seller-settings.test.ts`、`mealSlots.test.ts`、`merchant.spec.ts` 分别覆盖默认价、单餐改价和同日小批量操作 | 实现完成；一周完整计时工作流待 T030 |
| FR-004–FR-005 批量开放/停止与逐项结果 | 最多 20 餐次的 bulk status route、部分失败回填和 pending 防重 | `mealSlots.test.ts`、`bookingBatches.test.ts`、商家经营 E2E | 完成 |
| FR-006–FR-008 整天/单餐打烊与可见性规则 | seller/date 事务锁、独立 closure、餐次展示和 closure precedence 纯规则 | 持久化/route tests、`availability.test.ts`、商家经营 E2E | 商家端完成；closure 与顾客展示组合规则待 T028，顾客 UI 按范围延期 |
| FR-009–FR-010 日期/餐次原生分享 | BookingBatch target、公开随机标识、确定性 `date`/`occasion` 路径 | `kiv1-booking-batches.test.ts`、BE `bookingBatches.test.ts`、Page 4 纯逻辑和日期/餐次 E2E | 实现完成；原生卡片待 T027 |
| FR-011–FR-012 定位语义与兼容 | 共享契约把 target 定义为未来初始定位；兼容公开批次继续作为当前顾客访问边界 | shared contract tests、旧批次兼容与公开批次实时详情 route tests | 兼容行为完成；成功页范围说明待 T029，seller 范围顾客接线按范围延期 |
| FR-013–FR-016 反馈、详情、历史与导航 | Page 4 配置/成功/详情/紧凑历史状态，来源感知返回，无新增 tabbar | Page 4 纯逻辑、API client、经营/分享/历史 E2E 与核心 375×812 截图 | 核心功能完成；文案待 T029，其余状态视觉证据待 T031 |

## 成功标准证据

- SC-001：现有 E2E 分别覆盖默认价、单餐改价和同日小批量操作；一周批量开放的完整工作流及 3 分钟计时均待 T030。
- SC-002：餐次状态展示与整天优先于单餐打烊目前由分离的纯规则覆盖，尚缺 closure 到顾客展示结果的组合样例；待 T028。顾客 UI 接线按范围延期。
- SC-003：批量操作逐项返回，失败行保持选中，页面阻止重复提交。
- SC-004：源码和 weapp 构建已提供原生分享按钮，实际两步调起聊天卡片仍待 T027，不标记完成。
- SC-005：经营、成功详情和紧凑历史已有 375×812 基线；加载、局部失败、空态和批量处理中证据待 T031，真实设备安全区待 T027。

## 外部剩余门禁

T028–T031 是仓库内剩余工作，依次映射到计划 PR7–PR9。T027 需要已登录微信开发者工具、微信聊天会话和真实 iPhone/Android 设备，验证原生日期/餐次卡片、公开批次的实时状态变化及安全区。当前可复现的环境事实和验收步骤见 [quickstart.md](./quickstart.md)。顾客端全量实时浏览不在本期 UI 范围，不得据此扩大 T027。
