# 验证指南：kith-inn 生产接龙解析与订单对账

## 前置条件

- Node.js、pnpm 按仓库基线安装。
- 真实模型评测需要本地提供 `DEEPSEEK_API_KEY`，不得提交密钥或 `.env`。
- 原子对账集成测试需要 `pnpm db:up` 提供 PostgreSQL。
- 所有数据和断言只使用 kith-inn collection，不操作 `kith-inn-v1`/`kiv1_*`。

## PR 1：解析自动化验证

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-be eval:parse
pnpm verify
```

预期：生产 `record_orders` 与 eval 调同一解析入口；真实样本四字段准确率 ≥95%、午晚错配 0；模型输出异常和日期风险样本 fail closed；全仓门禁通过。

### 真实模型评测记录（2026-07-12）

```bash
pnpm --filter @cfp/kith-inn-be eval:parse
```

- 模型：`deepseek-chat`
- 参考日期：`2020-06-01`
- 样本数：15
- 四字段准确率：100.0%
- 午/晚错配：0
- issue mismatch：0
- 总耗时：28,040ms
- 结果：M1 acceptance MET

密钥由本地 gitignored `.env` 注入，未写入命令、日志或仓库。

### 场景 1：菜单噪声与双餐标题

粘贴含午餐/晚餐标题、不同菜名、编号菜品、示例行和多位顾客的完整接龙。

预期：只得到真实顾客候选；每条含完整日期、餐次、顾客、份数；菜单与系统菜单是否一致不影响结果。

### 场景 2：日期与周几冲突

粘贴 `7.13号星期二`，参考年份中 7 月 13 日实际为星期一；再测试无日期、非法日期和多餐歧义。

预期：返回具体纠错/补全消息，无 `operation-confirm`，确认端点没有 pending 写操作。

### 场景 3：自然语言模式

分别输入“7 月 13 日晚餐，加王阿姨 2 份”和“7 月 13 日晚餐，王阿姨改成 2 份”。

预期：第一条解析为 increment/add，第二条为 increment/set；都显示明确日期，不影响其他坐标。

## PR 2–4：分片对账自动化验证

```bash
pnpm --filter @cfp/cms test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-fe test
pnpm verify
```

PR 2 验证完整快照，PR 3 只验证增量纯函数与 CMS 原子语义，PR 4 再验证 Agent/聊天/FE 确认链路。

### 场景 4：最新接龙全量覆盖（PR 2）

1. 导入接龙 A 并确认，包含王 1 份、李 2 份。
2. 自然语言补赵 1 份。
3. 粘贴接龙 B，只含王 3 份、陈 1 份。
4. 查看卡片但不确认，再确认。

预期：卡片显示王 `1→3`、陈新增、李取消、赵取消，不展示或区分这些订单此前的录入方式；确认前无数据变化，确认后目标范围只保留王 3 和陈 1 两张 active 订单。

### 场景 5：增量补单的运算解释（PR 3–4）

准备王阿姨 1 份订单，输入“王阿姨加 2 份”；再输入“王阿姨改成 2 份”。

预期：前一张卡显示 `当前 1 + 2 → 共 3`，确认后为 3；后一张显示 `当前 3 → 改成 2`，确认后为 2；同日其他订单不变。

### 场景 6：陈旧卡与原子回滚（PR 2–3）

预览一份含新增、更新、取消的 snapshot，在确认前用订单页改变任一目标订单；另在每个 reconcile 写入阶段注入失败。

预期：同一 operation key 的重复或同时确认只应用一次；若首次成功但响应丢失，重试返回已完成；不同操作导致数据变化后，旧卡返回 `stale-preview` 并要求重新预览。故障注入后所有订单/items/fulfillments 保持操作前状态。

### 场景 7：confirmed 更新和退出（PR 2）

准备 confirmed 订单及 pending/done fulfillment，并分别准备 unpaid/paid 付款状态，让新快照更新数量或移除该顾客。

预期：unpaid + pending 的 confirmed 订单可在确认后更新或退出；paid/reconciled 或 done 的订单不生成可执行批量变更，确认阶段再次校验并返回 `settled-order`，整次快照不留下部分写入。

## 最终检查

```bash
git diff --check
git diff --name-only | rg 'kith-inn-v1|kiv1' && exit 1 || true
```

预期：无空白错误，无任何 v1 文件变化；真实模型 eval 结果记录在 PR 说明或对应规格验收记录中，不包含密钥和原始敏感信息。
