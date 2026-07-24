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

## 实际验收结果

### 自动化与跨端构建

- `pnpm --filter @cfp/kith-inn-v1-fe lint`：通过。
- `pnpm --filter @cfp/kith-inn-v1-fe typecheck`：通过。
- `pnpm --filter @cfp/kith-inn-v1-fe build`：H5 与微信小程序均构建成功；H5 仅保留既有 entrypoint size warning。
- `pnpm --filter @cfp/kith-inn-v1-fe test:e2e -- tests/e2e/merchant.spec.ts tests/e2e/jielong-import.spec.ts`：19 项全部通过，用时 26.9 秒。

### 354×786 浏览器视觉验收

- 默认态：页面与文档宽度均为 354px，菜品卡宽 318px，未出现横向溢出；四个筛选、分类标识、菜名、主料、开关和底部导航均可读。
- 管理态：固定新增按钮位于 `676–720px`，底部导航位于 `727.5–786px`，两者没有重叠；长菜名与主料在 125px 文本区内省略，编辑按钮与开关前仍分别保留约 11px 和 18px 间距。
- 新增/编辑弹层：底部 sheet 完整落在视口内，标题、两个输入框、分类按钮、取消和提交按钮均可见；空名称时的 disabled 提交文案仍可辨认。
- 批量导入态：文本框和 disabled 预览按钮可读；长列表滚动容器为 `786/1075px`（可视高度/内容高度），滚到底后最后分组与固定新增按钮仍有约 54px 间距。
- 浏览器 console 无 warning 或 error；默认态、管理态、导入态和新增/编辑弹层均未出现关键操作被固定区域永久遮挡。
