# 快速验证：kith-inn 菜单换菜 + 发群文案（持久化）

## 自动化检查

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-fe test
```

预期：

- shared：`swapMenuRequestSchema`（带/不带 replacementId、target 校验）、`publishedMenuSchema`、`publishTextResponseSchema` 用例；多余字段被 strip。
- be `domain/menu/weekDates.test.ts`：`resolveWeekDates` 当周 mon-fri 日期正确（含跨月、Asia/Shanghai）。
- be `domain/menu/core.test.ts`：`swapDishSpecified`（指定换 + 主料避重 warning + 池内校验 + 同菜拒绝）。
- be `lib/cms/menuPlans.test.ts`：`listMenuPlans`/`upsertMenuPlan`/`updateMenuPlanPublishText` 向 cms 发正确 URL/method/body/头，非 2xx 抛 `CmsHttpError`。
- be `routes/menu.test.ts`：`POST /swap`（auto/指定/失败 reason）、`POST /publish`（upsert、archived→409）、`GET /published`（空/非空）、`POST /plans/:id/publish-text`（首次生成 / 命中缓存 / 跨租户 404 / LLM 失败 502）；全 401。
- fe `logic/menuEdit.test.ts`：`applySwap`（替换目标 dish、不动其它餐）、视图判定。
- `apps/cms` 无新增单测（路由 handler 是 glue，由 be mocked-fetch 覆盖契约）。
- `pnpm --filter @cfp/kith-inn-payload test` 仍通过（不改 collection/access/hooks）。

完整门禁：

```bash
pnpm verify   # lint + typecheck + 100% 覆盖 + knip + build
```

## 手动冒烟（H5）

需起 cms（postgres + push）+ be + fe + DeepSeek key。

1. 登录桃子灶台，进菜单 tab。
2. **建议页**（当周未发布）：看到本周生成菜单。
3. **换一道（auto）**：对周一午餐某菜点「换一道」→ 该道换成池里另一道（避重），其余不变。
4. **选别的（指定）**：点「选别的」→ 弹菜品选择器 → 选「香菇滑鸡」→ 若破坏主料避重，弹「会和近期主料重复，仍要换吗？」→ 确认 → 换成指定菜。
5. **发布**：点「发布本周菜单」→ 成功 → 页面切到已发布视图（只读）。检查 db：当周 10 条 menu_plan（published）、对应 service_slots=open。
6. **回看**：刷新 / 重开菜单 tab → 仍是已发布菜单（不再生成建议）。
7. **复制文案**：对周一午餐点「复制文案」→ 拿到群通知文案（菜名+¥30/份+10 点截止）、写入该 plan、剪贴板复制。再点 → 直接返回缓存（不重复调 LLM，看 be 日志）。
8. **重新发布**：回建议页（如何触发：另开入口或清当周 published 后重做）改菜再发 → menu_plan upsert 更新（不重复建）。
9. **archived slot**（构造：手动把某 slot 置 archived）→ 发布该餐次 → 409 错误提示。
10. **跨租户**（需第二 seller）：用 A token PATCH B 的 plan id → 404。

## 明确不做（deferred）

- 发布后换菜（重新发布 upsert 覆盖即等价）。
- menu_plan draft 持久化（M1 只 published）。
- 整周一坨 publishText（M1 每餐次按需）。
- 菜单 tab 日期切换 / 翻周（M1 锁当周）。
- 「今天」agent 口头改菜单 / 口头发布（US-M06；本 feature be 端点已为它备好）。
- menu_plan 物理删除 / 清理。
- force reopen archived slot（M1 直接报错）。
