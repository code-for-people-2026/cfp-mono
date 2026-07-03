# 实施计划：kith-inn 菜品池 CRUD

**分支**: `002-kith-inn-dish-pool-crud` | **日期**: 2026-07-03 | **规格**: [spec.md](./spec.md)

**输入**: `specs/002-kith-inn-dish-pool-crud/spec.md`

## 摘要

把菜品池页（kitchen）从只读变为可增删改 + 恢复：新增/编辑收菜名 + 主料 + 分类（荤/素/汤/主食，评审决定录入带分类），删除 = 软停用 `active=false`、恢复 = `active=true`。写路径经 cms internal API（复用 `operatorScope` + `ownedBy`），BE 层对菜品池读过滤 `kind=component`（保留 active+inactive 供 FE 分「菜品池/已停用」两区），不改 offerings collection schema、不改菜单内核。

## 技术上下文

**语言 / 版本**: TypeScript 5.9，Node.js 20 types，React 18 / Taro 4.2

**主要依赖**: Hono、Payload 3.85、Zod 4.4、Taro、NutUI React

**存储**: 现有 Payload / Postgres `offerings` collection（字段已就绪，本 feature 不改 schema）

**测试**: 各 package 用 Vitest；仓库用 pnpm + Turborepo。注意 `apps/cms` 的 vitest 仅含 `tests/**`（cms 是薄 host，路由 handler 是 glue，不在 line-coverage 范围；100% 逻辑落在 shared / payload 包 / be / fe-logic）。

**目标平台**: kith-inn backend、共享 Payload CMS、Taro miniapp/H5 frontend

**项目类型**: monorepo 功能，涉及 backend、frontend、shared schemas、cms internal route

**约束**: 保持 seller/operator 隔离；写不绕过 Payload；M1 表单只暴露 name + mainIngredient

**规模 / 作用域**: offerings 字段不动；新增 1 个 shared 写 schema 对、1 个 cms 写 route（POST/PATCH/DELETE）、1 个 be cms 客户端模块、be 路由扩写、fe 逻辑 + kitchen 页 UI。

## 当前实现事实（Brownfield）

- **`packages/kith-inn-payload/src/payload/collections/Offerings.ts`**：collection 字段已就绪——`name`(required)、`kind`(select，default `"component"`, required)、`mainIngredient`(text, index)、`category`(select meat/veg/soup/staple)、`parentOfferings`(自关联 hasMany)、`unitLabel`、`priceCents`、`tags`(json)、`lastUsedAt`、`useCount`、`recipe`(json)、`active`(checkbox default true)、`seller`(rel required)。`access: tenantAccess`、`hooks: tenantHooks`（`stampSeller` + `assertSameTenantRefs`）。
- **`packages/kith-inn-shared/src/schemas.ts`**：已有完整实体 `offeringSchema`（含 id/kind/category/.../active/seller）；**没有**写专用 schema（create/update）。`enums.ts` 的 `OFFERING_KINDS` 含 `"component"`，`OFFERING_CATEGORIES` = meat/veg/soup/staple。
- **`apps/cms/src/app/api/internal/offerings/route.ts`**：**只有 GET**。验 `x-kith-inn-operator` JWT → `where: { seller: { equals } }`、`overrideAccess`、`limit:0` → `{docs}`。**无 active/kind 过滤、无 POST/PATCH/DELETE**。
- **`apps/cms/src/lib/internal.ts`**：已有 `operatorScope(req)`（验 JWT → `{sellerId, operatorId, payload}`）和 `ownedBy(payload, collection, id, sellerId)`——orders 写 route 已复用，本 feature 直接复用。
- **`apps/kith-inn-be/src/routes/offerings.ts`**：**只有 GET**。`offeringsRoutes(jwtSecret, deps={findOfferings})`，`sellerAuth`，转发 token 到 cms，返回 `{offerings}`。已在 `app.ts` 挂载 `/offerings`。**GET 未过滤 active/kind**。
- **`apps/kith-inn-be/src/lib/cms/client.ts`**：`findOfferings(jwt)` → cms GET（generic 原始读，未过滤）。`OPERATOR_JWT_HEADER = "x-kith-inn-operator"`、`cmsBase()`、`CmsDeps`。
- **`apps/kith-inn-be/src/routes/menu.ts`**：**已在 BE 层过滤** `o.active !== false && o.kind === "component"` 再 `toMenuDish` → `generateWeekMenu`。本 feature 的「读侧过滤」与之同构，放 be 层。
- **`apps/kith-inn-be/src/domain/menu/core.ts`**：`toMenuDish(o)` 里 `category: (o.category ?? "veg")`——brownfield 兜底。本 feature 不改 core；改为让**用户在表单录入 category**（评审拍板，反转早先推断方案），cms POST/PATCH 把用户选的 category 落进 doc，使新菜进入 core 时已有正确荤素（见 spec Clarifications）。
- **`apps/kith-inn-fe/src/pages/kitchen/index.tsx`**：**只读**。`useEffect` 拉 `offeringsUrl()` → `groupByMainIngredient` → 按「主料 · X」分组渲染。无 active/kind 过滤、无 CRUD UI。
- **`apps/kith-inn-fe/src/logic/groupByMainIngredient.ts`**：纯函数已有（无 mainIngredient 归「其他」）。
- **`apps/kith-inn-fe/src/services/api.ts`**：有 `offeringsUrl()`；无 create/update/delete URL 构造。
- **`apps/cms/vitest.config.ts`**：`include: ["tests/**/*.test.ts"]`——cms 路由 handler 不在单测/line-coverage 范围（注释明说 cms 是薄 host，100% 逻辑在 `@cfp/kith-inn-payload`）。
- **`apps/cms/src/db/ensureConstraints.ts`**：offerings 无 partial-unique/复合索引需要（`mainIngredient` 已 `index:true` 由 push 管理）。本 feature 不改 ensureConstraints。
- **seed**：`apps/cms/seed/run.ts` → `taoziFixture`，菜为 component、active 默认 true。改 schema 后 re-seed：`DROP SCHEMA cms CASCADE` + `pnpm --filter @cfp/cms seed`（本 feature 不改 schema，通常无需 re-seed）。
- **FK 现实**：`order_items.offering`、`menu_plans.offerings[]`、`offerings.parentOfferings` 引用 offerings → postgres FK `ON DELETE NO ACTION` → 物理删被引用菜会抛错 → 本 feature 用软停用规避。

