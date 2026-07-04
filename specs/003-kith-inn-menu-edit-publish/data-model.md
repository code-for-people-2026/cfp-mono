# 数据模型：kith-inn 菜单换菜 + 发群文案（持久化）

本 feature **不新增字段、不改 schema**——`menu_plans` / `service_slots` / `offerings` collection 已就绪。下方说明 M1 视角下 menu_plan 的字段角色与写路径。

## 实体：MenuPlan（已发布菜单项）

`menu_plans` collection 里 status=published 的记录（M1 只写 published）。

### 现有字段（M1 视角）

| 字段 | M1 角色 | 说明 |
|---|---|---|
| `id` | 系统赋值 | publish-text / 复制文案的定位键 |
| `slot` | **发布时 upsert 钉** | → 当餐次 `service_slot`（seller, date, occasion）；发布经 cms `service-slots/upsert`→open |
| `offerings[]` | **发布时写** | → 当餐次的 dishes（component offering ids） |
| `publishText?` | **按需写** | 初次「复制文案」时由 `publishMenuText` 生成并 PATCH 写回；二次复制读缓存 |
| `status` | **系统写 `published`** | M1 只 published；draft 字段保留不启用 |
| `seller` | 系统钉死 | cms 从 JWT 钉 sellerId |

### 写路径（M1）

- **upsert（publish）**：`POST /api/internal/menu-plans/upsert`，body `{slot, offerings, status:"published"}`，按 `(seller, slot)` find-then-upsert（已存在→update offerings/status；缺→create）。seller 从 JWT 钉。
- **PATCH publishText**：`PATCH /api/internal/menu-plans/:id`，body `{publishText}`，find-then-update（跨租户 404）。
- **GET**：`GET /api/internal/menu-plans?from=&to=`，seller-scoped，depth: slot + offerings。

### 校验规则

- publish 的 `slot` 必须是当前 seller 的 service_slot（cms `service-slots/upsert` 先建/开 slot，再写 plan 引用）。
- `offerings[]` 引用的 offering 必须属当前 seller（be 在 publish 前从池子取 id，天然满足；cms `assertSameTenantRefs` hook 兜底）。
- PATCH publishText 跨租户 → 404。
- archived slot → publish 409（service-slots/upsert 守卫）。

### 状态说明

- M1：menu_plan 只有 `published` 一种状态。发布即 published；无 draft 中间态。
- 重新发布（upsert）覆盖 offerings（等价于「改了再发」）。
- 不物理删 menu_plan（M1 无删除需求；清理 defer）。

## 实体：ServiceSlot（发布即开餐）

`service_slots` 现有，本 feature 不改。publish 时对当周每个 (date, occasion) 调既有 `POST /api/internal/service-slots/upsert`：draft→open、缺→create open、**archived→409 上抛**（M1 报错，force/二次确认 defer）。复用订单确认那条路径，无新逻辑。

## 契约：Swap / Published（M1 新增，定义在 shared）

```ts
// POST /menu/swap 请求
swapMenuRequestSchema = {
  menu: MenuSlot[],                         // FE 当前持有的周菜单（含已换的）
  target: { day: "mon".."fri"; occasion: "lunch"|"dinner"; dishId: id },
  replacementId?: id,                        // 不带 → auto(swapDish)；带 → 指定(swapDishSpecified)
}

// POST /menu/swap 响应（成功）—— be 无状态，FE 用 applySwap 应用
{ replacement: MenuDish, warning?: string }   // warning 仅指定换 + 主料避重冲突时
// 或失败
{ ok: false, reason: "slot-not-found"|"dish-not-in-slot"|"no-alternative"|"replacement-not-in-pool"|"replacement-same-as-target" }

// GET /menu/published?date= 响应
publishedMenuSchema = {
  published: Array<{ date: string; occasion: "lunch"|"dinner"; planId: id; dishes: MenuDish[]; publishText?: string }>,
}

// POST /menu/plans/:id/publish-text 响应
{ publishText: string }
```

- 由 `packages/kith-inn-shared/src/schemas.ts` 定义；`types.ts` 用 `z.infer` 推导（`SwapMenuRequest`/`SwapMenuResponse`/`PublishedMenu`/`PublishedSlot`/`PublishTextResponse`）。
- `menu: MenuSlot[]` 复用现有 `menuSlotSchema`；`MenuDish` 复用现有。

## 迁移说明

- **无 schema 变更**：collection 字段已就绪；走 drizzle push（`payload.config.ts` `push:true`）。
- **无 ensureConstraints 变更**：menu_plans / service_slots 无新增 partial-unique/复合索引（`slot` 已 `index`、`(seller,date,occasion)` unique 已由 ensureConstraints 管）。
- **无 migration 文件**：仓库未部署、无 prod 数据。
- docs 同步：本 feature 改变 menu_plans 写行为（首次有 M1 写路径）+ 菜单 tab 行为，同一 PR 内更新 `docs/kith-inn/DATA-MODEL.md` §4 menu_plans 说明（constitution 治理铁律）。
