# Quickstart: 营业预订与分享定位验收

## 自动化

```bash
pnpm --filter @cfp/kith-inn-v1-shared test
pnpm --filter @cfp/kith-inn-v1-be test
pnpm --filter @cfp/cms test
pnpm --filter @cfp/kith-inn-v1-fe test
pnpm verify
```

## 关键场景

1. 修改默认价，开放餐次后再改默认价，确认已开放餐次价格不变。
2. 混合选择有效和无效餐次批量开放，确认逐项结果及重复点击防重。
3. 标记整天/单餐打烊并取消；确认未设置隐藏、打烊可见，已有订单时写入被阻止。
4. 分别分享某天和某餐，确认微信卡片 payload 及公开 `batch` 路径。
5. 375×812 检查配置、部分失败、成功详情、历史、停止和归档状态；H5 自动化不得冒充真机分享验收。
