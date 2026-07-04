# 快速验证：kith-inn 菜单编辑 + 接龙发布

## 自动化检查

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-fe test
```

预期：
- shared：`menuPlanViewSchema`/`swapRequestSchema`/接龙 publishText 用例。
- be `domain/menu/jielongText.test.ts`：`buildJielongMenuText`（日期/菜名/价格/截止/接龙起始；多道菜顿号分隔；缺 publishText 时的形状）。
- be `domain/menu/core.test.ts`：`swapDishSpecified`（指定换 + 避重 warning + 池内校验 + 同菜拒绝）。
- be `lib/cms/menuPlans.test.ts`：list/get/upsert/patch 向 cms 发正确 URL/method/body/头，非 2xx 抛 `CmsHttpError`。
- be `routes/menu.test.ts`：`GET /plans`、`POST /generate`（写 draft；published 无 force→409；pool-too-small）、`POST /plans/:id/swap`（auto/指定/warning；published 无 force→409；清 publishText；404）、`POST /plans/:id/publish`（draft→published+接龙文案；published 缓存；404）；全 401。
- fe `logic/menuEdit.test.ts`：view-mode 判定、swap-request 构造。
- `apps/cms` 无新增单测（glue）；`@cfp/kith-inn-payload test` 仍绿（不改 collection）。

完整门禁：`pnpm verify`。

## 手动冒烟（H5）

需 cms（postgres+push）+ be + fe（**无需 DeepSeek**）。

1. 登录，进菜单 tab → 默认**日视图·今天**。
2. **生成**：明天午餐「生成」→ 出 draft（暂定色）的 2荤2素1汤。
3. **换一道**：对某菜「换一道」→ 换成池里另一道（避重）。
4. **选别的**：「选别的」→ 弹菜品选择器 → 选指定菜 → 冲突则提示确认。
5. **一键发布**：「一键发布」→ 接龙格式文案复制到剪贴板、该餐变已发出色；粘贴可见【街坊味】日期/菜名/¥30/份/截止/接龙起始。
6. **复制文案**：published 餐「复制文案」→ 返回缓存（不重生成）。
7. **改已发出**：published 餐「换一道」→ 弹二次确认 → 确认后换 + publishText 清空 → 再「复制文案」重新生成。
8. **周视图**：toggle 切周 → 网格看本周各餐 →「生成这周」→ 各餐 draft；点某天 → 跳该天日视图。
9. **翻页**：日视图左右滑看前/后日期；「跳回今天」。
10. **跨租户**（需第二 seller）：A token PATCH/swap B 的 plan → 404。

## 明确不做（deferred）

接龙文案真实格式校准（M1 默认模板）、plan 删除、真发微信群、整周一键发出、菜单 tab 翻周到任意历史、「今天」agent 菜单工具（US-M06=feature 004）、LLM 语气润色。
