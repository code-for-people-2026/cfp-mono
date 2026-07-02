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
- backend chat tests 证明 `POST /chat` 会持久化 assistant card，`GET /chat` 会返回符合 `CardPayload` contract 的 card payload；无法解析的历史 card 只返回 `cardUnavailable: true`。
- frontend pure logic tests 证明历史/过期 `customer-confirm` card 只读，当前会话最后一张确认卡可操作，text-only / missing-card 消息不产生 action state。

2026-07-03 已运行结果：

- `pnpm --filter @cfp/kith-inn-shared test`：通过，15 tests。
- `pnpm --filter @cfp/kith-inn-payload test`：通过，49 tests。
- `pnpm --filter @cfp/kith-inn-be test`：通过，261 tests。
- `pnpm --filter @cfp/kith-inn-fe test`：通过，41 tests。
- `pnpm verify`：通过；lint/build 阶段仍有既有 warning，但未阻断门禁。

## 手动冒烟测试

1. 登录 kith-inn。
2. 在 Today page 问一个会返回 orders 或 delivery card 的问题。
3. 关闭 / 重开或刷新 Today page。
4. 确认之前的 assistant 文本和 card 都出现在同一个对话位置。
5. 确认没有发送新消息，也没有重新生成 AI response。
6. 如果恢复的是新顾客确认卡，确认它显示为历史/过期卡，不提供可执行的“全部建档并记单”动作，并提示需要重新识别接龙生成新的确认卡。
7. 如果历史 card 数据不符合当前 `CardPayload` contract，确认原始对话仍显示，并在原位置显示“卡片数据已过期”占位。

## 明确不做

- 本功能不增加 chat pagination 或 retention GC。
- 本功能不增加持久化 `customer-confirm` action state；历史/过期确认卡只读展示。
- 本功能不在历史里暴露 raw tool calls、system prompts 或 LLM traces。
