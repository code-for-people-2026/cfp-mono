# Quickstart：M2 顾客预订登记

## 1. 前置条件

1. 从最新 `main` 分别创建 M2-A、M2-B、M2-C、M2-D 分支；前一 PR rebase merge 后再开始下一 PR。
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

1. 从 M2-A 创建的 batch 发出微信原生分享卡片，点击后进入真实 path，调用 `wx.login` 并以临时 code 建立 customer session。
2. 确认页面显示 seller、batch、菜单、解析后价格与截止时间，且无 operator 选择页。
3. 使用另一 seller 的 token 访问 publicId，确认 404。
4. 关闭 batch 或 slot 后重新进入，确认历史内容仍可读且登记入口禁用并显示原因。
5. 在正常网络下从点击有效分享入口开始计时，记录商家与批次餐次首次可见不超过 5 秒，过程中无显式注册或个人资料授权。

### M2-C：资料与多餐次登记

1. 新建一份顾客资料并选择两个餐次提交不同份数。
2. 确认两条 customer-card draft 保存 customerOpenid、profile、姓名/地址/价格快照。
3. 再次提交同一 profile/slot，确认更新原 order id，不新增重复订单。
4. 让其中一项确认或截止，批量提交后确认可写项成功、失败项单独返回原因。
5. 编辑当前登记的地址但不保存资料，确认 profile 不变；选择保存为新资料时确认新增 profile。
6. 分别计时首次顾客与已有单资料顾客的两个餐次提交流程，记录结果不超过 90 秒和 45 秒。

### M2-D：我的预订与自助变更

1. 顾客只看到当前 seller + openid 的订单和三条状态轴。
2. 在 open batch/slot/deadline 内修改 draft 份数，确认 id 不变。
3. 显式取消 draft；再次登记时先得到确认提示，确认后重置同一 id。
4. 桃子确认订单后，顾客修改、取消和重登记均被拒绝。
5. 软停用 profile，确认其不再用于新登记，但历史订单仍可见且快照不变。

## 3. 自动化验证

每个实现 PR 至少运行受影响 workspace 的窄测试，再运行总门禁：

```bash
pnpm --filter @cfp/kith-inn-v1-shared test
pnpm --filter @cfp/cms test
pnpm --filter @cfp/kith-inn-v1-be test
pnpm --filter @cfp/kith-inn-v1-fe test
pnpm verify
```

H5 端到端测试必须无头运行，避免抢占本机浏览器：

```bash
CI=1 pnpm --filter @cfp/kith-inn-v1-fe test:e2e
```

微信小程序自动门禁执行现有 `build:weapp`；仓库当前没有独立 weapp smoke script。每个相关切片另做一次真机手工 smoke，按测试记录覆盖 `wx.login`、分享回调、query 恢复和禁止 Node-only 依赖，不为 M2 引入第二套 runner。

## 4. PR 门禁

- diff 中没有旧 `@cfp/kith-inn-*` 业务 package 修改。
- 没有新 workspace、collection、索引、运行进程或依赖，除非后续有独立 spec 明确批准。
- 没有 M3 对账/催款/状态批量管理增强，也没有 M4 AI 营销能力。
- PR 置为 ready for review 后只等待 base=main 的 Codex 自动 review；不重复评论触发。
- 每条 actionable comment 要么修复并回复，要么说明不采纳理由；重要 thread 全部 resolve 后才可合并。
