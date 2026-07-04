# 契约：CMS Internal Menu Plans（BE ↔ cms）

be → cms internal 调用，menu_plans 读写（本 feature 新增）+ 复用 service-slots/offerings/seller。每个调用 `x-kith-inn-operator` 带 operator JWT；cms 验签取 `sellerId` 钉租户（seller-token 透传，无 admin key，§3.1）。

## `GET /api/internal/menu-plans`（新增）

按日期范围 + seller 取 menu_plans（depth: slot + offerings）。

### 查询参数

`?from=2026-07-06&to=2026-07-10`（必填）。

### 规则

- `operatorScope` → sellerId。
- `where: { and: [{ seller: { equals: sellerId } }, { "slot.date": { greater_than_equal: from } }, { "slot.date": { less_than_equal: to } } ] }`（depth:1 populate slot→取 date；或查 slot 反查。实现按 Payload 能力选，**必须 seller-scoped**）。
- 200 `{ docs: MenuPlan[] }`（含 populated slot + offerings）。

### 响应

```json
{ "docs": [{ "id": 501, "slot": { "id": 91, "date": "2026-07-06", "occasion": "lunch", "status": "open" }, "offerings": [{ "id": 12, "name": "红烧牛肉", "category": "meat", "mainIngredient": "牛肉", "kind": "component" }], "publishText": null, "status": "published", "seller": 7 }] }
```

## `POST /api/internal/menu-plans/upsert`（新增）

按 (seller, slot) upsert menu_plan。body 是数组（一次发布多餐次）。

### 请求体

```json
[{ "slot": 91, "offerings": [12, 13], "status": "published" }]
```

### 规则

- `operatorScope` → sellerId。
- 每条：`payload.find({ collection:"menu_plans", where: { and: [{ slot: { equals: slot } }, { seller: { equals: sellerId } }] }, limit:1 })`。
  - 命中 → `payload.update({ id, data: { offerings, status }, overrideAccess:true })`。
  - 未命中 → `payload.create({ data: { slot, offerings, status, seller: sellerId }, overrideAccess:true })`。
- `slot` 必须属当前 seller（`ownedBy(payload, "service_slots", slot, sellerId)`，否则 403）—— slot 由 be 先经 `service-slots/upsert` 建/开，归属已验。
- `offerings[]` 每个验归属（`ownedBy(payload, "offerings", oid, sellerId)`），任一不属 → 403（防 depth 读穿，同 orders POST）。
- 200 `{ docs: MenuPlan[] }`（upsert 后的）。

## `PATCH /api/internal/menu-plans/:id`（新增）

更新 publishText（M1 只此字段）。find-then-update 跨租户 404。

### 请求体

```json
{ "publishText": "街坊们～明天…" }
```

### 规则

- `operatorScope` → sellerId。
- `payload.find({ collection:"menu_plans", where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] }, limit:1 })`，无命中 → 404。
- `payload.update({ id, data: { publishText }, overrideAccess:true })`（白名单只接受 publishText，M1）。
- 200 `{ doc: MenuPlan }`。

## 复用（既有，本 feature 不改）

- **`POST /api/internal/service-slots/upsert`**：publish 时开餐（archived→409、draft→open、缺→create open）。body `[{date, occasion, granularity:"occasion"}]`。
- **`GET /api/internal/offerings`**：swap 时取池子（generic，be 过滤 active+component）。
- **`GET /api/internal/seller`**：publish-text 时取 sellerName + defaultPriceCents。

## 跨进程一致性

- 所有写经 Payload（hooks/access 生效），be 不直连 DB 写裸 SQL（TECH-SPEC §2）。
- `assertSameTenantRefs` 在 menu_plan create/update 时校验 slot + offerings relationship 同租户（兜底 handler 内 ownedBy）。
- cms 路由 handler 是薄 glue（复用 `operatorScope`/`ownedBy`/`payload.*`），不进 line-coverage；契约由 be 侧 mocked-fetch 客户端单测覆盖（同 feature 002 / issue #110 既定分层）。
