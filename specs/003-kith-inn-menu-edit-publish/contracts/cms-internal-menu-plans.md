# 契约：CMS Internal Menu Plans（BE ↔ cms）

be → cms internal，menu_plans 读写（新增）+ ensure-slot。`x-kith-inn-operator` 带 JWT；cms 验签取 sellerId 钉租户（无 admin key）。

## `GET /api/internal/menu-plans`（新增）

按日期范围 + seller 取 menu_plans（depth: slot + offerings）。

`?from=2026-07-06&to=2026-07-10`（必填）。

- `operatorScope` → sellerId；`where: { and: [{ seller:{equals:sellerId} }, { "slot.date":{gte:from} }, { "slot.date":{lte:to} } ] }`（或先查 service_slots 再按 slot 反查，按 Payload 能力选）；`depth:1`、`limit:0`、`overrideAccess:true`。
- 200 `{ docs: MenuPlan[] }`（populated slot + offerings）。

## `GET /api/internal/menu-plans/:id`（新增）

按 id + seller 读单条（depth）。`payload.find({ where:{and:[{id:{equals:id}},{seller:{equals:sellerId}}]}, depth:1, limit:1 })`，无命中→404。200 `{doc}`。

## `POST /api/internal/menu-plans/upsert`（新增）

批量 upsert（generate 用）。body `Array<{date, occasion, offerings:[ids], status:"draft"}>`。

每条：
1. **ensure slot**：`payload.find({collection:"service_slots", where:{and:[{seller:{equals:sellerId}},{date:{equals:date}},{occasion:{equals:occasion}}]}})`；命中→用既有（**不动 status**）；未命中→`payload.create({date, occasion, granularity:"occasion", status:"draft", seller})`。
2. **upsert plan** by (seller, slot)：find 命中→`payload.update({id, data:{offerings, status}, overrideAccess:true})`；未命中→`payload.create({slot, offerings, status, seller, overrideAccess:true})`。
3. `offerings[]` 每个经 `ownedBy` 验归属（不属→403）。
- 依赖 `menu_plans (seller, slot)` **唯一索引**（ensureConstraints，见 data-model 迁移）兜底并发竞态——两请求同 target 并发 find-then-create 时第二个被唯一约束拒（M1 单操作者无并发，索引作不变量保险）。
- 200 `{ docs: MenuPlan[] }`。

> **只此处建 slot 且只建 draft；不改既有 slot.status**（开餐归订单确认）。

## `PATCH /api/internal/menu-plans/:id`（新增）

改 status / publishText / offerings（swap/publish 用，find-then-update 跨租户 404）。body 白名单 `{status?, publishText?, offerings?}`。

- `payload.find({ where:{and:[{id:{equals:id}},{seller:{equals:sellerId}}]}, limit:1 })`，无命中→404。
- **若 patch 含 `offerings`：每个 id 经 `ownedBy(payload,"offerings",oid,sellerId)` 验归属（不属→403）**——overrideAccess 写无 `req.user`，`assertSameTenantRefs` 不触发，必须手验防别租户 offering 写入 + depth 读泄漏（Codex #115 P1）。
- `payload.update({id, data:<白名单>, overrideAccess:true})`。
- 200 `{doc}`。

## 复用（既有）

`GET /api/internal/offerings`（取池子）、`GET /api/internal/seller`（sellerName/priceCents 用于接龙文案）。本 feature **不**调 `service-slots/upsert`（菜单不开餐）。

## 跨进程一致性

写经 Payload（hooks/access 生效），be 不裸 SQL。`assertSameTenantRefs` 兜底 slot/offerings 同租户。cms route handler 是 glue（不进 line-coverage），契约由 be mocked-fetch 客户端单测覆盖（同 feature 002 / #110）。
