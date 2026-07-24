# 快速验证：商家菜品库高保真重构

## 自动化检查

```bash
pnpm --filter @cfp/kith-inn-v1-fe lint
pnpm --filter @cfp/kith-inn-v1-fe typecheck
pnpm --filter @cfp/kith-inn-v1-fe test:coverage
pnpm --filter @cfp/kith-inn-v1-fe test:e2e -- tests/e2e/merchant.spec.ts tests/e2e/jielong-import.spec.ts
pnpm --filter @cfp/kith-inn-v1-fe build
```

## 手工视觉验证

1. 按 `apps/kith-inn-v1-fe/playwright.config.ts` 的 CMS、backend、frontend 环境变量启动本地服务。
2. 在 354×786 视口开发登录并进入“菜品”。
3. 核对默认态的标题、筛选、四张首屏卡、固定新增按钮和底部导航。
4. 进入管理态，验证长菜名、编辑按钮、开关、批量导入及空/disabled 状态可读。
5. 打开新增和编辑弹层，确认键盘区域外仍能取消或提交。

## 正确性验证

- 让不同菜品启停请求乱序返回，确认彼此不提前解锁且最终状态独立。
- 编辑列表中间菜品，确认其他菜品顺序不变。
- 在预览请求期间修改导入文本，确认旧预览不出现且无法按旧行号提交覆盖。
