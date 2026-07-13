# Data Model: kith-inn 主链路真实 E2E 与 CMS 集成验证

## 1. 设计结论

本功能不新增生产 collection、字段、索引或状态。测试只准备并观察现有实体；任何 schema diff 都视为越界。新增的 scenario、fixture 与 run evidence 是测试代码/临时文件，不持久化到 Payload。

## 2. 真实业务实体与不变量

### Seller / Operator

- `seller` 是所有旧 kith-inn 业务实体的租户键。
- `operator.wechatOpenid` 经 dev-login 解析为唯一 seller 会话。
- fixture 至少包含 seller A（桃子）与 seller B（隔离哨兵），openid 不重复。
- A 的 token 不得读取、更新或 relationship 引用 B 的实体。

### Customer

- 以 seller + displayName 参与订单解析与查找。
- `address` 选填；空白归一为缺失。
- 新订单复制顾客当时的默认地址为快照；无地址不阻断确认或履约。

### Service Slot

- 业务坐标为 seller + date + occasion。
- 订单确认可把目标 slot 置为 open；菜单只确保 slot 存在，不替订单打开经营状态。
- PostgreSQL 与 SQLite 日期表示都由现有规范化逻辑保持等价。

### Order / Order Item

- active 业务坐标为 seller + customer + date + occasion。
- 一张 order 的 item 集合表达该餐次买了什么与数量。
- draft 不创建 slot/fulfillment；confirmed 必须同时具有 open slot 和唯一有效 fulfillment。
- 重复 snapshot/reconcile、重复确认和并发重试不得产生第二张 active order 或第二套 item。
- `paymentStatus=paid` 后退出未付口径。

### Fulfillment

- 一张 order 最多一条有效 fulfillment。
- 地址从 order 快照读取；空地址进入“无地址”组。
- `pending → done` 表示送达；批量更新只能作用于当前 seller 的精确 ids。

### Menu Plan / Offering

- 一个 seller + slot 最多一份 menu plan。
- 菜单菜品必须来自当前 seller 的启用 component offerings。
- 自动换菜只改变目标 `dishIndex`；放宽规则保持固定顺序。
- `draft → published` 后产生当前 publish text；换菜不得保留旧文案。

## 3. 测试域对象（不持久化）

### E2EScenario

| 字段 | 含义 |
|------|------|
| `id` | 稳定场景编号，对应 contract |
| `initialState` | seed 后需满足的业务状态 |
| `uiSteps` | 必须通过 H5 执行的用户动作 |
| `supportSteps` | 仅用于 fixture/观测/重试的 API 操作 |
| `checkpoints` | 页面与真实数据检查点 |
| `finalInvariants` | 场景结束必须成立的精确不变量 |
| `evidence` | 失败时 trace/report/service log 路径 |

### RunEvidence

每次运行以 `runId`、`scenarioId`、result、report、可选 trace 及 CMS/BE/固定 LLM service logs 组成临时证据；运行开始前清理，结束后只作为 CI artifact，不进入业务数据库。

## 4. 状态转换检查点

```text
接龙原文
  → preview（业务表零变化）
  → reconcile success（order=draft + items；无 slot/fulfillment）
  → confirm（order=confirmed + slot=open + fulfillment=pending）
  → menu draft
  → swap（仅目标位置变化）
  → menu published
  → paymentStatus=paid
  → fulfillment=done
```

失败路径：

```text
缺/冲突日期 → 补全提示 → 业务表零变化
无地址 → draft → confirmed → fulfillment.pending（address fallback）
重复 reconcile/confirm → 返回既有结果 → 业务实体计数不增长
跨 seller id/relationship → 拒绝/空结果 → seller B 零变化
```

## 5. Fixture 隔离规则

- 主链路开始前只调用 kith-inn 项目级 reset/seed，禁止全库 reset。
- v1 sentinel 在 reset 前后按 id、内容与数量比较，变化数必须为零。
- 每个 seller 的顾客、订单、slot、menu 与 fulfillment id 只在所属 token 下使用。
- 场景不得依赖固定自增 id；通过稳定业务标识或响应返回 id 关联。
- 日期以 Asia/Shanghai 计算并在测试开始时冻结/显式构造，不能依赖 runner 所在时区。
