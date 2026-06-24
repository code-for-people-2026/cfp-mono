# 2026-duanwu-booth-assistant

> **⚠️ 已归档（ARCHIVED）。** 这是一次性线下活动（2026 端午）的 H5 app，活动已结束。
> 代码保留作参考，但**已从 workspace 中移除**（见 `pnpm-workspace.yaml` 的排除项），
> 不再参与 `pnpm install` / `turbo` 构建 / CI，也已从 Vercel 下线（删除了 `vercel.json`）。
> 如需恢复：去掉 `pnpm-workspace.yaml` 里对应的 `!apps/...` 排除项即可。

一次性线下活动 H5 app，用于在摊主忙碌时帮助围观者、等待者和不方便当面开口的人了解“为工友敲键盘”的摊位理念。

这是 `cfp-mono` 里的活动对话助手 app，原型来自 `data-equality-booth-assistant`。

本地启动：

```bash
pnpm --filter 2026-duanwu-booth-assistant dev
```

默认端口是 `3303`。运行对话接口需要在本地 `.env` 里配置 `DEEPSEEK_API_KEY`，可选配置 `DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL`。
