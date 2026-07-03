# 契约：CMS Internal Offerings（BE ↔ cms）

be → cms internal 调用，菜品池读写。每个调用在 `x-kith-inn-operator` 头携带 operator JWT；cms 验签后从 JWT 取 `sellerId` 钉租户（seller-token 透传，无 admin key，TECH-SPEC §3.1）。形状是 be↔cms 内部契约（cms 用 `overrideAccess` 写、触发 collection 的 `stampSeller`/`assertSameTenantRefs` hook）。

## `GET /api/internal/offerings`（已有，不变）

generic 原始读：按 seller 全量返回（不过滤 active/kind——域过滤在 be 层做）。

### 响应

```json
{ "docs": [ { "id": 12, "name": "番茄炒蛋", "kind": "component", "mainIngredient": "鸡蛋", "category": "veg", "active": true, "seller": 7 } ] }
```

## `POST /api/internal/offerings`（新增）

新增一道 component 菜。

### 请求体

```json
{ "name": "蒜蓉空心菜", "mainIngredient": "青菜", "category": "veg" }
```

### 规则

- 入口用 shared `offeringCreateSchema` 校验：`name` 必填非空、`category` 必填（限 meat/veg/soup/staple，否则 400），`mainIngredient` 可选；多余字段丢弃。
- `operatorScope(req)` 取 `sellerId`；`payload.create` 用 `overrideAccess:true`：
  - `kind: "component"`（**强制**，忽略请求体 kind）
  - `active: true`
  - `seller: sellerId`（从 JWT，不取请求体——`stampSeller` hook 双保险）
  - `name`/`mainIngredient`/`category` 来自请求体
  - 不设 priceCents/tags/recipe/parentOfferings（M1 白名单）。
- 201 返回 `{ doc }`（doc 为新建的 Offering）。

### 响应（201）

```json
{ "doc": { "id": 16, "name": "蒜蓉空心菜", "kind": "component", "mainIngredient": "青菜", "category": "veg", "active": true, "seller": 7 } }
```

## `PATCH /api/internal/offerings/:id`（新增）

原地改 name / mainIngredient / category。

### 请求体

```json
{ "name": "西红柿炒蛋", "mainIngredient": "番茄", "category": "veg" }
```

（部分字段皆可）

### 规则

- 入口用 shared `offeringUpdateSchema` 校验：只接受 `name?`/`mainIngredient?`/`category?`；schema 的 non-empty refine 在 strip 后拒绝空对象 → 400；`name` 给了须非空、`category` 给了须合法。
- find-then-update 确认归属：先 `payload.find({ where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] } })`（与 `orders/[id]` 同形），无命中 → 404（跨租户不暴露存在性）。
- `payload.update({ id, data: <白名单 patch>, overrideAccess:true })`；不传 kind/active/其他字段。
- 200 返回更新后的 `{ doc }`。

### 响应（200）

```json
{ "doc": { "id": 12, "name": "西红柿炒蛋", "kind": "component", "mainIngredient": "番茄", "category": "veg", "active": true, "seller": 7 } }
```

## `DELETE /api/internal/offerings/:id`（新增）

软停用（`active=false`），不物理删。

### 规则

- find-then-update：先 `payload.find({ where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] } })`，无命中 → 404。
- `payload.update({ id, data: { active: false }, overrideAccess:true })`。
- 已 `active=false` 仍返回 200（幂等）。

### 响应（200）

```json
{ "ok": true }
```

## `POST /api/internal/offerings/:id/restore`（新增）

恢复（`active=true`）。

### 规则

- find-then-update：先 `payload.find({ where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] } })`，无命中 → 404。
- `payload.update({ id, data: { active: true }, overrideAccess:true })`。
- 已 `active=true` 仍返回 200（幂等）。
- **路由文件**：`POST /api/internal/offerings/:id/restore` 是独立路径段，handler 在 `apps/cms/src/app/api/internal/offerings/[id]/restore/route.ts`（不能塞进 `[id]/route.ts`，否则 Next.js App Router 命中不到）。

### 响应（200）

```json
{ "ok": true }
```

## 跨进程一致性

- 所有写都经 Payload（hooks/access 生效），be 不直连 DB 写裸 SQL（TECH-SPEC §2）。
- `assertSameTenantRefs` 在 create 时也会跑（offerings 的 relationship 字段如 parentOfferings 若被设会校验同租户；M1 create 不设 parentOfferings，无影响）。
- cms 路由 handler 是薄 glue（复用 `operatorScope`/`ownedBy`/`payload.*`），不持有独立逻辑分支；契约正确性由 be 侧 mocked-fetch 客户端单测覆盖（`apps/cms` 的 vitest 仅含 `tests/**`，路由 handler 不在 line-coverage 范围）。
- **已知缺口（开 issue 跟踪）**: cms 写 route 用 `overrideAccess` 写（无 `req.user`），跨租户 404 靠 handler 内手动 `where:{seller}` + find-then-update，无自动化断言；be 测试 mock 掉 cms 验不到。是否补真实 postgres 多租户隔离测试，见 issue。
