# 快速验证：kith-inn 聊天卡片持久化

## 自动化检查

运行本功能相关的窄检查：

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-payload test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-fe test
```

预期结果：

- shared schema tests 覆盖有 card / 无 card 的 chat messages。
- 添加 nullable card 字段后，Payload tests 继续通过。
- backend chat tests 证明 `POST /chat` 会持久化 assistant card，`GET /chat` 会返回安全的 card payload。
- frontend tests 或 component-level coverage 证明历史消息恢复 card 后可以渲染，缺失 card 时不崩溃。

## 手动冒烟测试

1. 登录 kith-inn。
2. 在 Today page 问一个会返回 orders 或 delivery card 的问题。
3. 关闭 / 重开或刷新 Today page。
4. 确认之前的 assistant 文本和 card 都出现在同一个对话位置。
5. 确认没有发送新消息，也没有重新生成 AI response。

## 明确不做

- 本功能不增加 chat pagination 或 retention GC。
- 本功能不增加持久化 `customer-confirm` action state。
- 本功能不在历史里暴露 raw tool calls、system prompts 或 LLM traces。
