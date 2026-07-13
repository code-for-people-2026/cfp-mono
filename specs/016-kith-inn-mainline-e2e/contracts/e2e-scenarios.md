# Contract: kith-inn 主链路 E2E 场景与证据

## 1. 场景通用契约

每个场景必须声明稳定 `Scenario ID`、独立初始状态、H5 用户动作、允许的 support API、页面检查点、真实数据不变量和失败证据目录。标为“H5”的步骤不得改成直接调用 BE/CMS 来缩短测试；support API 不得替代被验收的业务动作。

## 2. 场景矩阵

| ID | 初始状态 | 必须走 H5 的动作 | 最终不变量 |
|----|----------|------------------|------------|
| `E2E-ORDER-001` | 桃子 seed；无目标日订单 | dev-login、粘完整接龙、确认预览、确认草稿订单 | 目标坐标各 1 张 draft→confirmed；每单 1 条 pending fulfillment；预览前零写入 |
| `E2E-MAIN-001` | `E2E-ORDER-001` 已完成 | 生成菜单、自动换目标菜、发布、标已付、批量送达 | 菜单 published；仅目标位置变化；全部目标单 paid；全部目标履约 done |
| `E2E-DATE-001` | 无目标日订单 | 粘缺日期/日期冲突接龙并提交 | 显示补全/冲突提示；order/item/slot/fulfillment 变化 0 |
| `E2E-ADDRESS-001` | 新顾客无默认地址 | 粘接龙、地址留空、确认草稿与订单、查看送餐 | 订单/履约成功；地址为空；出现在“无地址”组 |
| `E2E-IDEMP-001` | 固定 preview 或 draft | 重复确认/并发重试 | 同业务坐标 active order=1；item 集合 1 套；有效 fulfillment=1 |
| `INT-TENANT-001` | seller A/B 各有同类资源和 token | 无强制 H5 步骤；真实 CMS/BE 请求 | A 只见 A；跨读/写/relationship 失败；B 变化 0 |
| `INT-SEED-001` | v1 sentinel + 旧 kith 测试脏数据 | 项目级 reset/seed | 旧 kith 回到 fixture；v1 sentinel id/内容/数量变化 0 |
| `CI-AFFECTED-001` | 代表性 changed-path 集合 | 无 | 相关旧 kith 路径 100% 选中 mainline；无关项目 0 次误选 |

## 3. 连续 happy path 顺序

`E2E-ORDER-001` 与 `E2E-MAIN-001` 在最终验收中组成一条连续 journey，期间不得 reset 或直接 seed 中间经营状态：

1. H5 dev-login 建立桃子会话。
2. 今天页粘贴固定完整接龙。
3. 确认卡展示日期、餐次、顾客、份数与新增/更新/退出/不变。
4. 确认 preview 后形成 draft；订单页确认目标订单。
5. 菜单页为目标餐次生成 menu plan。
6. 自动换掉明确 `dishIndex`，读取中文放宽原因并确认非目标位置不变。
7. 发布菜单，确认 publish text 来自当前菜品。
8. 订单页把目标订单标为已付。
9. 送餐页精确选择目标 fulfillment 并批量送达。
10. support API 读取最终数据，核对订单、slot、menu、payment 与 fulfillment 不变量。

## 4. 固定外部模型契约

- 服务只实现 DeepSeek-compatible chat completion HTTP 边界，监听测试专用端口。
- 输入必须仍由生产 chat/parse 代码构造；固定服务不得直接写数据库或调用 CMS。
- 对 `E2E-ORDER-001` 返回能驱动生产 `record_orders` preview 的合法结构。
- 对 `E2E-DATE-001` 返回缺日期/冲突证据，必须由生产校验拒绝，不能由固定服务直接伪造最终 UI 文案。
- 未识别请求返回明确非 2xx，禁止默认为 happy path。
- 请求与响应不得包含真实 API key、openid 或生产数据。

## 5. 证据契约

| 结果 | 必须存在 |
|------|----------|
| pass | 场景名、耗时、断言结果；无旧 trace 冒充 |
| assertion failure | 对应 scenario 的 Playwright trace、report、页面截图/DOM 快照 |
| webServer failure | CMS/BE/fixed-LLM 服务日志与失败探针 |
| timeout | trace + 最后成功步骤 + 各服务健康状态 |

建议路径：

```text
apps/kith-inn-fe/test-results/mainline/**
apps/kith-inn-fe/playwright-report/mainline/**
apps/kith-inn-fe/test-results/mainline-services/*.log
```

## 6. CI 选择契约

必须选中旧 kith-inn mainline suite 的路径类别：

- `apps/kith-inn-fe/**`
- `apps/kith-inn-be/**`
- `packages/kith-inn-payload/**`
- CMS 的旧 kith-inn seed/config、health、operator、customers、orders/reconcile/confirm/cancel、service-slots、menu-plans、offerings、fulfillments、chat messages 与对应 shared lib/helper

不得仅因以下业务路径变化选中旧 kith-inn mainline suite：

- `apps/kith-inn-v1-fe/**`
- `apps/kith-inn-v1-be/**`
- `packages/kith-inn-v1-*` 的纯 v1 业务文件
- website、community-cooking 等无依赖项目的纯业务文件

共享 CMS host/config/seed 变化可同时选中旧 kith-inn 与 v1 E2E；此时必须串行。
