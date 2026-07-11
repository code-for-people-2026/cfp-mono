# 生产订单输入契约

本契约描述主 agent → `record_orders` → 唯一解析器 → 确认卡的内部行为，不是 FE 直接调用的 HTTP API。

## 工具输入

`record_orders` 只接受主 agent 原样转交的用户文本：

```json
{ "rawText": "用户本轮完整原文" }
```

主 agent 不再提供日期默认值或结构化 `items`。生产工具执行与 `eval/run-parse.ts` 调用同一解析入口，并显式传入 Asia/Shanghai 的参考日期。

## 解析成功

完整接龙示意：

```json
{
  "mode": "snapshot",
  "scope": [
    { "date": "2026-07-13", "occasion": "lunch", "dateEvidence": "7.13号星期一" },
    { "date": "2026-07-13", "occasion": "dinner", "dateEvidence": "7.13号星期一" }
  ],
  "items": [
    { "customerName": "王燕萍", "date": "2026-07-13", "occasion": "lunch", "quantity": 2 }
  ],
  "unknownSegments": [],
  "issues": []
}
```

自然语言增量示意：

```json
{
  "mode": "increment",
  "operation": "add",
  "scope": [{ "date": "2026-07-13", "occasion": "dinner", "dateEvidence": "7月13日晚餐" }],
  "items": [{ "customerName": "王阿姨", "date": "2026-07-13", "occasion": "dinner", "quantity": 2 }],
  "unknownSegments": [],
  "issues": []
}
```

`quantity=2` 在 `add` 模式表示增加量；最终数量由读取当前订单后的差异预览计算。`set` 表示绝对目标总数。

## 阻断结果

下列任一情况不产生 `operation-confirm`：

- 原文没有可验证的日期证据；
- 非法日期，或明确周几与日历日期冲突；
- 多餐模板中订单行无法唯一映射餐次/日期；
- item 缺顾客、日期、餐次或正整数份数；
- scope 为空、item 超出 scope、increment 不止一个坐标；
- 存在疑似真实订单但无法完整解析，可能导致 snapshot 错误退出现单；
- 模型输出未通过严格 schema。

阻断时回复指出需要桃子检查的具体字段或原文片段，不补成“今天/午餐”，也不把菜单行或示例行当订单。

## 确认卡最小展示

每条候选至少展示：完整日期、午/晚餐、顾客、份数。snapshot 标明“完整接龙，以本次为准”；increment 标明“单独补单”。PR 2 增加当前值、变化类型和最终值。

## 评测口径

- ground truth 每条包含 `date + occasion + customerName + quantity`。
- 四字段全部相等才算一条正确，按多重集合匹配。
- 至少十段真实样本；整体准确率 ≥95%；午晚错配为 0。
- 报告同时记录 fail-closed issues，不能用丢弃失败样本抬高准确率。
