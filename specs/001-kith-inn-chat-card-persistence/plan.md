# Implementation Plan: kith-inn Chat Card Persistence

**Branch**: `001-kith-inn-chat-card-persistence` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-kith-inn-chat-card-persistence/spec.md`

## Summary

Persist the visible assistant `card` snapshot with the assistant chat message, return it from chat history, and let the Today page render restored cards inline after reload. Keep this feature narrow: do not add history pagination, retention GC, or reload-safe `customer-confirm` execution.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20 types, React 18/Taro 4.2

**Primary Dependencies**: Hono, Payload 3.85, Zod 4.4, Taro, NutUI

**Storage**: Existing Payload/Postgres `chat_messages` collection/table

**Testing**: Vitest per package; repo uses pnpm + Turborepo

**Target Platform**: kith-inn backend service, shared Payload CMS, Taro miniapp/H5 frontend

**Project Type**: Monorepo feature touching backend, frontend, shared schemas, Payload collection/migration

**Performance Goals**: History load remains bounded by the existing latest-message limit; no LLM/tool call on history load

**Constraints**: Preserve seller/operator isolation; persist only visible assistant artifacts; do not leak raw tool calls or prompts

**Scale/Scope**: One visible card per assistant message; no pagination/GC/state-machine expansion in this feature

## Current Implementation Facts

- `packages/kith-inn-shared/src/schemas.ts` already defines `cardPayloadSchema` for `customer-confirm`, `orders`, and `delivery`.
- `packages/kith-inn-shared/src/schemas.ts` defines `chatMessageSchema` with `id`, `operator`, `content`, `role`, `createdAt`, and `seller`; it has no `card`.
- `packages/kith-inn-payload/src/payload/collections/ChatMessages.ts` defines Payload fields `operator`, `content`, `role`, and `seller`; it has no `card`.
- `apps/cms/src/payload/migrations/20260702_094007_kith_inn_order_fulfillment_model.ts` creates `cms.chat_messages` without a card/json column.
- `apps/kith-inn-be/src/agent/run.ts` returns `{ reply, card? }`; tool output card is already available for the current turn.
- `apps/kith-inn-be/src/routes/chat.ts` `POST /chat` returns `{ reply, card }`, but persists only user text and assistant text.
- `apps/kith-inn-be/src/routes/chat.ts` `GET /chat` projects history to `id`, `role`, `content`, `createdAt`; it omits cards.
- `apps/kith-inn-be/src/lib/cms/chat.ts` `createChatMessage()` accepts only `{ content, role }`.
- `apps/kith-inn-fe/src/pages/today/index.tsx` already supports `Msg.card` and renders `<ChatCard />` when a message has a card.
- `apps/kith-inn-fe/src/components/ChatCard.tsx` currently says cards are one-shot and not persisted; `customer-confirm` always shows an actionable「都建」button unless locally confirmed.

## Constitution Check

- **Feature specs own feature work**: PASS. This feature has its own `specs/001-kith-inn-chat-card-persistence/` directory.
- **Monorepo scope is explicit**: PASS. Scope paths are listed in `spec.md`.
- **Brownfield reality first**: PASS. Current implementation facts are recorded above.
- **Smallest shippable slice**: PASS. This feature is card persistence and restoration only.
- **Verification and review are part of done**: PASS. Checks are listed in [quickstart.md](./quickstart.md).

## Project Structure

### Documentation (this feature)

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

### Source Code

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

**Structure Decision**: Extend existing kith-inn chat paths. Do not introduce a new persistence service, event log, or parallel chat history table.

## Complexity Tracking

No constitution violations.
