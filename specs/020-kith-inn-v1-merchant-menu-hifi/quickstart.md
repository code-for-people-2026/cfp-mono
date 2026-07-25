# 快速验证：商家本周菜单高保真工作区

## 自动化检查

```bash
pnpm --filter @cfp/kith-inn-v1-fe lint
pnpm --filter @cfp/kith-inn-v1-fe typecheck
pnpm --filter @cfp/kith-inn-v1-fe test:coverage
pnpm --filter @cfp/kith-inn-v1-fe test:e2e -- tests/e2e/merchant.spec.ts
pnpm --filter @cfp/kith-inn-v1-fe build
BE_BASE_URL=https://codeforpeople.cn pnpm verify
```

## 功能验收

1. 在上海业务周的周一至周四、周五至周日两类时间输入下验证默认周和默认日期。
2. 快速切换上一周、下一周，确认最后选择获胜；切换工作日不产生新的周查询。
3. 对空周生成十个餐次，对部分周只补缺失目标，对已有草稿核对覆盖目标和取消行为。
4. 在菜品池不足时核对分类缺口和零写入；在规则放宽时核对菜单完整且说明可读。
5. 选择一道菜执行替换，核对另外四道不变；无候选时原菜单不变。
6. 从餐次进入预订配置，返回后核对当前周、价格、截止时间和状态刷新。
7. 对 `open`（包括已截止）和 `closed` 餐次确认前端不显示换菜或重新生成，直接调用服务端也被拒绝；截止时间已过的 `draft` 仍可编辑并显示待设置。

## 视觉验收

1. 使用仓库内 Page 3 PNG/HTML，在 354×786 视口核对顶部、周标题、五日日期条、午晚餐卡片、动态 CTA 和底部导航。
2. 验证长菜名、空餐次、错误提示、覆盖层、换菜层和菜品池不足状态无横向溢出。
3. 滚动到底后确认晚餐卡片、固定 CTA 与安全区导航均可访问且互不遮挡。
4. 浏览器 console 无新增 warning/error；微信小程序构建成功。真机视觉另行记录，不由 H5 自动化替代。
