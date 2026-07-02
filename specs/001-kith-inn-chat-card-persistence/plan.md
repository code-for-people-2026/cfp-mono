# 实施计划：kith-inn 聊天卡片持久化

**分支**: `001-kith-inn-chat-card-persistence` | **日期**: 2026-07-02 | **规格**: [spec.md](./spec.md)

**输入**: `specs/001-kith-inn-chat-card-persistence/spec.md`

## 摘要

把可见的 assistant `card` 快照随 assistant chat message 一起持久化，在聊天历史接口中返回，并让 Today page 在重开后把历史卡片恢复到原消息位置。保持功能边界很窄：不处理历史分页、留存 GC，也不实现 reload-safe 的 `customer-confirm` 动作状态。

## 技术上下文

**语言 / 版本**: TypeScript 5.9，Node.js 20 types，React 18 / Taro 4.2

**主要依赖**: Hono、Payload 3.85、Zod 4.4、Taro、NutUI

**存储**: 现有 Payload / Postgres `chat_messages` collection/table

**测试**: 各 package 使用 Vitest；仓库使用 pnpm + Turborepo

**目标平台**: kith-inn backend service、共享 Payload CMS、Taro miniapp/H5 frontend

**项目类型**: monorepo 功能，涉及 backend、frontend、shared schemas、Payload collection/migration

**性能目标**: 历史加载继续受现有 latest-message limit 约束；历史加载不调用 LLM / tool

**约束**: 保持 seller/operator 隔离；只持久化用户可见产物；不泄漏 raw tool calls 或 prompts

**规模 / 作用域**: 一条 assistant message 最多一张可见 card；本功能不扩展分页、GC 或状态机

## 当前实现事实

- `packages/kith-inn-shared/src/schemas.ts` 已定义 `cardPayloadSchema`，覆盖 `customer-confirm`、`orders` 和 `delivery`。
- `packages/kith-inn-shared/src/schemas.ts` 已定义 `chatMessageSchema`，字段包括 `id`、`operator`、`content`、`role`、`createdAt` 和 `seller`；还没有 `card`。
- `packages/kith-inn-payload/src/payload/collections/ChatMessages.ts` 定义了 Payload 字段 `operator`、`content`、`role` 和 `seller`；还没有 `card`。
- `apps/cms/src/payload/migrations/20260702_094007_kith_inn_order_fulfillment_model.ts` 创建的 `cms.chat_messages` 表还没有 card/json column。
- `apps/kith-inn-be/src/agent/run.ts` 返回 `{ reply, card? }`；当前 turn 的 tool output card 已经可用。
- `apps/kith-inn-be/src/routes/chat.ts` 的 `POST /chat` 返回 `{ reply, card }`，但只持久化 user text 和 assistant text。
- `apps/kith-inn-be/src/routes/chat.ts` 的 `GET /chat` 只把历史投影成 `id`、`role`、`content`、`createdAt`；没有返回 card。
- `apps/kith-inn-be/src/lib/cms/chat.ts` 的 `createChatMessage()` 只接受 `{ content, role }`。
- `apps/kith-inn-fe/src/pages/today/index.tsx` 已支持 `Msg.card`，并在消息有 card 时渲染 `<ChatCard />`。
- `apps/kith-inn-fe/src/components/ChatCard.tsx` 当前注释仍描述 cards 是 one-shot 且不持久化；`customer-confirm` 只要本地未 confirmed 就会显示可点击「都建」。

## 宪法检查

- **功能规格承载功能工作**: 通过。本功能有独立的 `specs/001-kith-inn-chat-card-persistence/` 目录。
- **Monorepo 作用域必须明确**: 通过。scope paths 已写在 `spec.md`。
- **先承认 Brownfield 事实**: 通过。当前实现事实已记录在上方。
- **最小可交付切片**: 通过。本功能只处理 card persistence 和 restoration。
- **验证和 Review 属于 Done**: 通过。检查项见 [quickstart.md](./quickstart.md)。
- **文档默认中文**: 通过。本功能的项目自有文档产物使用中文；工具模板和 API / 代码标识保持原文。

## 项目结构

### 文档（本功能）

```text
specs/001-kith-inn-chat-card-persistence/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-history.md
│   └── cms-chat-messages.md
└── checklists/
    └── requirements.md
```

### 源代码

```text
packages/kith-inn-shared/src/
├── schemas.ts
├── schemas.test.ts
└── types.ts

packages/kith-inn-payload/src/payload/collections/
└── ChatMessages.ts

apps/cms/src/payload/migrations/
└── <new kith-inn chat card migration>.ts

apps/kith-inn-be/src/
├── lib/cms/chat.ts
├── lib/cms/chat.test.ts
├── routes/chat.ts
└── routes/chat.test.ts

apps/kith-inn-fe/src/
├── components/ChatCard.tsx
└── pages/today/index.tsx
```

**结构决策**: 扩展现有 kith-inn chat 路径；不引入新的 persistence service、event log 或平行 chat history table。

## 复杂度跟踪

没有 constitution violations。
