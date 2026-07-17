# Quickstart：M2 顾客预订登记

## 1. 前置条件

1. M2-A/B、恢复计划、公开餐次坐标纠偏计划、C1～C6 与 D1～D3 已合并，D2R 已完成取消持久化纠偏。从最新 `main` 开始 D4；T028 微信真机门禁仍保持未完成。
2. 使用仓库要求的 Node.js、pnpm、PostgreSQL/Payload 环境。
3. 配置既有 operator JWT、internal service token、微信 app credentials；本地可显式开启 dev login。
4. 运行独立幂等的桃子 seller/operator seed。M2 不修改 seed 语义，也不清空旧业务 collection。

## 2. 分片验收

### M2-A：商家配置与批次 path

1. 桃子登录，生成至少两个含五道菜的餐次。
2. 为餐次设置价格或默认价、未来截止时间并开放预订。
3. 选择 1–20 个 open slot 创建 batch，确认生成 UUID publicId 与固定小程序 path。
4. 在 weapp/H5 商家页预览并复制 path；确认 M2-A 尚不显示原生分享按钮，也不发出指向未注册顾客页的卡片。
5. 关闭 batch，确认餐次本身没有被关闭；关闭单个 slot，确认所有 batch 中该 slot 都不可登记。
6. 在预热且正常网络条件下计时“配置餐次 → 选择餐次 → 创建可分享批次”，记录结果不超过 60 秒，并检查分享入口内部数据库标识暴露数量为 0。

### M2-B：顾客静默 session 与只读入口

> 代码与自动门禁已完成；以下原生卡片/真实 `wx.login` 步骤仍是 T028，必须由维护者真机执行。

1. 从 M2-A 创建的 batch 发出微信原生分享卡片，点击后进入真实 path，调用 `wx.login` 并以临时 code 建立 customer session。
2. 确认页面显示 seller、batch、菜单、解析后价格与截止时间，且无 operator 选择页。
3. 使用另一 seller 的 token 访问 publicId，确认 404。
4. 关闭 batch 或 slot 后重新进入，确认历史内容仍可读且登记入口禁用并显示原因。
5. 在正常网络下从点击有效分享入口开始计时，记录商家与批次餐次首次可见不超过 5 秒，过程中无显式注册或个人资料授权。

### M2-C1：strict shared contract

1. 运行 shared 失败测试，再实现 customer profile/reservation strict schema。
2. 验证 1–20 个餐次、完全相同重复项只保留首次位置、份数或规范化重登记标志冲突时整请求 422。
3. 验证请求不能注入 seller/openid/source/status，结果只允许 created/updated/resubmitted/failed。

### M2-C2/C3：CMS owner 与 relationship 边界

1. C2 验证 profile list/create/touch 始终按 customer JWT 的 seller+openid，写入另需 service token，响应不含 openid。
2. C3 验证 order 查重/create/update 同时校验 seller、customerOpenid、slot、profile 与 source，unique 冲突稳定可重读。
3. 两片分别运行 SQLite 与 PostgreSQL；跨 seller/openid 统一 404，关系错误不产生部分写入。

### M2-C4/C5：BE 编排与 HTTP

1. C4 用纯领域和 CMS client 测试逐项 create/update/resubmit/confirmed lock、价格快照、部分成功与 profile 不回滚。
2. C5 验证 customer JWT、整请求 422、最多 20 项、稳定错误映射和逐项结果顺序；不增加 FE 页面。

> C1～C6 已分别由 PR #214、#217、#218、#219、#220、#222、#223 合并。

### M2-C5R：公开餐次坐标纠偏

1. 先写 shared/BE 失败测试，验证 reservation 输入与逐项结果只使用 strict `{target:{date,occasion}}`，并拒绝客户端注入 `mealSlotId`。
2. 验证完全重复 target 仍归一化、冲突重复整请求 422，BE 只在指定 batch 内把公开 target 唯一解析到内部餐次。
3. 验证 CMS client 仍只接收服务端解析的内部 ID，HTTP 成功/失败结果只回显公开 target，未知逐项错误继续净化。
4. 运行 shared 与 BE 100% coverage、`pnpm verify`、路径审计和人工 diff 统计；该 live endpoint 必须原子切换但不修改 CMS 或 FE，人工 diff `<400`。

### M2-C6：资料与多餐次登记 UI

1. 首次填写称呼/地址时确认展示“用于桃子识别订单和送餐地址”，再新建资料并选择两个餐次提交不同份数；确认 customer-card draft 在商家订单页可见。
2. 重复提交同一 profile/slot，确认更新原 order id；让其中一项确认或截止，确认另一项仍成功且失败原因明确。
3. 编辑本次地址但不保存时 profile 不变；选择保存为新资料时新增 profile。
4. 分别计时首次顾客与已有单资料顾客的两个餐次流程，记录不超过 90 秒和 45 秒。
5. 运行 FE coverage、`CI=1` 无头 H5 E2E 与 weapp build；真机登记由维护者执行。FE 只从公开 batch view 的日期与餐次构造 target，不读取或猜测内部 ID。
6. T028 与维护者发布结论未完成前，只记录实现验证结果，不把顾客写入 UI 标记为“可发布”或“已交付”。

### M2-D1/D2：自助管理 contract 与 persistence

1. D1 验证 own-order/edit/cancel/deactivate strict contract，禁止 owner 和三状态轴注入。
2. D2 验证 own-order 只按 seller+customerOpenid、profile deactivate 幂等且历史订单仍可见，跨顾客统一 404。

### M2-D4：顾客页面与总验收

1. D3 已由 PR #227 合并；D2 及其取消持久化纠偏分别由 PR #225、#226 合并。
2. D4 验证顾客只看到自有订单和三状态轴，在允许窗口修改/取消，软停用 profile 不影响历史快照。
3. 运行 FE coverage、无头 H5 E2E、weapp build；从空 M2 数据完成 seed→分享→登记→商家确认→顾客锁单总验收。

## 3. 自动化验证

每个实现 PR 至少运行受影响 workspace 的 100% coverage 窄测试，再运行总门禁：

```bash
pnpm --filter @cfp/kith-inn-v1-shared test:coverage
pnpm --filter @cfp/cms test
pnpm --filter @cfp/kith-inn-v1-be test:coverage
pnpm --filter @cfp/kith-inn-v1-fe test:coverage
pnpm verify
```

H5 端到端测试必须无头运行，避免抢占本机浏览器：

```bash
CI=1 pnpm --filter @cfp/kith-inn-v1-fe test:e2e
```

微信小程序自动门禁执行现有 `build:weapp`；仓库当前没有独立 weapp smoke script。每个相关切片另做一次真机手工 smoke，按测试记录覆盖 `wx.login`、分享回调、query 恢复和禁止 Node-only 依赖，不为 M2 引入第二套 runner。

## 4. PR 门禁

- 每片开 PR 前用 `git diff --numstat origin/main...HEAD` 统计人工编写 diff；默认 `<400` 行，`>400` 必须解释不可拆原因、风险和验证，`>800` 不得开 PR。
- diff 中没有旧 `@cfp/kith-inn-*` 业务 package 修改。
- 没有新 workspace、collection、索引、运行进程或依赖，除非后续有独立 spec 明确批准。
- 没有 M3 对账/催款/状态批量管理增强，也没有 M4 AI 营销能力。
- PR 置为 ready 后等待 base=main 的 Codex 自动 review；每轮修复与 latest head CI 完成后再精确评论 `@codex review`，直至 latest head 无新 comment。
- 每条 actionable comment 要么修复并回复，要么说明不采纳理由；重要 thread 全部 resolve 后才可合并。
