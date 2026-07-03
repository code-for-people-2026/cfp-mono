# 数据模型：kith-inn 菜品池 CRUD

## 实体：Offering（菜品池项）

`offerings` collection 里 `kind = "component"` 的菜。本 feature **不新增字段、不改 schema**——collection 已就绪。下方说明 M1 CRUD 视角下的字段角色。

### 现有字段（M1 CRUD 视角）

| 字段 | M1 角色 | 说明 |
|---|---|---|
| `id` | 系统赋值 | 编辑/删除/恢复的定位键；编辑保留 id（原地改） |
| `name` | **用户维护（必填）** | 新增/编辑表单字段；空值被拒（400） |
| `kind` | **系统强制 `component`** | cms POST 忽略请求体 kind，强制 `component`；菜品池只管 component |
| `mainIngredient` | **用户维护（可选）** | 新增/编辑表单字段；为空时分组归「其他」 |
| `category` | **用户维护（必填）** | 新增/编辑表单字段；限 `OFFERING_CATEGORIES`（meat/veg/soup/staple） |
| `priceCents` | 不在 M1 维护面 | 底层保留；M1 走 `sellers.defaultPriceCents` 兜底 |
| `tags` / `recipe` / `parentOfferings` / `unitLabel` / `lastUsedAt` / `useCount` | 不在 M1 维护面 | 底层保留；CRUD 不读不写 |
| `active` | **系统维护（删除/恢复切换）** | 删除 = `active=false`；恢复 = `active=true`；新增默认 true |
| `seller` | 系统钉死 | cms 从操作者 JWT 钉 sellerId，忽略请求体 |

### 写输入契约（M1，定义在 shared）

```ts
// 新增（POST 体）
offeringCreateSchema = { name: string(≥1); mainIngredient?: string; category: "meat"|"veg"|"soup"|"staple" }

// 编辑（PATCH 体）
offeringUpdateSchema = Partial<{ name: string(≥1); mainIngredient: string; category: "meat"|"veg"|"soup"|"staple" }>
```

- 两 schema 均 `z.object`（非 passthrough）——多余字段（priceCents/tags/recipe/kind/seller/id 等）被 zod 丢弃，构成 M1 写白名单。
- `category` 复用现有 `offeringCategorySchema = z.enum(OFFERING_CATEGORY_VALUES)`（`schemas.ts` 已定义，本 feature 将其 export 复用）。
- 由 `packages/kith-inn-shared/src/schemas.ts` 定义；`types.ts` 用 `z.infer` 推导 `OfferingCreate` / `OfferingUpdate`，不手写平行类型。

### 校验规则

- `name` 必填非空（新增/编辑均强制）；空 → 400。
- `category` 新增必填、取值限 `OFFERING_CATEGORIES`；非法/缺失 → 400。
- 编辑（PATCH）空请求体 → 400：`offeringUpdateSchema` 附 non-empty refine，在 strip 后拒绝 `{}`。
- 写白名单只接受 `name`/`mainIngredient`/`category`；其他字段即使在请求体里也被忽略（schema strip + cms handler 不传给 `payload.create/update`）。
- `kind` 由 cms POST 强制 `component`（忽略客户端值）；PATCH/DELETE/restore 不允许改 kind。
- `seller` 由 cms 从 JWT 钉死（`operatorScope` → `overrideAccess` + `stampSeller` hook），不取请求体。
- PATCH/DELETE/restore 必须命中当前 seller 的菜（find-then-update，跨租户 → 404）。

### 状态说明（active 软停用 / 恢复）

- `active` 是软停用标志：`true` = 在菜品池 + 菜单候选池；`false` = 已停用（移到「已停用」区、不进菜单候选，doc 仍在、引用方可读）。
- 删除 = `active: true → false`；恢复 = `false → true`。两者幂等。无独立 `deletedAt`。
- 本 feature 不引入新状态机、不新增 `cardStatus` 类字段。

## 读侧过滤（行为，非 schema）

- **菜品池页数据源（be `GET /offerings`）** = 所有 `kind === "component"` 的菜（含 `active=false`），每条带 `active` 标记 → FE 按 `active` 分「菜品池」(true) / 「已停用」(false) 两区。
- **菜单生成候选池** = `routes/menu.ts` 已有 `o.active !== false && o.kind === "component"` 过滤，本 feature 不改；软停用的菜自动被排除，恢复后自动回到候选。
- 域过滤在 **be 层**（`routes/offerings.ts` GET handler 只过滤 `kind`，与 `menu.ts` 同层但不重复其 active 过滤）；cms internal GET 保持 generic（按 seller 全量）。

## 迁移说明

- **无 schema 变更**：collection 字段已就绪；走 drizzle push（`payload.config.ts` `push:true`）。
- **无 ensureConstraints 变更**：offerings 无新增 partial-unique/复合索引（`mainIngredient` 已 `index:true` 由 push 管理）。
- **无 migration 文件**：仓库未部署、无 prod 数据（DATA-MODEL §7 / memory `migration-strategy-undeployeded-push`）。
- docs 同步：本 feature 改变 offerings 读行为（be 层 component 过滤、FE 分区）+ 明确 M1 CRUD 写面（含 category），同一 PR 内小步更新 `docs/kith-inn/DATA-MODEL.md` §3 offerings 说明（constitution 治理铁律）。
