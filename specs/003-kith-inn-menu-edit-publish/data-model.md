# 数据模型：kith-inn 菜单编辑 + 接龙发布

本 feature **不改 schema**——`menu_plans`/`service_slots` 已就绪。下方说明 M1 视角的字段角色、状态机、接龙文案形状。

## 实体：MenuPlan（menu_plans）

| 字段 | M1 角色 | 说明 |
|---|---|---|
| `id` | 系统赋值 | swap/publish 定位键 |
| `slot` | generate ensure | → 当餐次 service_slot（date+occasion）；generate 时缺则建 draft、不动既有 status |
| `offerings[]` | generate/swap 写 | → 当餐 dishes（component offering ids） |
| `publishText` | publish 写 / swap 清 | **接龙格式**文案；改菜自动清空（stale） |
| `status` | 系统管 draft/published | draft=暂定（generate 写、随意改）；published=已发出（一键发布、改要 force） |
| `seller` | 系统钉死 | 从 JWT |

## 状态机

```
            generate (写 draft，覆写)
   (无) ───────────────────────►  draft  ──publish(一键发布)──►  published
                                   ▲                              │
                                   └──swap / generate(force)──────┘ (二次确认)
```

- draft → published：`POST /plans/:id/publish`（一键发布）。
- published 上 generate/swap：caller 二次确认 → 带 `force:true`；be 无 force → 409 `{error:"plan-published"}`。
- published 上改菜 → publishText 清空。
- 无终态/归档（M1 不删 plan）。

## 接龙文案（publishText，确定性模板）

`buildJielongMenuText(plan, seller): string` —— 纯函数、**不调 LLM**。默认模板（需桃子真实接龙样本校准，follow-up）：

```
【街坊味】7月8日 周三 午餐
红烧牛肉、清炒时蔬、麻婆豆腐、蒜蓉空心菜、番茄蛋汤
30元/份 · 上午10点接龙截止 · 送餐到门口
接龙：
1.
```

- 字段：日期（slot.date → `M月D日 周X`）、餐次（occasion）、菜名（offerings.name、顿号分隔）、价格（seller.defaultPriceCents → 元）、截止/送餐说明（默认常量，可校准）。
- 模板常量（标题前缀、分隔符、截止措辞、接龙起始）放纯函数内、`// ponytail: 默认值，待桃子真实接龙样本校准`。

## 契约（M1 新增，定义在 shared）

```ts
// GET /menu/plans 响应（一条）
menuPlanViewSchema = { planId: id; date: string; occasion: "lunch"|"dinner"; status: "draft"|"published"; dishes: MenuDish[]; publishText?: string }

// POST /menu/plans/:id/swap 请求 / 响应
swapRequestSchema  = { dishId: id; replacementId?: id; force?: boolean }
// 200 → menuPlanViewSchema；409 → {error:"plan-published"}；404 → not found

// POST /menu/plans/:id/publish 响应
{ publishText: string }
```

`MenuDish` 复用现有。由 shared schemas 定义、types.ts `z.infer` 推导。

## ServiceSlot（不开餐）

`service_slots` 现有。本 feature generate 时 ensure 存在（缺则建 status=draft），**不改既有 slot.status**。slot open 归订单确认（PRD §7.1）。无 archived/force-slot 交互。

## 迁移说明

- **无 schema 字段变更**（drizzle push）。
- **新增 `menu_plans (seller, slot)` 唯一索引**：并入 `apps/cms/src/db/ensureConstraints.ts`（`CREATE UNIQUE INDEX IF NOT EXISTS menu_plans_seller_slot_unique ON cms.menu_plans (seller_id, slot_id)`）——保证"一餐一 plan"不变量，防并发 upsert 重复（Codex #115 P2）。这是本 feature 对 ensureConstraints 的唯一新增。
- 无 migration 文件（未部署）。
- docs 同步：更新 `docs/kith-inn/DATA-MODEL.md` §4 menu_plans（status draft/published 用法 + 接龙 publishText + ensure-slot + 唯一索引）。
