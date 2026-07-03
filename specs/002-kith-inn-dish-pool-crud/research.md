# 调研记录：kith-inn 菜品池 CRUD

## 当前完成度快照

`offerings` collection 字段已全部就绪（name/kind/mainIngredient/category/priceCents/tags/recipe/active/seller + tenantAccess/tenantHooks），seed 已有桃子的 component 菜品池（带 category 标注）。读链路通：cms internal GET → be `findOfferings` → be `menu.ts` 已在 BE 层过滤 `active !== false && kind === "component"` 喂给 `generateWeekMenu`；fe kitchen 页只读展示（按主料分组）。

缺口：菜品池**只能读不能改**。cms internal offerings route 只有 GET；be offerings 路由只有 GET；fe kitchen 页无 CRUD UI。shared 只有完整实体 `offeringSchema`，没有写专用 schema。

## 决策：删除 = 软停用，且支持恢复（评审拍板）

**理由**: `offerings` 被 `order_items.offering`（required rel）、`menu_plans.offerings[]`（hasMany）、`offerings.parentOfferings`（自关联）引用。Payload relationship 落地为 postgres FK，默认 `ON DELETE NO ACTION`（restrict）——物理删一道被引用的菜会抛 FK 错。PRD/DATA-MODEL 已为 `active` 字段定义软停用语义。评审进一步要求"误删能找回"，故 M1 提供「删除（active=false）」+「恢复（active=true）」一对动作（镜像 orders 的 confirm/cancel 生命周期动词）。

**考虑过的替代方案**:

- 物理删除 + 引用预检：拒绝。要为每种引用写预检 + 给桃子解释"为什么删不掉"，代码与交互都更复杂；软停用一句 update 搞定。
- 物理删除 + 级联清理：拒绝。改写历史订单/菜单数据，违背"业务数据永久"。
- 加 `deletedAt` 字段：拒绝。已有 `active`，复用即可，不增字段。
- 软删但不支持恢复（恢复 deferred）：被评审否决——误删无 UI 找回是真问题。M1 即提供恢复。

## 决策：category 录入时由用户选（评审拍板，反转早先"后端推断"方案）

**理由**: 菜单内核 `generateWeekMenu` 需要 category 才能组「2荤2素1汤」。早先考虑"后端按 name+mainIngredient 推断、不进表单"，但评审决定**录入时直接带分类**——桃子最清楚自己这道菜是荤是素，录入选一次就对了，且随时可编辑（有纠错路径）。表单收 name + mainIngredient + category（3 字段，category 必填、限 `OFFERING_CATEGORIES`）。

**为什么放弃推断**:

- 推断是启发式、有上限（歧义默认 veg）；seed 数据证明 category 不是 mainIngredient 的纯函数（`鸡蛋` 在「番茄炒蛋」veg、「紫菜蛋花汤」soup），需双信号，仍会误判。
- 推断方案下桃子在 UI 上**改不回 category**（无字段）——错判累积、无纠错路径。
- 录入带分类一次性消除这两个问题：正确性由人保证、可编辑纠错。多花 1 个表单字段换确定性，值。

**考虑过的替代方案**:

- 后端按 name+mainIngredient 推断（`inferCategory`）：拒绝（上述）。
- 不收 category、新增菜走 `toMenuDish` 的 veg 默认：拒绝。红烧肉会被当素菜选，菜单荤素结构错乱。
- 允许通过 CRUD 设 priceCents：拒绝。桃子 MVP 统一 30 元/份（`sellers.defaultPriceCents` 兜底），单价维护非 M1。

## 决策：读侧过滤放 BE 层（与 menu.ts 同构），cms GET 保持 generic

**理由**: be `routes/menu.ts` 已在 BE 层做 `o.active !== false && o.kind === "component"` 过滤。本 feature 的菜品池读（kitchen 页）要的是 `kind=component`（含 active+inactive，供 FE 分「菜品池/已停用」两区），与 menu.ts 略不同（menu 还要 active）。把过滤放 be offerings 路由 GET，可在 be 单测覆盖；cms internal GET 保持"原始、按 seller 全量"的 generic 读（不把域逻辑塞进 cms glue）。