## 宪法检查

- **I. 功能规格承载功能工作**: 通过。独立 `specs/002-kith-inn-dish-pool-crud/` 目录。
- **II. Monorepo 作用域必须明确**: 通过。scope paths 写在 `spec.md`。
- **III. 先承认 Brownfield 事实**: 通过。上方「当前实现事实」已记录。
- **IV. 最小可交付切片**: 通过。只做菜品池 name+mainIngredient 的 CRUD + 软停用；combo/recipe/批量导入/agent 工具/恢复 deferred。
- **V. 验证和 Review 属于 Done**: 通过。检查项见 [quickstart.md](./quickstart.md)。
- **VI. 文档默认中文**: 通过。

## 项目结构

### 文档（本功能）

```text
specs/002-kith-inn-dish-pool-crud/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── be-offerings-api.md
│   └── cms-internal-offerings.md
└── checklists/
    └── requirements.md
```

### 源代码

```text
packages/kith-inn-shared/src/
├── schemas.ts          # + offeringCreateSchema / offeringUpdateSchema（含 category）；export offeringCategorySchema
├── schemas.test.ts     # + 写 schema 用例
└── types.ts            # + OfferingCreate / OfferingUpdate 推导

apps/cms/src/app/api/internal/offerings/
├── route.ts            # + POST（GET 不变）
└── [id]/route.ts       # 新文件：PATCH / DELETE / POST restore（参考 orders/[id]/route.ts）

apps/kith-inn-be/src/
├── lib/cms/
│   ├── offerings.ts    # 新文件：createOffering/updateOffering/deactivateOffering/restoreOffering
│   └── offerings.test.ts
├── routes/
│   ├── offerings.ts    # GET 过滤 kind=component（保留 active）；+ POST / PATCH /:id / DELETE /:id / POST /:id/restore
│   └── offerings.test.ts

apps/kith-inn-fe/src/
├── services/api.ts             # + offeringDetailUrl(id)
├── logic/
│   ├── offeringsCrud.ts        # 新文件：create/update/deactivate/restore + partitionByActive（可注入 request）
│   └── offeringsCrud.test.ts
└── pages/kitchen/index.tsx     # + 新增/编辑/删除 + 「已停用」区/恢复 UI
```

**结构决策**: 扩展现有 offerings 链路（collection 不动）；写客户端独立成 `lib/cms/offerings.ts`（与 `lib/cms/orders.ts` 同构）；fe CRUD 逻辑抽进 `logic/offeringsCrud.ts`（保证 100% 覆盖，UI 交 e2e）。

## 复杂度跟踪

无 constitution violations。本 feature 非平凡点：① category 由用户录入（评审反转推断方案，落 shared `offeringCreateSchema`/`offeringUpdateSchema` 含必填 category）；② 软停用 + 恢复一对动作（`POST /:id/restore`，镜像 orders 生命周期动词）。cms 写 route 真实多租户隔离测试单列 issue（见 spec §假设、contracts/cms-internal-offerings 已知缺口）。