**实现**: be offerings GET 过滤 `kind === "component"`（**不过滤 active**，让 FE 拿到 active 标记分区）；menu.ts 保持自己的 `active && component` 过滤不动（它直接调 cms，不经 be offerings 路由）。cms GET route 不动。

## 决策：写白名单 name/mainIngredient/category，kind 强制 component

**理由**: M1 表单只暴露 name/mainIngredient/category（评审拍板）。`priceCents`/`tags`/`recipe`/`kind` 在底层保留但不进 M1 表单、不被 CRUD 写入。cms POST 忽略请求体 `kind` 强制 `component`；其他非白名单字段不设（留默认/空）。

## 决策：新增 shared 写 schema（offeringCreateSchema / offeringUpdateSchema）

**理由**: 现有 `offeringSchema` 是完整实体（含 id/kind/seller/...），不能直接当写输入。新增 `offeringCreateSchema = { name; mainIngredient?; category }` 和 `offeringUpdateSchema = Partial<{ name; mainIngredient; category }>`，作为 FE↔BE↔cms 三端共享写契约（与 chat_messages 用 `cardPayloadSchema` 双层校验同构）。写 schema `z.object` 非 passthrough——多余字段被 zod 丢弃，天然挡住 priceCents/tags/recipe/kind/seller/id 等 M1 不暴露字段。`category` 用现有 `offeringCategorySchema = z.enum(["meat","veg","soup","staple"])`（schemas.ts 已定义，需 export 复用）。

## 决策：写经 cms internal API，复用 operatorScope + ownedBy

**理由**: TECH-SPEC §2 明令"写一律走 Payload API（让校验/hooks/租户 access 生效），禁止 be 直连 DB 写裸 SQL"。cms 已有 `operatorScope`（验 JWT → sellerId/operatorId/payload）和 `ownedBy`（跨租户引用预检）——orders 写 route 已用这套。POST/DELETE/restore 由 `operatorScope` 拿 sellerId 钉租户、`overrideAccess:true` 写（触发 collection 的 `stampSeller` + `assertSameTenantRefs`）；PATCH/DELETE/restore 用 find-then-update 确认归属（跨租户 404）。

**已知缺口（单列 issue 跟踪，本 feature 不做）**: cms 写 route handler 的 `overrideAccess` 写不触发 access fn（无 `req.user`），跨租户 404 靠 handler 内手动 `where:{seller}` + find-then-update，**这一层没有自动化断言**——be 测试 mock 掉 cms，验不到 cms 真的会 404。仓库靠 payload 包的 access/hook 单测兜底；既有 orders POST 同样如此（precedent）。是否给 cms 写 route 补真实 postgres 多租户隔离测试，开 issue 评估。

## 决策：fe CRUD 用「操作后整体 refetch」，不做乐观更新

**理由**: 桃子的池约 20 道菜，整体 refetch 成本可忽略；乐观更新要写回滚/冲突逻辑，M1 不需要。每次新增/编辑/删除/恢复成功后重新拉一次 `GET /offerings`，列表（含两区分区）天然一致。

## 决策：cms 路由 handler 不写直接单测

**理由**: `apps/cms/vitest.config.ts` 仅 `include: ["tests/**"]`，注释明说"cms 是薄 Payload host，路由 handler 是 glue，100% 逻辑在 `@cfp/kith-inn-payload`"。新增 POST/PATCH/DELETE/restore handler 复用已受信的 `operatorScope`/`ownedBy` + `payload.create/update`，自身无独立逻辑分支。契约由 be 侧 `lib/cms/offerings.test.ts`（mocked fetch）覆盖；租户隔离由 payload 包 access/hook 单测覆盖。与 feature 001 同策略。
